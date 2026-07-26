import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { isYcloudEnabled, ycloudSendText } from "@/lib/ycloud/client";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { isWindowOpen } from "@/server/inbox/window";
import { serializeMessage } from "@/server/inbox/ingest";

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable";

  constructor(code: SendError["code"], message: string) {
    super(message);
    this.name = "SendError";
    this.code = code;
  }
}

type SendResult = { messageId: string };

/**
 * Envía un mensaje de texto libre por WhatsApp.
 *
 * ASERCIÓN DURA (FR-031): una conversación de prueba del Laboratorio jamás
 * llega a la API real — se lanza ANTES de tocar credenciales o red.
 */
export async function sendText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  const db = getDb();

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(eq(schema.conversation.id, input.conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.organizationId !== input.organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  if (row.conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  if (!isWindowOpen(row.conversation.lastInboundAt)) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
  }

  const credentials = await getCredentialsByOrg(input.organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  const to = normalizeRecipient(row.contact.phone);
  let waMessageId: string;
  if (isYcloudEnabled()) {
    // Envío por YCloud (proveedor oficial): from = número del negocio.
    try {
      waMessageId = await ycloudSendText({
        from: credentials.displayPhoneNumber ?? "",
        to,
        text: input.text,
      });
    } catch (err) {
      throw new SendError(
        "meta_error",
        err instanceof Error ? err.message : "Error enviando por YCloud"
      );
    }
  } else {
    waMessageId = await callGraphSend(credentials, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: input.text },
    });
  }

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "text",
      text: input.text,
      status: "pending",
      aiGenerated: input.aiGenerated ?? false,
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id };
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${credentials.phoneNumberId}/messages`,
      { method: "POST", token: credentials.token, body: payload }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}
