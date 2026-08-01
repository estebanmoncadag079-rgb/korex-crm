import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByPhoneNumberId,
  getYcloudApiKey,
} from "@/server/whatsapp/credentials";
import { transcribirAudio } from "@/server/ai/transcribir";
import type { WebhookValue } from "@/server/inbox/webhook";
import { applyStatusUpdate } from "@/server/inbox/status";
import { onLeadActivity, onLeadReplied } from "@/server/inbox/lead-activity";
import {
  clearHandoff,
  isReturnToAgentPhrase,
  markHumanTookOver,
  resumeReason,
} from "@/server/inbox/handoff-policy";
import { maybeRunAgentTurn } from "@/server/ai/trigger";

/** Tipos de contenido soportados; el resto se ignora sin error. */
const SUPPORTED_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
]);

export async function getOrCreateContact(
  organizationId: string,
  phone: string,
  name?: string | null
) {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      name: name?.trim() || phone,
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.phone],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, phone)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("contacto no encontrado tras upsert");

  // Reactivar si estaba archivado (el nombre editado por el operador se respeta).
  if (existing.archivedAt) {
    await db
      .update(schema.contact)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(schema.contact.id, existing.id));
    existing.archivedAt = null;
  }
  return { contact: existing, isNew: false };
}

export async function getOrCreateConversation(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const inserted = await db
    .insert(schema.conversation)
    .values({ id: newId("conversation"), organizationId, contactId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const rows = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("conversación no encontrada tras upsert");
  return existing;
}

/**
 * Procesa el `value` de un cambio `messages` del webhook: mensajes entrantes
 * (idempotentes por wa_message_id) y actualizaciones de estado.
 */
export async function processMessagesValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    // Caso típico: webhook/override configurado ANTES de guardar la conexión
    // en el wizard — el evento llega pero no hay a qué organización enrutarlo.
    console.warn(
      `[webhook] evento para phone_number_id desconocido (${phoneNumberId}): ` +
        "guarda la conexión en Configuración → WhatsApp para recibir mensajes"
    );
    return;
  }

  const organizationId = credentials.organizationId;

  for (const status of value.statuses ?? []) {
    await applyStatusUpdate(organizationId, status);
  }

  for (const msg of value.messages ?? []) {
    if (!SUPPORTED_TYPES.has(msg.type)) continue; // reacciones, etc.: ignorar
    const profileName = value.contacts?.find(
      (c) => c.wa_id === msg.from
    )?.profile?.name;
    await ingestInboundMessage({
      organizationId,
      from: msg.from,
      profileName: profileName ?? null,
      waMessageId: msg.id,
      type: msg.type,
      text: msg.text?.body ?? null,
      timestamp: msg.timestamp,
    });
  }
}

export async function ingestInboundMessage(
  input: {
    organizationId: string;
    from: string;
    profileName: string | null;
    waMessageId: string;
    type: string;
    text: string | null;
    timestamp: string;
    mediaUrl?: string | null;
    mediaId?: string | null;
    mimeType?: string | null;
  },
  opts?: { triggerAgent?: boolean }
): Promise<void> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await getOrCreateContact(
    organizationId,
    input.from,
    input.profileName
  );
  const conversation = await getOrCreateConversation(
    organizationId,
    contact.id
  );

  // El momento del mensaje ANTERIOR: con él se sabe si el cliente vuelve tras
  // un silencio largo (y el agente puede retomar) o si el equipo está
  // atendiendo ahora mismo (y no hay que interrumpirlo).
  const previousMessageAt = conversation.lastMessageAt;

  const waTimestamp = toDate(input.timestamp);

  /*
   * Una nota de voz se transcribe ANTES de guardarla, para que el texto viaje
   * dentro del propio mensaje. A partir de ahí todo lo demás funciona sin
   * enterarse de que era audio: el agente lo lee como si se lo hubieran
   * escrito, quien atienda a mano lo ve en la bandeja sin ponerse auriculares,
   * y entra en el aprendizaje y en los respaldos.
   *
   * Solo si el audio no trae ya un texto: WhatsApp no manda pie de foto en las
   * notas de voz, pero si algún día lo hiciera, mandaría lo que escribió la
   * persona.
   */
  let texto = input.text;
  if (input.type === "audio" && input.mediaUrl && !texto?.trim()) {
    const { texto: transcrito } = await transcribirAudio({
      organizationId,
      mediaUrl: input.mediaUrl,
      mimeType: input.mimeType,
      apiKey: await getYcloudApiKey(organizationId),
    });
    if (transcrito) texto = transcrito;
  }

  // Idempotencia dura: mismo wa_message_id → sin efectos adicionales.
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.waMessageId,
      direction: "in",
      type: input.type,
      text: texto,
      status: "delivered",
      mediaUrl: input.mediaUrl ?? null,
      mediaId: input.mediaId ?? null,
      mimeType: input.mimeType ?? null,
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  const message = inserted[0];
  if (!message) return; // duplicado

  await db
    .update(schema.conversation)
    .set({
      lastInboundAt: waTimestamp,
      lastMessageAt: waTimestamp,
      unreadCount: sql`${schema.conversation.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conversation.id));

  await onLeadActivity(organizationId, contact.id, waTimestamp);

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  // Modo observación: se ingiere y publica el mensaje, pero NO responde el agente.
  if (opts?.triggerAgent === false) return;

  // Conversación en manos de una persona: el agente solo vuelve si el cliente
  // lo pide con "0" o si nadie contestó en horas. Si no, silencio: dos voces
  // respondiendo a la vez es peor que una respuesta lenta.
  if (conversation.handoffAt) {
    const reason = resumeReason({
      handoffAt: conversation.handoffAt,
      text: input.text,
      lastMessageAt: previousMessageAt,
    });
    if (!reason) return;
    await clearHandoff(conversation.id, organizationId);
    console.info(
      `[agente] retoma la conversación ${conversation.id} por ${reason}`
    );
  }

  // Sin mensajes previos = el cliente acaba de saludar: se le responde sin la
  // espera de agrupación, que ahí solo se siente como demora.
  await maybeRunAgentTurn(conversation.id, {
    immediate: previousMessageAt === null,
  });
}

/**
 * Registra un mensaje que el negocio envió desde su CELULAR (coexistencia) y
 * cede el turno: si una persona está respondiendo por su cuenta, el agente
 * calla — si no, los dos le escriben al mismo cliente a la vez.
 *
 * Idempotente por `wa_message_id`: un eco repetido no vuelve a tocar el turno.
 */
export async function ingestOutboundEcho(input: {
  organizationId: string;
  toPhone: string;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
  mediaUrl?: string | null;
  mediaId?: string | null;
  mimeType?: string | null;
}): Promise<void> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await getOrCreateContact(organizationId, input.toPhone);
  const conversation = await getOrCreateConversation(organizationId, contact.id);
  const waTimestamp = toDate(input.timestamp);

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.waMessageId,
      direction: "out",
      type: input.type,
      text: input.text,
      // Ya salió por WhatsApp: nació entregado, no "pendiente".
      status: "sent",
      aiGenerated: false,
      mediaUrl: input.mediaUrl ?? null,
      mediaId: input.mediaId ?? null,
      mimeType: input.mimeType ?? null,
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  const message = inserted[0];
  if (!message) return; // eco duplicado: ya estaba registrado

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: waTimestamp, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  // Contestar desde el celular también arranca la conversación en el embudo.
  // Aislado: el eco ya quedó registrado y el relevo humano de abajo es lo que
  // de verdad importa de este webhook.
  try {
    await onLeadReplied(organizationId, contact.id);
  } catch (err) {
    console.error("[embudo] no se pudo avanzar el lead:", err);
  }

  // Mismo trato que si hubiera escrito desde la bandeja: toma la conversación,
  // salvo que esté devolviéndole el turno al agente.
  if (isReturnToAgentPhrase(input.text)) {
    await clearHandoff(conversation.id, organizationId);
  } else {
    await markHumanTookOver(conversation.id, organizationId);
  }
}

function toDate(timestamp: string): Date {
  const n = Number(timestamp);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

export function serializeMessage(m: typeof schema.message.$inferSelect) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    status: m.status,
    aiGenerated: m.aiGenerated,
    // El enlace del proveedor NO viaja al navegador: se sirve por /api/media.
    hasMedia: Boolean(m.mediaUrl),
    mimeType: m.mimeType,
    createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
  };
}
