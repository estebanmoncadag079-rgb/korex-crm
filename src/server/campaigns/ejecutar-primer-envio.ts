import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  contarDestinatariosYJobsDeCampana,
  procesarUnEnvioControladoDeCampana,
  type ResultadoEnvioControlado,
} from "@/server/campaigns/prueba-controlada";
import type { ProveedorDeEnvio } from "@/server/campaigns/worker";

/**
 * Fase 8A — el EJECUTOR del primer envío controlado: el puente entre un
 * recipient ya preparado (`READY_TO_SEND`, Fase 7B) y un proveedor real.
 *
 * Deliberadamente un módulo NUEVO, separado de `prueba-controlada.ts` (que
 * esta fase no toca en absoluto): preparación y ejecución son
 * responsabilidades distintas, con su propia autorización cada una.
 *
 * Reutiliza, sin duplicar ni reimplementar:
 *   - `contarDestinatariosYJobsDeCampana()` — la misma guardia de "exactamente
 *     1" que ya usa `prueba-controlada.ts` para activar/previsualizar.
 *   - `procesarUnEnvioControladoDeCampana()` — el claim acotado por campaña
 *     + toda la lógica de negocio del worker (opt-out, conversación, rate
 *     limit, proveedor, persistencia) ya construida y probada en la Fase 7B.
 *
 * Este módulo solo agrega una capa de PRECHECK de solo lectura, ANTES de
 * esa llamada — nunca reemplaza el claim atómico ni los locks ya
 * existentes, se suma a ellos como defensa en profundidad.
 */

export class EjecucionControladaError extends Error {
  code:
    | "not_found"
    | "mismatch"
    | "invalid"
    | "invalid_transition"
    | "opt_out"
    | "already_processed"
    | "multiple_candidates";
  constructor(code: EjecucionControladaError["code"], message: string) {
    super(message);
    this.name = "EjecucionControladaError";
    this.code = code;
  }
}

/** Últimos 4 dígitos visibles, el resto enmascarado. */
function enmascararTelefono(valor: string): string {
  if (valor.length <= 4) return "*".repeat(valor.length);
  return "*".repeat(valor.length - 4) + valor.slice(-4);
}

export type PrecheckPrimerEnvio = {
  organizationId: string;
  campaignId: string;
  recipientId: string;
  campaignStatus: string;
  recipientStatus: string;
  jobId: string;
  jobStatus: string;
  contactId: string;
  contactName: string;
  telefonoEnmascarado: string;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  snapshotBody: string;
  totalRecipients: number;
  totalJobs: number;
};

/**
 * PRECHECK — SOLO LECTURA. Nunca escribe, nunca llama al proveedor.
 * Cubre, en este orden (agrupado por tabla para minimizar queries, pero
 * semánticamente cubre los 19 puntos pedidos en la Fase 8A, sección 3):
 *
 *  1. campaign existe y pertenece a organization       → leerCampana()
 *  2. campaign en estado válido para ejecución          → campaign.status
 * 11. campaign.templateId existe                        → campaign.templateId
 * 12. campaign.templateSnapshot existe                  → campaign.templateSnapshot
 * 13-14. template existe y pertenece a organization     → leerTemplate()
 * 15. template.status === "approved"                    → template.status
 *  3. recipient existe                                  → leerRecipient()
 *  4-5. recipient pertenece a campaign/organization      → recipient.campaignId + scoped()
 *  6. recipient.status === "pending"                     → recipient.status
 *  7-8. contact existe y pertenece a organization        → leerContact()
 *  9. contact tiene phone o waUserId                     → contact.phone/waUserId
 * 10. contact.marketingOptOut === false                  → contact.marketingOptOut
 * 17-18-19. job existe, pertenece al recipient, ejecutable → leerJob()
 * 16-17. exactamente 1 recipient y 1 job en la campaña   → contarDestinatariosYJobsDeCampana()
 *
 * Nunca usa `LIMIT 1` para decidir "cuál" recipient/job — todos los
 * `LIMIT 1` de este archivo acotan por PK/UNIQUE ya conocido (el
 * `recipientId`/`campaignId` explícitos que el llamador aportó), nunca
 * eligen "el primero de varios candidatos". La cantidad TOTAL real
 * (`contarDestinatariosYJobsDeCampana`, sin `LIMIT`) es la única fuente
 * de verdad para "exactamente 1".
 */
export async function precheckPrimerEnvioControlado(input: {
  organizationId: string;
  campaignId: string;
  recipientId: string;
}): Promise<PrecheckPrimerEnvio> {
  const db = getDb();

  // --- campaign (puntos 1, 2, 11, 12) ---
  const campanas = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, input.organizationId, eq(schema.campaign.id, input.campaignId)))
    .limit(1);
  const campana = campanas[0];
  if (!campana) throw new EjecucionControladaError("not_found", "Campaña no encontrada en esta organización");
  if (!campana.templateId) {
    throw new EjecucionControladaError("invalid", "La campaña no tiene una plantilla asignada");
  }
  if (!campana.templateSnapshot) {
    throw new EjecucionControladaError("invalid", "La campaña no tiene snapshot congelado");
  }
  // Único estado "válido para ejecución controlada": es al que
  // `activarCampanaParaPruebaControlada()` (Fase 7B) deja la campaña tras
  // READY_TO_SEND. Cualquier otro (ready/paused/completed/failed/cancelled)
  // significa que el flujo de preparación no terminó, o que ya se cerró.
  if (campana.status !== "processing") {
    throw new EjecucionControladaError(
      "invalid_transition",
      `Campaña ${input.campaignId}: debe estar en "processing" para ejecutar el envío controlado (estado actual: "${campana.status}")`
    );
  }

  // --- template vivo (puntos 13, 14, 15) ---
  const plantillas = await db
    .select({ status: schema.template.status })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, input.organizationId, eq(schema.template.id, campana.templateId)))
    .limit(1);
  const plantilla = plantillas[0];
  if (!plantilla) throw new EjecucionControladaError("not_found", "La plantilla de la campaña ya no existe");
  if (plantilla.status !== "approved") {
    throw new EjecucionControladaError(
      "invalid",
      `La plantilla viva ya no está aprobada (estado actual: "${plantilla.status}")`
    );
  }

  // --- recipient (puntos 3, 4, 5, 6) ---
  const recipientes = await db
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      status: schema.campaignRecipient.status,
      contactId: schema.campaignRecipient.contactId,
    })
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
  if (!recipiente) throw new EjecucionControladaError("not_found", "Recipient no encontrado en esta organización");
  if (recipiente.campaignId !== input.campaignId) {
    throw new EjecucionControladaError(
      "mismatch",
      `El recipient ${input.recipientId} no pertenece a la campaña ${input.campaignId}`
    );
  }
  // Barrera de estado (Fase 8A, sección 6): SOLO "pending" permite intentar
  // ejecución. sent/skipped/failed/sending/indeterminado/cualquier otro
  // abortan aquí, ANTES de tocar al proveedor — es también la protección
  // contra doble ejecución (sección 9): tras un envío exitoso o un fallo
  // definitivo, el recipient nunca vuelve a "pending" para este mismo job.
  if (recipiente.status !== "pending") {
    throw new EjecucionControladaError(
      "already_processed",
      `El recipient ${input.recipientId} no está "pending" (estado actual: "${recipiente.status}") — ` +
        `ya se ejecutó, está en curso, o quedó en un estado que exige revisión manual. No se reintenta automáticamente.`
    );
  }

  // --- contact (puntos 7, 8, 9, 10) ---
  const contactos = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, recipiente.contactId)))
    .limit(1);
  const contacto = contactos[0];
  if (!contacto) throw new EjecucionControladaError("not_found", "Contacto no encontrado en esta organización");
  if (!contacto.phone && !contacto.waUserId) {
    throw new EjecucionControladaError("invalid", "El contacto no tiene teléfono ni identificador de WhatsApp");
  }
  // Barrera de opt-out (Fase 8A, sección 5) — PRIMERA de dos: esta NO
  // reemplaza la revalidación que el worker (`resolverTrabajoTomado`) hace
  // de nuevo, justo antes del proveedor, tras el claim. Ambas se mantienen.
  if (contacto.marketingOptOut) {
    throw new EjecucionControladaError("opt_out", "El contacto tiene opt-out de marketing");
  }

  // --- job (puntos 17, 18, 19) ---
  const jobs = await db
    .select({
      id: schema.campaignSendJob.id,
      campaignId: schema.campaignSendJob.campaignId,
      status: schema.campaignSendJob.status,
    })
    .from(schema.campaignSendJob)
    .where(
      scoped(
        schema.campaignSendJob.organizationId,
        input.organizationId,
        eq(schema.campaignSendJob.recipientId, input.recipientId)
      )
    )
    .limit(1);
  const job = jobs[0];
  if (!job) throw new EjecucionControladaError("not_found", "No existe campaign_send_job para este recipient");
  if (job.campaignId !== input.campaignId) {
    throw new EjecucionControladaError("mismatch", `El job ${job.id} no pertenece a la campaña ${input.campaignId}`);
  }
  if (job.status !== "pendiente") {
    throw new EjecucionControladaError(
      "already_processed",
      `El job ${job.id} no está "pendiente" (estado actual: "${job.status}")`
    );
  }

  // --- barrera de único destinatario (puntos 16, 17) ---
  // Nunca LIMIT 1 para decidir: se cuenta el TOTAL real de la campaña.
  const { recipients, jobs: totalJobs } = await contarDestinatariosYJobsDeCampana(
    input.organizationId,
    input.campaignId
  );
  if (recipients !== 1 || totalJobs !== 1) {
    throw new EjecucionControladaError(
      "multiple_candidates",
      `Campaña ${input.campaignId}: debe tener exactamente 1 destinatario y 1 job para ejecutar el envío ` +
        `controlado (tiene ${recipients} recipient(s), ${totalJobs} job(s))`
    );
  }

  const telefonoParaMostrar = contacto.phone ?? contacto.waUserId ?? "(sin teléfono)";

  return {
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    recipientId: input.recipientId,
    campaignStatus: campana.status,
    recipientStatus: recipiente.status,
    jobId: job.id,
    jobStatus: job.status,
    contactId: contacto.id,
    contactName: contacto.name,
    telefonoEnmascarado: enmascararTelefono(telefonoParaMostrar),
    templateId: campana.templateId,
    templateName: campana.templateSnapshot.name,
    templateLanguage: campana.templateSnapshot.language,
    snapshotBody: campana.templateSnapshot.body,
    totalRecipients: recipients,
    totalJobs,
  };
}

export type ResultadoEjecucionPrimerEnvio = {
  precheck: PrecheckPrimerEnvio;
  resultado: ResultadoEnvioControlado;
};

/**
 * EJECUCIÓN (Fase 8A, sección 10): precheck → BARRERA FINAL (el mismo
 * precheck, revalidado fresco — sección 13, nunca confía en el resultado
 * ya calculado arriba) → única llamada real al proveedor, exclusivamente
 * vía `procesarUnEnvioControladoDeCampana()` — reutilizada tal cual, sin
 * duplicar su lógica ni sus locks. El proveedor SIEMPRE se recibe
 * inyectado: este módulo nunca importa YCloud/Meta/`enviarTemplateAlProveedor`
 * directamente, y nunca lo llama durante el precheck.
 *
 * Sin bucles, sin reintentos propios — la semántica de retry/ambiguous
 * sigue siendo exclusivamente la del motor ya existente
 * (`registrarFalloEnvioDeCampana`/recovery), sin tocar aquí.
 */
export async function ejecutarPrimerEnvioControlado(input: {
  organizationId: string;
  campaignId: string;
  recipientId: string;
  proveedor: ProveedorDeEnvio;
  rateLimit?: { windowMs: number; max: number };
  timeoutMs?: number;
}): Promise<ResultadoEjecucionPrimerEnvio> {
  const precheck = await precheckPrimerEnvioControlado({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    recipientId: input.recipientId,
  });

  // Barrera final (Fase 8A, sección 13): revalida TODO de nuevo, fresco,
  // inmediatamente antes de la única llamada real al proveedor. No
  // sustituye los locks del worker (el claim con FOR UPDATE SKIP LOCKED
  // sigue ocurriendo, sin cambios, dentro de procesarUnEnvioControladoDeCampana).
  await precheckPrimerEnvioControlado({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    recipientId: input.recipientId,
  });

  const resultado = await procesarUnEnvioControladoDeCampana({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    recipientId: input.recipientId,
    proveedor: input.proveedor,
    rateLimit: input.rateLimit,
    timeoutMs: input.timeoutMs,
  });

  return { precheck, resultado };
}

export type ResumenPostEjecucion = {
  recipientStatus: string;
  messageId: string | null;
  waMessageId: string | null;
  jobsRestantes: number;
  campaignStatus: string;
};

/**
 * Solo lectura, solo para reporte operativo (el script la usa para
 * imprimir EXECUTION) — nunca decide nada, nunca se usa dentro de
 * `ejecutarPrimerEnvioControlado()`.
 */
export async function leerResumenPostEjecucion(input: {
  organizationId: string;
  campaignId: string;
  recipientId: string;
}): Promise<ResumenPostEjecucion> {
  const db = getDb();

  const recipientes = await db
    .select({ status: schema.campaignRecipient.status, messageId: schema.campaignRecipient.messageId })
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

  let waMessageId: string | null = null;
  if (recipiente?.messageId) {
    const mensajes = await db
      .select({ waMessageId: schema.message.waMessageId })
      .from(schema.message)
      .where(scoped(schema.message.organizationId, input.organizationId, eq(schema.message.id, recipiente.messageId)))
      .limit(1);
    waMessageId = mensajes[0]?.waMessageId ?? null;
  }

  const jobsRestantes = await db
    .select({ id: schema.campaignSendJob.id })
    .from(schema.campaignSendJob)
    .where(
      scoped(
        schema.campaignSendJob.organizationId,
        input.organizationId,
        eq(schema.campaignSendJob.campaignId, input.campaignId)
      )
    );

  const campanas = await db
    .select({ status: schema.campaign.status })
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, input.organizationId, eq(schema.campaign.id, input.campaignId)))
    .limit(1);

  return {
    recipientStatus: recipiente?.status ?? "desconocido",
    messageId: recipiente?.messageId ?? null,
    waMessageId,
    jobsRestantes: jobsRestantes.length,
    campaignStatus: campanas[0]?.status ?? "desconocido",
  };
}

export type ArgsEjecutor = {
  organization?: string;
  campaign?: string;
  recipient?: string;
  ejecutar: boolean;
};

/**
 * Parseo de argumentos del script operativo (Fase 8A, sección 11) —
 * definido aquí, no en `scripts/ejecutar-primer-envio-controlado.ts`, para
 * poder testearlo de forma aislada sin ejecutar el resto del script (que
 * carga variables de entorno y termina el proceso con `process.exit`). Sin
 * efectos secundarios: pura función de `string[]` a `ArgsEjecutor`.
 *
 * Rechaza explícitamente CUALQUIER flag no reconocido — nunca lo ignora en
 * silencio — precisamente para que `--all`/`--limit`/`--batch`/`--contacts`/
 * `--tag` (o cualquier otro) no puedan colarse sin que el operador se entere.
 */
export function parseArgs(argv: string[]): ArgsEjecutor {
  const out: ArgsEjecutor = { ejecutar: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--organization") out.organization = argv[++i];
    else if (arg === "--campaign") out.campaign = argv[++i];
    else if (arg === "--recipient") out.recipient = argv[++i];
    else if (arg === "--ejecutar") out.ejecutar = true;
    else if (arg?.startsWith("--")) {
      throw new Error(
        `Argumento no reconocido: "${arg}". Este ejecutor SOLO acepta --organization/--campaign/--recipient ` +
          `[--ejecutar] — nunca selección de múltiples destinatarios.`
      );
    }
  }
  return out;
}
