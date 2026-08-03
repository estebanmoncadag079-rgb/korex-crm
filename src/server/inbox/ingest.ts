import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByPhoneNumberId,
  getYcloudApiKey,
} from "@/server/whatsapp/credentials";
import { describirImagen, transcribirAudio } from "@/server/ai/transcribir";
import type { WebhookValue } from "@/server/inbox/webhook";
import { applyStatusUpdate } from "@/server/inbox/status";
import { avanzarLeadSilencioso, onLeadActivity } from "@/server/inbox/lead-activity";
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

/**
 * Un contacto SIEMPRE se identifica por uno de los dos, nunca por ninguno.
 * `waUserId` cubre a quien usa nombre de usuario de WhatsApp (sin teléfono
 * expuesto al negocio — función de Meta lanzada en 2026, verificada en vivo
 * el 2-ago-2026 cuando dos clientes reales llegaron así, en Lis y en La
 * Churra, y sus mensajes se perdían sin dejar rastro).
 */
export type ContactIdentifier = { phone: string | null; waUserId: string | null };

export async function getOrCreateContact(
  organizationId: string,
  identifier: ContactIdentifier,
  name?: string | null
) {
  const { phone, waUserId } = identifier;
  if (!phone && !waUserId) {
    throw new Error("getOrCreateContact: hace falta phone o waUserId");
  }
  const db = getDb();
  const displayFallback = phone ?? waUserId!;
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      waUserId,
      name: name?.trim() || displayFallback,
    })
    .onConflictDoNothing({
      // Sin teléfono, ese índice nunca choca (NULL no colisiona en Postgres):
      // hay que apuntar al de wa_user_id para no duplicar el contacto en cada
      // mensaje nuevo de la misma persona.
      target: phone
        ? [schema.contact.organizationId, schema.contact.phone]
        : [schema.contact.organizationId, schema.contact.waUserId],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        phone
          ? eq(schema.contact.phone, phone)
          : eq(schema.contact.waUserId, waUserId!)
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
    if (!msg.from) {
      // Meta-directo no propaga hoy un identificador alternativo (waUserId)
      // como sí hace YCloud: sin `from` no hay dónde guardar el mensaje.
      // Se descarta con aviso, nunca con una excepción sin capturar.
      console.warn(
        `[webhook] MENSAJE DESCARTADO: falta "from" (id=${msg.id}, type=${msg.type})`
      );
      continue;
    }
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
    /** Uno de los dos siempre está presente (ver `ContactIdentifier`). */
    from: string | null;
    waUserId?: string | null;
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
    { phone: input.from, waUserId: input.waUserId ?? null },
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
   * Audio e imagen se convierten a texto ANTES de guardarlos, para que el texto
   * viaje dentro del propio mensaje. A partir de ahí todo lo demás funciona sin
   * enterarse de que no era texto: el agente lo lee como si se lo hubieran
   * escrito, quien atienda a mano lo ve en la bandeja sin abrir el adjunto, y
   * entra en el aprendizaje y en los respaldos.
   */
  const texto = await mediaATexto(input, organizationId);
  const textoFinal = textoDeMensaje(texto, input.mediaUrl, input.type);

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
      text: textoFinal,
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
 * Marcador de texto para lo que llega sin texto NI adjunto — típico de un
 * `type: "unsupported"` (reaccionar o responder a un Estado a veces llega
 * así, verificado en vivo el 1-ago-2026). El mensaje SIEMPRE se guarda, pero
 * `toChatHistory` descarta cualquier fila sin texto al armar lo que ve el
 * agente: sin este marcador, quedaba invisible para la IA aunque el cliente
 * sí hubiera escrito algo. Con adjunto pero sin texto (imagen/audio cuya
 * conversión falló) se deja el `null` tal cual — comportamiento existente,
 * no se toca aquí.
 */
export function textoDeMensaje(
  texto: string | null,
  mediaUrl: string | null | undefined,
  type: string
): string | null {
  if (texto) return texto;
  if (mediaUrl) return null;
  return `[mensaje no compatible: tipo "${type}", revisa WhatsApp directamente]`;
}

/**
 * Convierte a texto lo que no vino escrito. Devuelve el texto original si no
 * hay nada que convertir o si el proveedor falla — nunca lanza.
 *
 * Las dos ramas se tratan distinto a propósito:
 *
 * - **Audio**: solo si el mensaje no trae ya texto. Una nota de voz no lleva
 *   pie, pero si algún día lo llevara sería lo que escribió la persona, y eso
 *   manda sobre cualquier transcripción.
 *
 * - **Imagen**: siempre, y el pie se CONSERVA delante. El caso normal es el
 *   comprobante de pago con un "listo" encima: quedarse con el pie sería
 *   quedarse justo sin lo que hay que mirar.
 */
async function mediaATexto(
  input: {
    organizationId: string;
    type: string;
    text: string | null;
    mediaUrl?: string | null;
    mimeType?: string | null;
  },
  organizationId: string
): Promise<string | null> {
  if (!input.mediaUrl) return input.text;
  const pie = input.text?.trim() || null;

  if (input.type === "audio" && !pie) {
    const { texto } = await transcribirAudio({
      organizationId,
      mediaUrl: input.mediaUrl,
      mimeType: input.mimeType,
      apiKey: await getYcloudApiKey(organizationId),
    });
    return texto ?? input.text;
  }

  if (input.type === "image") {
    const { texto } = await describirImagen({
      organizationId,
      mediaUrl: input.mediaUrl,
      mimeType: input.mimeType,
      apiKey: await getYcloudApiKey(organizationId),
    });
    if (!texto) return input.text;
    return pie ? `${pie}\n${texto}` : texto;
  }

  return input.text;
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
  /** Uno de los dos siempre está presente (ver `ContactIdentifier`). */
  toPhone: string | null;
  toWaUserId?: string | null;
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

  const { contact } = await getOrCreateContact(organizationId, {
    phone: input.toPhone,
    waUserId: input.toWaUserId ?? null,
  });
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
  await avanzarLeadSilencioso(organizationId, contact.id);

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
