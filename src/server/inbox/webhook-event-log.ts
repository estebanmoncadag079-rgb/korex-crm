import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Captura del webhook ANTES de cualquier parseo de negocio (Fase 0 de la
 * revisión de arquitectura, 3-ago-2026). El INSERT ocurre primero; solo
 * después se procesa el evento. Si el INSERT falla, el llamador responde
 * 5xx — no hay nada guardado, así que es correcto pedirle al proveedor que
 * reintente. Si el INSERT sale bien pero el procesamiento falla, el evento
 * ya está a salvo en la tabla (status='fallido' + error) en vez de perderse
 * en un log que rota.
 */
export async function recordWebhookEvent(input: {
  source: string;
  rawBody: string;
  headers: Record<string, string>;
  signature: string | null;
  /** Cuando ya se conoce de antemano (puerta propia de un cliente). */
  organizationId?: string | null;
}): Promise<{ id: string; payload: unknown }> {
  const db = getDb();
  let payload: unknown = null;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    // No es JSON válido: se guarda igual en rawBody, payload queda null.
  }
  const id = newId("webhookEvent");
  await db.insert(schema.webhookEvent).values({
    id,
    source: input.source,
    rawBody: input.rawBody,
    payload,
    headers: input.headers,
    signature: input.signature,
    organizationId: input.organizationId ?? null,
  });
  return { id, payload };
}

export async function markWebhookEventProcessed(
  id: string,
  organizationId: string | null
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.webhookEvent)
    .set({ status: "procesado", organizationId, processedAt: new Date() })
    .where(eq(schema.webhookEvent.id, id));
}

export async function markWebhookEventFailed(
  id: string,
  error: unknown
): Promise<void> {
  const db = getDb();
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(schema.webhookEvent)
    .set({
      status: "fallido",
      error: message.slice(0, 2000),
      attempts: sql`${schema.webhookEvent.attempts} + 1`,
    })
    .where(eq(schema.webhookEvent.id, id));
}

/** Intentos de procesamiento antes de dejar el evento quieto para siempre. */
export const MAX_INTENTOS_WEBHOOK = 5;

/**
 * Reintenta los eventos que se guardaron bien pero fallaron al procesarse
 * (8-ago-2026).
 *
 * La Fase 0 del 3-ago dejó de perder eventos, que era lo importante — pero
 * quedarse en `status='fallido'` sin que nadie los mirara significa que un
 * mensaje de un cliente real seguía sin contestarse: lo único que cambiaba es
 * que ahora había constancia. Esto cierra el círculo.
 *
 * Espera creciente por número de intentos (1 min, 4, 9, 16…) para no reintentar
 * en bucle contra una causa que no se ha arreglado, y tope de intentos para que
 * un evento roto de verdad no se reprocese eternamente.
 */
export async function reprocesarWebhooksFallidos(
  limite = 20
): Promise<number> {
  const db = getDb();
  const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");

  const pendientes = await db
    .select({
      id: schema.webhookEvent.id,
      payload: schema.webhookEvent.payload,
      source: schema.webhookEvent.source,
      attempts: schema.webhookEvent.attempts,
    })
    .from(schema.webhookEvent)
    .where(
      sql`${schema.webhookEvent.status} = 'fallido'
          AND ${schema.webhookEvent.payload} IS NOT NULL
          AND ${schema.webhookEvent.attempts} < ${MAX_INTENTOS_WEBHOOK}
          AND ${schema.webhookEvent.receivedAt} <
              now() - make_interval(secs => 60 * power(${schema.webhookEvent.attempts}, 2))`
    )
    .limit(limite);

  let reprocesados = 0;
  for (const evento of pendientes) {
    try {
      // `source` es "agencia" o el organizationId de la puerta propia.
      const esperada =
        evento.source === "agencia" ? undefined : evento.source;
      const { organizationId } = await handleYcloudEvent(
        evento.payload as Parameters<typeof handleYcloudEvent>[0],
        esperada ? { expectOrganizationId: esperada } : undefined
      );
      await markWebhookEventProcessed(evento.id, organizationId);
      reprocesados += 1;
    } catch (err) {
      await markWebhookEventFailed(evento.id, err);
    }
  }
  return reprocesados;
}
