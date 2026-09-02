import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { transicionCampanaValida, type CampaignStatus } from "@/server/campaigns/estados";
import { reclamarTrabajoDeCampanaPorId } from "@/server/campaigns/cola";
import {
  resolverTrabajoTomado,
  revertirAPending,
  type ProveedorDeEnvio,
  type ResultadoDelWorker,
} from "@/server/campaigns/worker";
import { renderBody } from "@/server/whatsapp/templates";

/**
 * Fase 7B — el camino de PRUEBA CONTROLADA: un único envío real, a un único
 * destinatario, imposible de ampliar accidentalmente al resto de una
 * audiencia. Deliberadamente AISLADO del camino de campañas reales
 * (`motor.ts`): nunca llama `contactosElegiblesParaMarketing()`, nunca usa
 * `materializarAudienciaDeCampana()`/`iniciarCampana()` (que materializan
 * TODA la audiencia elegible), y reclama trabajo con
 * `reclamarTrabajoDeCampanaPorId()` (acotado a una campaña), nunca con el
 * claim global del worker de producción.
 *
 * Orden de uso, siempre en este orden:
 *   materializarAudienciaUnica() → encolarJobUnicoDeCampana() →
 *   activarCampanaParaPruebaControlada() → previsualizarEnvioControlado()
 *   (solo lectura) → procesarUnEnvioControladoDeCampana() (única llamada
 *   real al proveedor, si el proveedor inyectado es el real).
 *
 * Este módulo nunca importa YCloud/Meta directamente — el proveedor sigue
 * siendo inyectado (`ProveedorDeEnvio`, igual que `worker.ts`).
 */

export class PruebaControladaError extends Error {
  code: "not_found" | "invalid" | "invalid_transition" | "mismatch" | "opt_out" | "multiple_candidates";
  constructor(code: PruebaControladaError["code"], message: string) {
    super(message);
    this.name = "PruebaControladaError";
    this.code = code;
  }
}

/**
 * Único destinatario, único job — nunca más. Constante LOCAL de este
 * módulo (Fase 7B, punto 6): no es una bandera global que pueda alterar el
 * comportamiento del worker normal, solo el umbral que este camino
 * controlado exige de sí mismo antes de activar o previsualizar.
 */
const MAX_ENVIOS_PRUEBA = 1;

/** Últimos 4 dígitos visibles, el resto enmascarado — nunca se loguea ni se persiste el valor completo por esta vía. */
function enmascararTelefono(valor: string): string {
  if (valor.length <= 4) return "*".repeat(valor.length);
  return "*".repeat(valor.length - 4) + valor.slice(-4);
}

/**
 * Cuenta TODOS los recipients y jobs de una campaña — nunca `LIMIT 1`: la
 * garantía del punto 6 exige ver el total real, no escoger el primero que
 * aparezca. Se usa como guardia antes de activar y antes de previsualizar.
 */
export async function contarDestinatariosYJobsDeCampana(
  organizationId: string,
  campaignId: string
): Promise<{ recipients: number; jobs: number }> {
  const db = getDb();
  const recipientRows = await db
    .select({ id: schema.campaignRecipient.id })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.campaignId, campaignId)
      )
    );
  const jobRows = await db
    .select({ id: schema.campaignSendJob.id })
    .from(schema.campaignSendJob)
    .where(
      scoped(
        schema.campaignSendJob.organizationId,
        organizationId,
        eq(schema.campaignSendJob.campaignId, campaignId)
      )
    );
  return { recipients: recipientRows.length, jobs: jobRows.length };
}

/**
 * Materializa EXACTAMENTE un `campaign_recipient`, para un contacto
 * explícito — nunca a través de `contactosElegiblesParaMarketing()`, nunca
 * seleccionando más de un contacto. `UNIQUE(campaignId, contactId)`
 * (`onConflictDoNothing`) es la protección final; además idempotente en sí
 * misma: llamarla dos veces con los mismos IDs devuelve el mismo
 * `recipientId`, nunca crea un segundo.
 */
export async function materializarAudienciaUnica(input: {
  organizationId: string;
  campaignId: string;
  contactId: string;
}): Promise<{ recipientId: string; creado: boolean }> {
  const db = getDb();

  const campanas = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, input.organizationId, eq(schema.campaign.id, input.campaignId)))
    .limit(1);
  const campana = campanas[0];
  if (!campana) throw new PruebaControladaError("not_found", "Campaña no encontrada en esta organización");
  if (campana.organizationId !== input.organizationId) {
    // No debería poder ocurrir (scoped() ya lo garantiza) — comprobación
    // explícita igual, nunca confiar solo en el filtro (Fase 4C, punto 13).
    throw new PruebaControladaError("mismatch", "La campaña no pertenece a la organización indicada");
  }
  if (!campana.templateId) {
    throw new PruebaControladaError("invalid", "La campaña no tiene una plantilla asignada");
  }
  if (!campana.templateSnapshot) {
    throw new PruebaControladaError(
      "invalid",
      "La campaña no tiene snapshot congelado — debe pasar por prepararCampana() primero"
    );
  }
  // Fase 7B, punto 7: el snapshot es la fuente de verdad del CONTENIDO
  // (Fase 6C), pero antes de materializar la prueba se revalida además que
  // la plantilla VIVA siga aprobada — salvaguarda adicional específica de
  // este camino, nunca inferida solo de que el snapshot exista.
  const plantillas = await db
    .select({ status: schema.template.status })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, input.organizationId, eq(schema.template.id, campana.templateId)))
    .limit(1);
  const plantilla = plantillas[0];
  if (!plantilla) {
    throw new PruebaControladaError("not_found", "La plantilla de la campaña ya no existe");
  }
  if (plantilla.status !== "approved") {
    throw new PruebaControladaError(
      "invalid",
      `La plantilla viva ya no está aprobada (estado actual: "${plantilla.status}") — no se puede preparar la prueba`
    );
  }
  // Estado permitido para la prueba: solo "ready" — el snapshot ya está
  // congelado, pero la campaña aún no es "processing" (nadie más la está
  // tocando todavía). Evita mezclar este camino con el de audiencia real.
  if (campana.status !== "ready") {
    throw new PruebaControladaError(
      "invalid_transition",
      `Campaña ${input.campaignId}: debe estar en "ready" para materializar el destinatario único de prueba (estado actual: "${campana.status}")`
    );
  }

  const contactos = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, input.contactId)))
    .limit(1);
  const contacto = contactos[0];
  if (!contacto) throw new PruebaControladaError("not_found", "Contacto no encontrado en esta organización");
  if (contacto.organizationId !== input.organizationId) {
    throw new PruebaControladaError("mismatch", "El contacto no pertenece a la organización indicada");
  }
  if (!contacto.phone && !contacto.waUserId) {
    throw new PruebaControladaError("invalid", "El contacto no tiene teléfono ni identificador de WhatsApp");
  }
  // Opt-out: solo se LEE, nunca se modifica desde este módulo.
  if (contacto.marketingOptOut) {
    throw new PruebaControladaError(
      "opt_out",
      "El contacto tiene opt-out de marketing — no puede usarse para la prueba controlada"
    );
  }

  const id = newId("campaignRecipient");
  const insertados = await db
    .insert(schema.campaignRecipient)
    .values({
      id,
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      contactId: input.contactId,
      status: "pending",
    })
    .onConflictDoNothing({
      target: [schema.campaignRecipient.campaignId, schema.campaignRecipient.contactId],
    })
    .returning({ id: schema.campaignRecipient.id });
  if (insertados[0]) return { recipientId: insertados[0].id, creado: true };

  // Ya existía (segunda llamada con los mismos IDs): idempotencia real, se
  // devuelve el mismo recipientId, nunca se crea un segundo.
  const existentes = await db
    .select({ id: schema.campaignRecipient.id })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        input.organizationId,
        eq(schema.campaignRecipient.campaignId, input.campaignId),
        eq(schema.campaignRecipient.contactId, input.contactId)
      )
    )
    .limit(1);
  if (!existentes[0]) {
    throw new Error(
      "materializarAudienciaUnica: conflicto de inserción sin fila resultante — inconsistencia inesperada"
    );
  }
  return { recipientId: existentes[0].id, creado: false };
}

/**
 * Encola EXACTAMENTE un `campaign_send_job`, para un recipient explícito ya
 * validado como perteneciente a esa campaña/organización.
 * `UNIQUE(recipientId)` es la protección final; idempotente en sí misma.
 */
export async function encolarJobUnicoDeCampana(input: {
  organizationId: string;
  campaignId: string;
  recipientId: string;
}): Promise<{ jobId: string; creado: boolean }> {
  const db = getDb();

  const recipientes = await db
    .select({ campaignId: schema.campaignRecipient.campaignId, status: schema.campaignRecipient.status })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        input.organizationId,
        eq(schema.campaignRecipient.id, input.recipientId)
      )
    )
    .limit(1);
  const recipiente = recipientes[0];
  if (!recipiente) throw new PruebaControladaError("not_found", "Recipient no encontrado en esta organización");
  if (recipiente.campaignId !== input.campaignId) {
    throw new PruebaControladaError(
      "mismatch",
      `El recipient ${input.recipientId} no pertenece a la campaña ${input.campaignId}`
    );
  }
  if (recipiente.status !== "pending") {
    throw new PruebaControladaError(
      "invalid_transition",
      `El recipient debe estar "pending" para encolar su job de prueba (estado actual: "${recipiente.status}")`
    );
  }

  const id = newId("campaignSendJob");
  const insertados = await db
    .insert(schema.campaignSendJob)
    .values({
      id,
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      status: "pendiente",
    })
    .onConflictDoNothing({ target: [schema.campaignSendJob.recipientId] })
    .returning({ id: schema.campaignSendJob.id });
  if (insertados[0]) return { jobId: insertados[0].id, creado: true };

  const existentes = await db
    .select({ id: schema.campaignSendJob.id })
    .from(schema.campaignSendJob)
    .where(
      scoped(
        schema.campaignSendJob.organizationId,
        input.organizationId,
        eq(schema.campaignSendJob.recipientId, input.recipientId)
      )
    )
    .limit(1);
  if (!existentes[0]) {
    throw new Error(
      "encolarJobUnicoDeCampana: conflicto de inserción sin fila resultante — inconsistencia inesperada"
    );
  }
  return { jobId: existentes[0].id, creado: false };
}

/**
 * `ready → processing`, SOLO para el camino de prueba controlada — nunca
 * llama `materializarAudienciaDeCampana()`/`encolarEnviosDeCampana()`
 * (iniciarCampana() sí lo hace, y por eso NO se reutiliza aquí: volvería a
 * materializar TODA la audiencia elegible de la organización). Antes de
 * transicionar, exige que la campaña tenga EXACTAMENTE
 * `MAX_ENVIOS_PRUEBA` (1) recipient y 1 job — la garantía del punto 6,
 * aplicada en el punto más temprano posible: nunca se puede dejar
 * `processing` una campaña de prueba con más de un destinatario.
 */
export async function activarCampanaParaPruebaControlada(
  organizationId: string,
  campaignId: string
): Promise<void> {
  const db = getDb();
  const campanas = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)))
    .limit(1);
  const campana = campanas[0];
  if (!campana) throw new PruebaControladaError("not_found", "Campaña no encontrada en esta organización");
  if (!transicionCampanaValida(campana.status as CampaignStatus, "processing")) {
    throw new PruebaControladaError(
      "invalid_transition",
      `Campaña ${campaignId}: transición "${campana.status}" → "processing" no permitida`
    );
  }

  const { recipients, jobs } = await contarDestinatariosYJobsDeCampana(organizationId, campaignId);
  if (recipients !== MAX_ENVIOS_PRUEBA || jobs !== MAX_ENVIOS_PRUEBA) {
    throw new PruebaControladaError(
      "multiple_candidates",
      `Campaña ${campaignId}: debe tener exactamente ${MAX_ENVIOS_PRUEBA} destinatario y ${MAX_ENVIOS_PRUEBA} job antes de activarse para la prueba controlada (tiene ${recipients} recipient(s), ${jobs} job(s))`
    );
  }

  await db
    .update(schema.campaign)
    .set({ status: "processing", startedAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)));
}

export type PreviewEnvioControlado = {
  organizationId: string;
  campaignId: string;
  contactId: string;
  contactName: string;
  telefonoEnmascarado: string;
  templateName: string;
  templateLanguage: string;
  snapshotBody: string;
  variableResuelta: string | null;
  mensajeFinal: string;
};

/**
 * SOLO LECTURA — nunca llama al proveedor, nunca crea nada (ni el
 * recipient ni el job), nunca cambia la base. Deliberadamente trabaja
 * sobre `contactId` directo, NUNCA sobre un `recipientId` ya materializado
 * — así puede ejecutarse ANTES de `materializarAudienciaUnica()`, que es
 * exactamente el orden que exige el script operativo (Fase 7B, punto 10:
 * "PRIMERO ejecutar preview").
 *
 * Guardia de unicidad aplicada aquí también: si la campaña YA tiene un
 * recipient de un contacto DISTINTO (de una prueba anterior reutilizando
 * el mismo `campaignId` por error), aborta — cada prueba controlada debe
 * vivir en su propia campaña.
 */
export async function previsualizarEnvioControlado(input: {
  organizationId: string;
  campaignId: string;
  contactId: string;
}): Promise<PreviewEnvioControlado> {
  const db = getDb();

  const campanas = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, input.organizationId, eq(schema.campaign.id, input.campaignId)))
    .limit(1);
  const campana = campanas[0];
  if (!campana) throw new PruebaControladaError("not_found", "Campaña no encontrada en esta organización");
  if (!campana.templateId) {
    throw new PruebaControladaError("invalid", "La campaña no tiene una plantilla asignada");
  }
  if (!campana.templateSnapshot) {
    throw new PruebaControladaError("invalid", "La campaña no tiene snapshot congelado");
  }

  const contactos = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, input.contactId)))
    .limit(1);
  const contacto = contactos[0];
  if (!contacto) throw new PruebaControladaError("not_found", "Contacto no encontrado en esta organización");
  if (!contacto.phone && !contacto.waUserId) {
    throw new PruebaControladaError("invalid", "El contacto no tiene teléfono ni identificador de WhatsApp");
  }
  if (contacto.marketingOptOut) {
    throw new PruebaControladaError(
      "opt_out",
      "El contacto tiene opt-out de marketing — no puede usarse para la prueba controlada"
    );
  }

  const existentes = await db
    .select({ contactId: schema.campaignRecipient.contactId })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        input.organizationId,
        eq(schema.campaignRecipient.campaignId, input.campaignId)
      )
    );
  const otroContacto = existentes.find((r) => r.contactId !== input.contactId);
  if (otroContacto) {
    throw new PruebaControladaError(
      "multiple_candidates",
      `La campaña ${input.campaignId} ya tiene un destinatario de prueba distinto (contacto ${otroContacto.contactId}) — usa una campaña nueva para cada prueba controlada`
    );
  }

  const variable = contacto.name || null;
  const mensajeFinal = renderBody(campana.templateSnapshot.body, variable ?? undefined);
  const telefonoParaMostrar = contacto.phone ?? contacto.waUserId ?? "(sin teléfono)";

  return {
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    contactId: contacto.id,
    contactName: contacto.name,
    telefonoEnmascarado: enmascararTelefono(telefonoParaMostrar),
    templateName: campana.templateSnapshot.name,
    templateLanguage: campana.templateSnapshot.language,
    snapshotBody: campana.templateSnapshot.body,
    variableResuelta: variable,
    mensajeFinal,
  };
}

export type ResultadoPreparacionPrueba =
  | { status: "PREVIEW_ONLY"; preview: PreviewEnvioControlado }
  | { status: "READY_TO_SEND"; preview: PreviewEnvioControlado; recipientId: string; jobId: string };

/**
 * Encapsula el flujo de dos fases del script operativo (Fase 7B, punto
 * 10): SIEMPRE calcula el preview primero (solo lectura); sin
 * `confirmar: true` se detiene ahí y devuelve `PREVIEW_ONLY` — nada se
 * escribió en la base. Con `confirmar: true`, materializa el recipient
 * único, encola su job, y activa la campaña — devuelve `READY_TO_SEND`,
 * pero JAMÁS llama a ningún proveedor: esta función no importa
 * `ProveedorDeEnvio` en absoluto. El envío real es una llamada aparte y
 * posterior a `procesarUnEnvioControladoDeCampana()`, con su propia
 * autorización.
 */
export async function prepararPruebaControlada(input: {
  organizationId: string;
  campaignId: string;
  contactId: string;
  confirmar: boolean;
}): Promise<ResultadoPreparacionPrueba> {
  const preview = await previsualizarEnvioControlado({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    contactId: input.contactId,
  });
  if (!input.confirmar) return { status: "PREVIEW_ONLY", preview };

  const { recipientId } = await materializarAudienciaUnica({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    contactId: input.contactId,
  });
  const { jobId } = await encolarJobUnicoDeCampana({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    recipientId,
  });
  await activarCampanaParaPruebaControlada(input.organizationId, input.campaignId);

  return { status: "READY_TO_SEND", preview, recipientId, jobId };
}

export type ResultadoEnvioControlado = ResultadoDelWorker | { outcome: "recipient_no_coincide" };

/**
 * El worker controlado (Fase 7B, punto 5): reclama con
 * `reclamarTrabajoDeCampanaPorId()` (acotado a `organizationId`+
 * `campaignId`, nunca el claim global), confirma que el job reclamado
 * corresponde EXACTAMENTE al `recipientId` esperado — si no, aborta antes
 * de tocar al proveedor (punto 4: nunca `campaignId A → recipient B`) — y
 * reutiliza `resolverTrabajoTomado()` de `worker.ts` para todo lo demás
 * (opt-out, conversación, rate limit, proveedor, persistencia): la MISMA
 * lógica de negocio ya probada del worker general, nunca duplicada.
 *
 * Se detiene después de UN resultado — nunca hay bucle aquí ni en ningún
 * llamador de este módulo.
 */
export async function procesarUnEnvioControladoDeCampana(opts: {
  organizationId: string;
  campaignId: string;
  recipientId: string;
  proveedor: ProveedorDeEnvio;
  rateLimit?: { windowMs: number; max: number };
  timeoutMs?: number;
}): Promise<ResultadoEnvioControlado> {
  const tomado = await reclamarTrabajoDeCampanaPorId({
    organizationId: opts.organizationId,
    campaignId: opts.campaignId,
  });
  if (!tomado) return { outcome: "sin_trabajo" };

  if (tomado.recipientId !== opts.recipientId) {
    // Nunca debería ocurrir dado que la campaña tiene un único recipient
    // (garantizado por activarCampanaParaPruebaControlada) — comprobación
    // explícita igual, nunca confiar solo en esa garantía previa.
    await revertirAPending(tomado);
    return { outcome: "recipient_no_coincide" };
  }

  return resolverTrabajoTomado(tomado, {
    proveedor: opts.proveedor,
    rateLimit: opts.rateLimit,
    timeoutMs: opts.timeoutMs,
  });
}
