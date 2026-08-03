import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, resolveRecipient } from "@/lib/meta/client";
import { isYcloudEnabled, ycloudSendText } from "@/lib/ycloud/client";
import { publish } from "@/server/events/bus";
import { registrarUsoWhatsapp } from "@/server/usage";
import { getCredentialsByOrg, type Credentials } from "@/server/whatsapp/credentials";
import { translateMetaError } from "@/server/whatsapp/meta-errors";
import { isWindowOpen } from "@/server/inbox/window";
import { serializeMessage } from "@/server/inbox/ingest";
import { avanzarLeadSilencioso } from "@/server/inbox/lead-activity";

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

/** Cómo mapea cada código de `SendError` al status HTTP de la API. */
const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 403,
  not_connected: 409,
  reconnect_required: 409,
  window_closed: 409,
  meta_error: 422,
  meta_unavailable: 503,
};

export function sendErrorStatus(err: SendError): number {
  return SEND_ERROR_STATUS[err.code];
}

type SendResult = { messageId: string };

/**
 * API key propia del cliente, si trajo su cuenta de YCloud. Se distingue por
 * `phoneNumberId` ("ycloud:<número>" lo pone `saveYcloudNumber`): en una
 * conexión de Meta directo ese mismo campo guarda el token de Graph, que no
 * sirve aquí.
 */
export function ycloudApiKeyOf(credentials: Credentials): string | undefined {
  if (!credentials.phoneNumberId.startsWith("ycloud:")) return undefined;
  return credentials.token.trim() || undefined;
}

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

  /**
   * Sin teléfono (cliente con nombre de usuario de WhatsApp), se responde
   * con su `waUserId` tal cual — YCloud/Meta lo aceptan como destinatario
   * igual que un teléfono (verificado en la documentación de Meta sobre
   * Business-Scoped User IDs). Nunca inventar ni pedir un teléfono para esto.
   */
  const to = resolveRecipient(row.contact);
  if (!to) {
    throw new SendError("meta_error", "El contacto no tiene teléfono ni identificador de WhatsApp");
  }
  const clientApiKey = ycloudApiKeyOf(credentials);
  let waMessageId: string;
  if (clientApiKey || isYcloudEnabled()) {
    // Envío por YCloud (proveedor oficial): from = número del negocio.
    try {
      waMessageId = await ycloudSendText({
        from: credentials.displayPhoneNumber ?? "",
        to,
        text: input.text,
        apiKey: clientApiKey,
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

  /**
   * Se anota el mensaje aunque hoy cueste 0: dentro de la ventana de 24 h Meta
   * no cobra las respuestas. Contarlos desde ahora es lo que permitirá saber
   * qué factura traerá octubre —cuando empiece a cobrarlos todos— con el
   * tráfico real de cada cliente en vez de con una suposición.
   */
  await registrarUsoWhatsapp({
    organizationId: input.organizationId,
    tipo: "text",
    ref: waMessageId,
  });

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

  // El negocio contestó: el lead deja de estar "nuevo" en el embudo. Va tras el
  // envío y aislado a propósito — el mensaje ya salió por WhatsApp y un fallo
  // moviendo una tarjeta jamás puede convertirse en un error de envío.
  if (await avanzarLeadSilencioso(input.organizationId, row.contact.id)) {
    publish(input.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: input.conversationId } },
    });
  }

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
    throw await translateMetaError(
      err,
      credentials.organizationId,
      (code, message) => new SendError(code, message)
    );
  }
}
