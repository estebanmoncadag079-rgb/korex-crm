import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  transicionCampanaValida,
  type CampaignStatus,
} from "@/server/campaigns/estados";
import { resolverAudiencia, estimarCampana, type AudienceFilter } from "@/server/campaigns/audiencia";
import { categoriaDeTarifaDesdeTemplate } from "@/server/pricing/rates";
import { proveedorRealDeOrganizacion } from "@/server/whatsapp/credentials";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

/**
 * El dominio de campañas por fuera del claim/envío — crear, congelar la
 * plantilla, construir la audiencia y encolar los trabajos. Nada de esto
 * llama a un proveedor de WhatsApp; eso vive en `worker.ts` (Fase 6A).
 */

export class CampanaError extends Error {
  code: "not_found" | "invalid" | "invalid_transition";
  constructor(code: CampanaError["code"], message: string) {
    super(message);
    this.name = "CampanaError";
    this.code = code;
  }
}

const CAMPANA_ERROR_STATUS: Record<CampanaError["code"], number> = {
  not_found: 404,
  invalid: 422,
  invalid_transition: 409,
};

export function campanaErrorStatus(err: CampanaError): number {
  return CAMPANA_ERROR_STATUS[err.code];
}

type CampaignRow = typeof schema.campaign.$inferSelect;

async function leerCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, campaignId)
      )
    )
    .limit(1);
  const campana = rows[0];
  if (!campana) throw new CampanaError("not_found", "Campaña no encontrada");
  return campana;
}

/** Cambia el estado con la máquina de `estados.ts` como única fuente de verdad. */
async function transicionar(
  organizationId: string,
  campaignId: string,
  hacia: CampaignStatus,
  extra: Partial<typeof schema.campaign.$inferInsert> = {}
): Promise<CampaignRow> {
  const actual = await leerCampana(organizationId, campaignId);
  if (!transicionCampanaValida(actual.status as CampaignStatus, hacia)) {
    throw new CampanaError(
      "invalid_transition",
      `Campaña ${campaignId}: transición "${actual.status}" → "${hacia}" no permitida`
    );
  }
  const db = getDb();
  const actualizado = await db
    .update(schema.campaign)
    .set({ status: hacia, updatedAt: new Date(), ...extra })
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, campaignId)
      )
    )
    .returning();
  return actualizado[0]!;
}

/** Crea una campaña en `draft` — el mínimo indispensable para empezar a configurarla. */
export async function crearCampana(input: {
  organizationId: string;
  name: string;
  templateId?: string;
  createdBy?: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const id = newId("campaign");
  await db.insert(schema.campaign).values({
    id,
    organizationId: input.organizationId,
    name: input.name,
    templateId: input.templateId,
    createdBy: input.createdBy,
  });
  return { id };
}

/**
 * Solo lectura: ¿esta campaña tiene lo mínimo para pasar a `ready`? No
 * transiciona nada — separado de `prepararCampana` para poder mostrar
 * errores claros antes de intentar el cambio de estado.
 */
export async function validarCampana(
  organizationId: string,
  campaignId: string
): Promise<{ valida: boolean; errores: string[] }> {
  const campana = await leerCampana(organizationId, campaignId);
  const errores: string[] = [];
  if (!campana.templateId) errores.push("La campaña no tiene una plantilla asignada");
  if (campana.templateId) {
    const db = getDb();
    const plantillas = await db
      .select()
      .from(schema.template)
      .where(
        scoped(
          schema.template.organizationId,
          organizationId,
          eq(schema.template.id, campana.templateId)
        )
      )
      .limit(1);
    const plantilla = plantillas[0];
    if (!plantilla) errores.push("La plantilla asignada ya no existe");
    else if (plantilla.status !== "approved") {
      errores.push("La plantilla asignada no está aprobada por Meta");
    }
  }
  return { valida: errores.length === 0, errores };
}

/**
 * Congela `name`/`language`/`category`/`body` de la plantilla en
 * `campaign.templateSnapshot` — nunca cambia después de este punto, aunque
 * el `template` original se edite o se borre más tarde (Fase 6A, punto 3).
 * No toca el `template` original, no sincroniza con Meta.
 */
export async function congelarTemplateSnapshot(
  organizationId: string,
  campaignId: string
): Promise<void> {
  const campana = await leerCampana(organizationId, campaignId);
  if (!campana.templateId) {
    throw new CampanaError("invalid", "La campaña no tiene plantilla asignada");
  }
  const db = getDb();
  const plantillas = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.id, campana.templateId)
      )
    )
    .limit(1);
  const plantilla = plantillas[0];
  if (!plantilla) throw new CampanaError("not_found", "Plantilla no encontrada");
  if (plantilla.status !== "approved") {
    throw new CampanaError("invalid", "Solo se puede congelar una plantilla aprobada");
  }

  await db
    .update(schema.campaign)
    .set({
      templateSnapshot: {
        name: plantilla.name,
        language: plantilla.language,
        category: plantilla.category,
        body: plantilla.body,
        // Fase 9P, sección 11 — congela header/footer vigentes al momento
        // de pasar a `ready`; una campaña ya congelada nunca se entera si
        // el template vivo cambia su header después.
        components: plantilla.components ?? undefined,
      },
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, campaignId)
      )
    );
}

/**
 * `draft → ready`: valida, congela el snapshot, congela la estimación
 * financiera, y transiciona — en ese orden.
 *
 * Fase 10J (autoauditoría) — hallazgo real: hasta esta corrección, solo
 * `solicitarAprobacionCampana()` llamaba a `congelarEstimacion()`. Una
 * campaña preparada por el camino DIRECTO (sin flujo de aprobación — el
 * superadmin la arma él mismo) quedaba con `estimatedRecipients`/
 * `estimatedCostUsd`/`rateSnapshot` en NULL para siempre, contradiciendo el
 * objetivo declarado de "control financiero" para TODA campaña, no solo
 * las que piden aprobación.
 */
export async function prepararCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  const { valida, errores } = await validarCampana(organizationId, campaignId);
  if (!valida) {
    throw new CampanaError("invalid", `Campaña no lista para "ready": ${errores.join("; ")}`);
  }
  await congelarTemplateSnapshot(organizationId, campaignId);
  await congelarEstimacion(organizationId, campaignId);
  return transicionar(organizationId, campaignId, "ready");
}

/**
 * Construye la audiencia MVP (`audienceType = "todos_los_contactos"`, único
 * valor soportado hoy) materializando una fila `campaign_recipient` por
 * contacto elegible. Idempotente: reejecutarla no duplica nada — el
 * `UNIQUE(campaignId, contactId)` ya existente es la garantía real, este
 * `onConflictDoNothing` solo evita el viaje redundante a la base.
 *
 * Reutiliza `contactosElegiblesParaMarketing()` tal cual (Fase 3D/4): nunca
 * se reconstruye ese filtro aquí — es la única función/repository para
 * "quién puede recibir marketing", y ya excluye archivados y opt-out.
 */
export async function materializarAudienciaDeCampana(
  organizationId: string,
  campaignId: string
): Promise<{ creados: number }> {
  const campana = await leerCampana(organizationId, campaignId); // valida existencia/organización
  const providerEnvio = await proveedorRealDeOrganizacion(organizationId);
  const { contactIds } = await resolverAudiencia({
    organizationId,
    audienceType: campana.audienceType,
    audienceFilter: (campana.audienceFilter as AudienceFilter) ?? null,
    category: categoriaDeTarifaDesdeTemplate(campana.templateSnapshot?.category),
    provider: providerEnvio === "ycloud" ? "ycloud" : "meta",
  });
  if (contactIds.length === 0) return { creados: 0 };

  const db = getDb();
  const filas = contactIds.map((contactId) => ({
    id: newId("campaignRecipient"),
    organizationId,
    campaignId,
    contactId,
    status: "pending" as const,
  }));
  const insertados = await db
    .insert(schema.campaignRecipient)
    .values(filas)
    .onConflictDoNothing({
      target: [schema.campaignRecipient.campaignId, schema.campaignRecipient.contactId],
    })
    .returning({ id: schema.campaignRecipient.id });
  return { creados: insertados.length };
}

/**
 * Un `campaign_send_job` por cada recipient `pending` que todavía no tenga
 * uno — idempotente por el `LEFT JOIN ... IS NULL` (no vuelve a encolar lo
 * ya encolado) y por `UNIQUE(recipientId)` como defensa final ante una
 * carrera entre el SELECT y el INSERT (Fase 6A, punto 8).
 */
export async function encolarEnviosDeCampana(
  organizationId: string,
  campaignId: string
): Promise<{ creados: number }> {
  const db = getDb();
  const pendientesSinJob = await db
    .select({ id: schema.campaignRecipient.id })
    .from(schema.campaignRecipient)
    .leftJoin(
      schema.campaignSendJob,
      eq(schema.campaignSendJob.recipientId, schema.campaignRecipient.id)
    )
    .where(
      and(
        scoped(
          schema.campaignRecipient.organizationId,
          organizationId,
          eq(schema.campaignRecipient.campaignId, campaignId),
          eq(schema.campaignRecipient.status, "pending")
        ),
        isNull(schema.campaignSendJob.id)
      )
    );
  if (pendientesSinJob.length === 0) return { creados: 0 };

  const filas = pendientesSinJob.map((r) => ({
    id: newId("campaignSendJob"),
    organizationId,
    campaignId,
    recipientId: r.id,
    status: "pendiente" as const,
  }));
  const insertados = await db
    .insert(schema.campaignSendJob)
    .values(filas)
    .onConflictDoNothing({ target: [schema.campaignSendJob.recipientId] })
    .returning({ id: schema.campaignSendJob.id });
  return { creados: insertados.length };
}

/**
 * `ready|scheduled → processing`: materializa la audiencia, encola los
 * jobs, y transiciona — en ese orden, y ambos pasos son idempotentes si
 * `iniciarCampana` se llama dos veces por error.
 */
export async function iniciarCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  const actual = await leerCampana(organizationId, campaignId);
  if (
    !transicionCampanaValida(actual.status as CampaignStatus, "processing")
  ) {
    throw new CampanaError(
      "invalid_transition",
      `Campaña ${campaignId}: transición "${actual.status}" → "processing" no permitida`
    );
  }
  await materializarAudienciaDeCampana(organizationId, campaignId);
  await encolarEnviosDeCampana(organizationId, campaignId);
  return transicionar(organizationId, campaignId, "processing", { startedAt: new Date() });
}

export async function pausarCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  return transicionar(organizationId, campaignId, "paused");
}

/**
 * `paused → processing`, y SOLO desde `paused` (Fase 6C, hallazgo #1 de la
 * Fase 6B: sin esta función, una campaña pausada por reconexión quedaba
 * pausada para siempre). Deliberadamente más estrecho que un `transicionar`
 * genérico: `transicionCampanaValida` por sí sola dejaría pasar también
 * `ready → processing` (esa es la ruta de `iniciarCampana`, con su propia
 * materialización de audiencia) — `reanudarCampana` nunca debe confundirse
 * con "arrancar" una campaña. Siempre una acción explícita de un operador,
 * nunca automática (Fase 6B, punto 12: sin reanudación automática).
 */
export async function reanudarCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  const actual = await leerCampana(organizationId, campaignId);
  if (actual.status !== "paused") {
    throw new CampanaError(
      "invalid_transition",
      `Campaña ${campaignId}: reanudarCampana() solo aplica desde "paused" (estado actual: "${actual.status}")`
    );
  }
  return transicionar(organizationId, campaignId, "processing");
}

export async function cancelarCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  return transicionar(organizationId, campaignId, "cancelled");
}

export async function completarCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  return transicionar(organizationId, campaignId, "completed", { finishedAt: new Date() });
}

/**
 * Transición AUTOMÁTICA `processing → completed` (Fase 6C, hallazgo #2 de
 * la Fase 6B): solo cuando NO quedan `campaign_recipient` en
 * `pending`/`sending` NI `campaign_send_job` en `pendiente`/`corriendo`
 * para esta campaña. Idempotente y silenciosa — llamarla sobre una campaña
 * que ya no está `processing`, o que todavía tiene trabajo activo, no hace
 * nada (`completada: false`), nunca lanza por eso.
 *
 * El `SELECT ... FOR UPDATE` sobre la fila de `campaign` es lo que resuelve
 * la condición de carrera entre dos workers cerrando el penúltimo y el
 * último recipient casi al mismo tiempo (Fase 6B, punto 9): mientras esta
 * transacción tiene la fila bloqueada, cualquier otra escritura concurrente
 * sobre esa misma fila (otra llamada a esta función, o a
 * `pausarCampana`/`cancelarCampana`) espera a que termine — así que nunca
 * hay una lectura obsoleta de `status`, y a lo sumo una de las llamadas
 * concurrentes gana la transición; la otra, al releer ya bloqueada, ve
 * `status !== "processing"` (o encuentra trabajo activo real) y no hace
 * nada.
 */
export async function intentarCompletarCampana(
  organizationId: string,
  campaignId: string
): Promise<{ completada: boolean }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const campanas = await tx
      .select()
      .from(schema.campaign)
      .where(
        scoped(
          schema.campaign.organizationId,
          organizationId,
          eq(schema.campaign.id, campaignId)
        )
      )
      .for("update")
      .limit(1);
    const campana = campanas[0];
    if (!campana) throw new CampanaError("not_found", "Campaña no encontrada");
    if (campana.status !== "processing") return { completada: false };

    const recipientsActivos = await tx
      .select({ id: schema.campaignRecipient.id })
      .from(schema.campaignRecipient)
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          organizationId,
          eq(schema.campaignRecipient.campaignId, campaignId),
          inArray(schema.campaignRecipient.status, ["pending", "sending"])
        )
      )
      .limit(1);
    if (recipientsActivos.length > 0) return { completada: false };

    const jobsActivos = await tx
      .select({ id: schema.campaignSendJob.id })
      .from(schema.campaignSendJob)
      .where(
        scoped(
          schema.campaignSendJob.organizationId,
          organizationId,
          eq(schema.campaignSendJob.campaignId, campaignId),
          inArray(schema.campaignSendJob.status, ["pendiente", "corriendo"])
        )
      )
      .limit(1);
    if (jobsActivos.length > 0) return { completada: false };

    await tx
      .update(schema.campaign)
      .set({ status: "completed", finishedAt: new Date(), updatedAt: new Date() })
      .where(
        scoped(
          schema.campaign.organizationId,
          organizationId,
          eq(schema.campaign.id, campaignId)
        )
      );
    return { completada: true };
  });
}

export async function fallarCampana(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  return transicionar(organizationId, campaignId, "failed", { finishedAt: new Date() });
}

/**
 * Fase 10F — calcula la estimación (elegibles/costo) SIN transicionar ni
 * escribir nada todavía; separado de `congelarEstimacion` para que la UI
 * pueda mostrar el número antes de que el usuario confirme nada (sección
 * "Paso 5: Estimación" del diseño pedido).
 */
export async function estimarCampanaActual(
  organizationId: string,
  campaignId: string
): Promise<ReturnType<typeof estimarCampana>> {
  const campana = await leerCampana(organizationId, campaignId);
  if (!campana.templateId) {
    throw new CampanaError("invalid", "La campaña no tiene una plantilla asignada");
  }
  const db = getDb();
  const plantillas = await db
    .select({ category: schema.template.category })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, campana.templateId)))
    .limit(1);
  const plantilla = plantillas[0];
  if (!plantilla) throw new CampanaError("not_found", "Plantilla no encontrada");
  const providerEnvio = await proveedorRealDeOrganizacion(organizationId);
  return estimarCampana({
    organizationId,
    audienceType: campana.audienceType,
    audienceFilter: (campana.audienceFilter as AudienceFilter) ?? null,
    category: categoriaDeTarifaDesdeTemplate(plantilla.category),
    provider: providerEnvio === "ycloud" ? "ycloud" : "meta",
  });
}

/**
 * Congela la estimación (`estimatedRecipients`/`estimatedCostUsd`/
 * `rateSnapshot`) en la propia campaña — "snapshot de tarifa" pedido
 * explícitamente (Fase 10I, "CONTROL FINANCIERO"): un cambio posterior de
 * `pricing_rate` nunca reescribe una estimación ya hecha y mostrada al
 * cliente/superadmin.
 */
async function congelarEstimacion(organizationId: string, campaignId: string): Promise<void> {
  const estimacion = await estimarCampanaActual(organizationId, campaignId);
  const db = getDb();
  await db
    .update(schema.campaign)
    .set({
      estimatedRecipients: estimacion.seleccionados,
      estimatedCostUsd: estimacion.costoEstimadoUsd.toFixed(4),
      currency: estimacion.moneda,
      rateSnapshot: { ratesUsadas: estimacion.ratesUsadas, calculadoAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)));
}

/**
 * Fase 10I — el CLIENTE arma el borrador (nombre, plantilla, audiencia) y
 * pide aprobación: `draft → pending_approval`. Congela snapshot de
 * plantilla Y estimación de costo AQUÍ (no al aprobar): el superadmin debe
 * revisar exactamente lo que se pidió, no una versión que pudo cambiar
 * mientras esperaba en la bandeja de aprobación.
 */
export async function solicitarAprobacionCampana(
  organizationId: string,
  campaignId: string,
  actor: Actor
): Promise<CampaignRow> {
  const { valida, errores } = await validarCampana(organizationId, campaignId);
  if (!valida) {
    throw new CampanaError("invalid", `Campaña no lista para solicitar aprobación: ${errores.join("; ")}`);
  }
  await congelarTemplateSnapshot(organizationId, campaignId);
  await congelarEstimacion(organizationId, campaignId);
  return conRegistro(
    {
      tabla: "campaign",
      registro: campaignId,
      leerFila: async () => {
        const db = getDb();
        const rows = await db.select().from(schema.campaign).where(eq(schema.campaign.id, campaignId));
        return (rows[0] as unknown as Record<string, unknown>) ?? null;
      },
      declarados: ["status", "requestedBy", "requestedAt"],
      proceso: "solicitarAprobacionCampana",
      actor,
    },
    () => transicionar(organizationId, campaignId, "pending_approval", { requestedBy: actor, requestedAt: new Date() })
  );
}

/**
 * Fase 10I — el SUPERADMIN aprueba: `pending_approval → ready`, y SOLO
 * desde `pending_approval` — deliberadamente más estrecho que
 * `transicionCampanaValida` por sí sola (que también permite `draft →
 * ready` directo, la ruta de `prepararCampana()` sin aprobación). Mismo
 * criterio que `reanudarCampana()`: "aprobar" nunca debe poder confundirse
 * con "esto ni siquiera pasó por el flujo de aprobación".
 */
export async function aprobarCampana(
  organizationId: string,
  campaignId: string,
  actor: Actor
): Promise<CampaignRow> {
  const actual = await leerCampana(organizationId, campaignId);
  if (actual.status !== "pending_approval") {
    throw new CampanaError(
      "invalid_transition",
      `Campaña ${campaignId}: aprobarCampana() solo aplica desde "pending_approval" (estado actual: "${actual.status}")`
    );
  }
  return conRegistro(
    {
      tabla: "campaign",
      registro: campaignId,
      leerFila: async () => {
        const db = getDb();
        const rows = await db.select().from(schema.campaign).where(eq(schema.campaign.id, campaignId));
        return (rows[0] as unknown as Record<string, unknown>) ?? null;
      },
      declarados: ["status", "approvedBy", "approvedAt"],
      proceso: "aprobarCampana",
      actor,
    },
    () => transicionar(organizationId, campaignId, "ready", { approvedBy: actor, approvedAt: new Date() })
  );
}

/** Fase 10I — el SUPERADMIN rechaza: `pending_approval → rejected`, con motivo obligatorio. El cliente puede volver a `draft` para ajustar y reintentar. */
export async function rechazarCampana(
  organizationId: string,
  campaignId: string,
  actor: Actor,
  motivo: string
): Promise<CampaignRow> {
  const razon = motivo.trim();
  if (!razon) throw new CampanaError("invalid", "El motivo de rechazo no puede estar vacío");
  return conRegistro(
    {
      tabla: "campaign",
      registro: campaignId,
      leerFila: async () => {
        const db = getDb();
        const rows = await db.select().from(schema.campaign).where(eq(schema.campaign.id, campaignId));
        return (rows[0] as unknown as Record<string, unknown>) ?? null;
      },
      declarados: ["status", "rejectionReason"],
      proceso: "rechazarCampana",
      actor,
    },
    () => transicionar(organizationId, campaignId, "rejected", { rejectionReason: razon })
  );
}

/** Reabre una campaña rechazada para ajustarla: `rejected → draft`. Nunca automático. */
export async function reabrirCampanaRechazada(
  organizationId: string,
  campaignId: string
): Promise<CampaignRow> {
  return transicionar(organizationId, campaignId, "draft");
}
