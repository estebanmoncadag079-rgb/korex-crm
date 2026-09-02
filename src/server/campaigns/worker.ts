import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { tieneOptOutDeMarketing } from "@/server/contacts";
import { SendError } from "@/server/inbox/send";
import { TemplateError, type ResultadoProveedor } from "@/server/whatsapp/templates";
import {
  reclamarTrabajoDeCampana,
  registrarEnvioExitosoDeCampana,
  registrarFalloEnvioDeCampana,
  type TrabajoDeCampanaTomado,
} from "@/server/campaigns/cola";
import { intentarCompletarCampana, pausarCampana } from "@/server/campaigns/motor";

/**
 * El worker de campañas (Fase 6A, cerrado en Fase 6C) — un envío por
 * llamada, orquestando las piezas ya construidas y validadas en fases
 * anteriores (claim/idempotencia de Fase 4, adaptador de Fase 5). Nada
 * nuevo se inventa aquí salvo la orquestación en sí.
 *
 * El proveedor se RECIBE, nunca se importa `enviarTemplateAlProveedor` (ni
 * YCloud/Meta) directamente — inyección de dependencia deliberada (punto 10
 * de la Fase 6A): en producción se le pasaría esa función real; en tests,
 * un mock controlado. Sin bandera global de "modo test" que pudiera dejar
 * producción en modo simulado por error.
 */
export type ProveedorDeEnvio = (input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  variable?: string;
  retry?: boolean;
  timeoutMs?: number;
  contentSnapshot: { name: string; language: string; body: string };
}) => Promise<ResultadoProveedor>;

/**
 * Timeout HTTP por defecto de un envío de campaña, cuando quien invoca
 * `procesarUnEnvioDeCampana` no pasa `timeoutMs` explícito (Fase 6C,
 * hallazgo #5 de la Fase 6B: antes no había ningún default, la llamada
 * quedaba sin límite). Valor OPERATIVO inicial — no representa un límite
 * oficial de YCloud, sin dato real de latencia en producción todavía;
 * ajustable cambiando esta constante. Debe mantenerse bien por debajo de
 * `HUERFANO_CAMPANA_TRAS_MS` (`recovery.ts`, 120 000 ms) para que un
 * timeout HTTP nunca se confunda con un huérfano — 15 000 ms deja un margen
 * de 8x.
 */
export const TIMEOUT_ENVIO_CAMPANA_MS = 15_000;

export type ResultadoDelWorker =
  | { outcome: "sin_trabajo" }
  | { outcome: "enviado"; messageId: string }
  | { outcome: "fallido"; retryable: boolean }
  | { outcome: "ambiguo" }
  | { outcome: "omitido_opt_out" }
  | { outcome: "rate_limited" }
  | { outcome: "campana_no_activa" }
  | { outcome: "reconexion_requerida" }
  | { outcome: "error_inesperado" };

/**
 * Devuelve el recipient (y su job) exactamente a donde estaban antes del
 * claim — solo válido cuando la llamada al proveedor NUNCA ocurrió (campaña
 * pausada, rate limit local, error de configuración detectado antes de
 * llamar). `sending → pending` ya es una transición automática permitida
 * (`estados.ts`); nunca se usa esto tras una llamada real al proveedor.
 *
 * Exportada (Fase 7B): el flujo de prueba controlada (`prueba-controlada.ts`)
 * la reutiliza tal cual para su propio caso de aborto — nunca se duplica.
 *
 * `postponeMs` (Fase 6C, hallazgo del rate limit en la Fase 6B, punto 10):
 * sin esto, el job vuelve disponible de inmediato — un rate limit
 * persistente podía producir un ciclo apretado de reclamar→bloquear→
 * revertir sin avanzar. Solo lo usa el camino de rate limit, con la propia
 * ventana configurada por el llamador (`opts.rateLimit.windowMs`) como
 * espera — nada inventado, ningún límite nuevo de YCloud.
 */
export async function revertirAPending(input: {
  organizationId: string;
  recipientId: string;
  jobId: string;
  postponeMs?: number;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.campaignRecipient)
      .set({ status: "pending", updatedAt: new Date() })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      );
    await tx
      .update(schema.campaignSendJob)
      .set({
        status: "pendiente",
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
        ...(input.postponeMs ? { runAt: new Date(Date.now() + input.postponeMs) } : {}),
      })
      .where(eq(schema.campaignSendJob.id, input.jobId));
  });
}

/**
 * Intenta cerrar `processing → completed` sin dejar que un fallo ahí tumbe
 * el resultado ya resuelto de este envío (Fase 6C, punto 8): un error al
 * intentar completar es una preocupación secundaria, nunca debe convertir
 * un "enviado" real en un "error_inesperado".
 */
async function intentarCompletarSilencioso(organizationId: string, campaignId: string): Promise<void> {
  try {
    await intentarCompletarCampana(organizationId, campaignId);
  } catch (err) {
    console.error(
      `[campaign-worker] error intentando completar la campaña ${campaignId} tras cerrar un trabajo:`,
      err
    );
  }
}

/** `sending → skipped` (opt-out detectado tras el claim) — cierra el job, igual que un envío exitoso: el historial vive en el recipient, no en la cola. */
async function marcarOmitidoPorOptOut(input: {
  organizationId: string;
  recipientId: string;
  jobId: string;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.campaignRecipient)
      .set({
        status: "skipped",
        error: "Omitido: el contacto tiene opt-out de marketing (revalidado tras el claim)",
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      );
    await tx.delete(schema.campaignSendJob).where(eq(schema.campaignSendJob.id, input.jobId));
  });
}

function esErrorDeReconexion(err: unknown): boolean {
  return (
    (err instanceof TemplateError && err.code === "reconnect_required") ||
    (err instanceof SendError && err.code === "reconnect_required")
  );
}

/**
 * Todo lo que ocurre DESPUÉS de tener un trabajo ya reclamado (evidencia de
 * intento ya persistida en `sending`) — validar campaña, opt-out,
 * conversación, rate limit, llamar al proveedor y persistir el resultado.
 *
 * Extraída de `procesarUnEnvioDeCampana` (Fase 7B) para que el flujo de
 * prueba controlada (`prueba-controlada.ts`) reutilice EXACTAMENTE esta
 * misma lógica de negocio, cambiando únicamente CÓMO se obtiene `tomado`
 * (claim global vs. claim acotado a una campaña) — nunca duplicándola.
 * `procesarUnEnvioDeCampana` es un wrapper delgado sobre esta función; su
 * comportamiento no cambió por este refactor.
 */
export async function resolverTrabajoTomado(
  tomado: TrabajoDeCampanaTomado,
  opts: {
    proveedor: ProveedorDeEnvio;
    /** Sin valor por defecto: fijar un límite real es decisión de quien despliegue el worker, no de esta función (Fase 6A, punto 11). */
    rateLimit?: { windowMs: number; max: number };
    timeoutMs?: number;
  }
): Promise<ResultadoDelWorker> {
  const db = getDb();

  /**
   * Validación de campaña (Fase 6A, punto 14): el claim ya deja evidencia
   * de intento (`sending`) atómicamente junto con la toma del job —
   * separar "tomar job" de "transición a sending" en dos pasos, con esta
   * validación en medio, rompería la garantía de idempotencia ya validada
   * en Fase 4D/4F. Se valida aquí, INMEDIATAMENTE después, y si la campaña
   * ya no está `processing` (pausada por un 401 anterior, cancelada, etc.)
   * se revierte sin haber llamado a ningún proveedor todavía.
   */
  const campanas = await db
    .select()
    .from(schema.campaign)
    .where(
      scoped(schema.campaign.organizationId, tomado.organizationId, eq(schema.campaign.id, tomado.campaignId))
    )
    .limit(1);
  const campana = campanas[0];
  if (
    !campana ||
    campana.status !== "processing" ||
    !campana.templateId ||
    !campana.templateSnapshot
  ) {
    // Fase 6C: sin snapshot congelado no hay fuente de verdad de contenido
    // que enviar — no debería ocurrir (`prepararCampana` siempre lo congela
    // antes de `ready`), pero se comprueba igual, defensivo.
    await revertirAPending(tomado);
    return { outcome: "campana_no_activa" };
  }

  const recipientes = await db
    .select({ contactId: schema.campaignRecipient.contactId, contactName: schema.contact.name })
    .from(schema.campaignRecipient)
    .innerJoin(schema.contact, eq(schema.campaignRecipient.contactId, schema.contact.id))
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        tomado.organizationId,
        eq(schema.campaignRecipient.id, tomado.recipientId)
      )
    )
    .limit(1);
  const recipiente = recipientes[0];
  if (!recipiente) {
    // Dato corrupto (no debería ocurrir: el claim ya lo validó) — fail-safe.
    await revertirAPending(tomado);
    return { outcome: "error_inesperado" };
  }

  // Segunda barrera de opt-out (Fase 6A, punto 7): nunca confiar solo en el
  // filtro que construyó la audiencia — puede haber cambiado desde entonces.
  if (await tieneOptOutDeMarketing(tomado.organizationId, recipiente.contactId)) {
    await marcarOmitidoPorOptOut(tomado);
    // El job de este recipient ya cerró para siempre (SKIPPED) — puede ser
    // el último trabajo activo de la campaña (Fase 6C, punto 8).
    await intentarCompletarSilencioso(tomado.organizationId, tomado.campaignId);
    return { outcome: "omitido_opt_out" };
  }

  const conversacion = await getOrCreateConversation(tomado.organizationId, recipiente.contactId);
  await db
    .update(schema.campaignRecipient)
    .set({ conversationId: conversacion.id, updatedAt: new Date() })
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        tomado.organizationId,
        eq(schema.campaignRecipient.id, tomado.recipientId)
      )
    );

  if (opts.rateLimit) {
    const limite = await checkRateLimit(`campaign_send:${tomado.organizationId}`, opts.rateLimit);
    if (!limite.allowed) {
      // Fase 6A, punto 15: NO es un fallo, NO se llama al proveedor — vuelve
      // a la cola para la siguiente oportunidad, sin penalizar el intento.
      // Fase 6C: pospone `run_at` la duración de la propia ventana
      // configurada, para no producir un ciclo apretado de reintento.
      await revertirAPending({ ...tomado, postponeMs: opts.rateLimit.windowMs });
      return { outcome: "rate_limited" };
    }
  }

  let resultado: ResultadoProveedor;
  try {
    resultado = await opts.proveedor({
      organizationId: tomado.organizationId,
      conversationId: conversacion.id,
      templateId: campana.templateId,
      variable: recipiente.contactName || undefined,
      retry: false,
      timeoutMs: opts.timeoutMs ?? TIMEOUT_ENVIO_CAMPANA_MS,
      // Fase 6C: contenido = snapshot congelado, nunca el `template` vivo —
      // `templateId` arriba sigue siendo solo identidad/estado ante Meta.
      contentSnapshot: {
        name: campana.templateSnapshot.name,
        language: campana.templateSnapshot.language,
        body: campana.templateSnapshot.body,
      },
    });
  } catch (err) {
    if (esErrorDeReconexion(err)) {
      // Fase 6A, punto 14: un error de reconexión detiene TODA la campaña,
      // no solo este recipient — el resto de destinatarios no se procesa
      // hasta que alguien reconecte el número y reanude manualmente.
      await pausarCampana(tomado.organizationId, tomado.campaignId);
      await revertirAPending(tomado);
      return { outcome: "reconexion_requerida" };
    }
    // Cualquier otra excepción de precondición (plantilla/conversación ya
    // no existen, etc.): problema de datos/configuración, no del
    // proveedor — se revierte sin marcar `failed` con una certeza que no
    // se tiene, y se deja constancia en el log del servidor.
    console.error(
      `[campaign-worker] error inesperado preparando el envío del recipient ${tomado.recipientId}:`,
      err
    );
    await revertirAPending(tomado);
    return { outcome: "error_inesperado" };
  }

  if (resultado.kind === "SUCCESS") {
    const registrado = await registrarEnvioExitosoDeCampana({
      jobId: tomado.jobId,
      recipientId: tomado.recipientId,
      organizationId: tomado.organizationId,
      conversationId: conversacion.id,
      waMessageId: resultado.waMessageId,
      text: resultado.renderedText,
    });
    // El job de este recipient cerró para siempre (SENT) — puede ser el
    // último trabajo activo de la campaña (Fase 6C, punto 8).
    await intentarCompletarSilencioso(tomado.organizationId, tomado.campaignId);
    return { outcome: "enviado", messageId: registrado.messageId };
  }

  if (resultado.kind === "EXPLICIT_FAILURE") {
    // Fase 6C: `retryable` viaja tal cual — `registrarFalloEnvioDeCampana`
    // (cola.ts) es la ÚNICA fuente de verdad de si esto reintenta o cierra
    // definitivo; el worker nunca duplica esa decisión.
    const { reintenta } = await registrarFalloEnvioDeCampana({
      jobId: tomado.jobId,
      recipientId: tomado.recipientId,
      organizationId: tomado.organizationId,
      errorProveedor: resultado.error,
      attempts: tomado.attempts,
      retryable: resultado.retryable,
    });
    if (!reintenta) {
      // Cierre definitivo (failed, no retryable o intentos agotados): el
      // job cerró para siempre, igual que un SUCCESS a estos efectos.
      await intentarCompletarSilencioso(tomado.organizationId, tomado.campaignId);
    }
    return { outcome: "fallido", retryable: resultado.retryable };
  }

  // AMBIGUOUS_FAILURE (Fase 6A, punto 13/16): nunca se reintenta dentro de
  // esta ejecución, y nunca se toca el recipient — queda en `sending`.
  // `rescatarHuerfanosDeCampana()` (ya implementada, sin modificar) es
  // quien, tras el timeout, lo pasa a `indeterminado`.
  return { outcome: "ambiguo" };
}

/**
 * Procesa EXACTAMENTE un envío de campaña, de punta a punta:
 *
 * claim (evidencia de intento) → campaña activa → opt-out → conversación →
 * rate limit → proveedor (inyectado) → persistencia del resultado.
 *
 * Nunca llama al proveedor más de una vez por ejecución, y `retry: false`
 * siempre — la única fuente de reintento es esta misma función, llamada de
 * nuevo más tarde por quien la invoque en bucle (fuera de alcance aquí).
 */
export async function procesarUnEnvioDeCampana(opts: {
  worker: string;
  proveedor: ProveedorDeEnvio;
  rateLimit?: { windowMs: number; max: number };
  timeoutMs?: number;
}): Promise<ResultadoDelWorker> {
  const tomado = await reclamarTrabajoDeCampana(opts.worker);
  if (!tomado) return { outcome: "sin_trabajo" };
  return resolverTrabajoTomado(tomado, opts);
}
