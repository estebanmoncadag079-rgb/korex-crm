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
