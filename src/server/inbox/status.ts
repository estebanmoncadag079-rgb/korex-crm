import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import type { WebhookStatus } from "@/server/inbox/webhook";

/**
 * Fase 10H — resuelve a qué organización pertenece un mensaje SALIENTE por
 * su `waMessageId` (columna `UNIQUE` a nivel de toda la tabla, no por
 * organización — confirmado en `schema.ts`). Existe porque el webhook de
 * YCloud para delivery status (`whatsapp.message.updated`) no siempre trae
 * de forma confiable el mismo `wabaId`/número de negocio que los demás
 * eventos (no confirmado contra un ejemplo completo de la documentación,
 * Fase 10A/10H: "no asumir payloads") — resolver por el propio mensaje,
 * que SÍ es inequívoco, evita depender de eso.
 */
export async function organizationIdDeMensaje(waMessageId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.message.organizationId })
    .from(schema.message)
    .where(eq(schema.message.waMessageId, waMessageId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

/** Orden monotónico de estados: nunca degradar (un delivered tardío no pisa read). */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export function isUpgrade(current: string, next: string): boolean {
  if (next === "failed") return current !== "failed";
  const c = STATUS_RANK[current];
  const n = STATUS_RANK[next];
  if (c === undefined || n === undefined) return false;
  return n > c;
}

export async function applyStatusUpdate(
  organizationId: string,
  status: WebhookStatus
): Promise<void> {
  const next = status.status;
  if (!(next in STATUS_RANK) && next !== "failed") return; // estado desconocido

  const db = getDb();
  const rows = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      status: schema.message.status,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.waMessageId, status.id)
      )
    )
    .limit(1);
  const msg = rows[0];
  if (!msg) return;
  if (!isUpgrade(msg.status, next)) return;

  const error =
    next === "failed"
      ? (status.errors?.[0]?.message ??
        status.errors?.[0]?.title ??
        "Envío fallido")
      : null;

  await db
    .update(schema.message)
    .set({ status: next as MessageStatus, error })
    .where(eq(schema.message.id, msg.id));

  // Fase 10H — si este mensaje es el resultado de un envío de campaña,
  // anota CUÁNDO se confirmó delivered/read. Nunca toca `campaignRecipient
  // .status` (sigue significando únicamente "el proveedor aceptó el
  // envío", ver `estados.ts`) — son timestamps aparte, mismo criterio ya
  // documentado en el schema.
  if (next === "delivered" || next === "read") {
    await db
      .update(schema.campaignRecipient)
      .set(next === "delivered" ? { deliveredAt: new Date() } : { readAt: new Date() })
      .where(
        and(
          eq(schema.campaignRecipient.organizationId, organizationId),
          eq(schema.campaignRecipient.messageId, msg.id)
        )
      );
  }

  publish(organizationId, {
    type: "message.status",
    data: {
      conversationId: msg.conversationId,
      messageId: msg.id,
      status: next,
    },
  });
}
