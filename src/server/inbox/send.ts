import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, resolveRecipient } from "@/lib/meta/client";
import {
  isYcloudEnabled,
  ycloudSendDocument,
  ycloudSendImage,
  ycloudSendInteractive,
  ycloudSendText,
} from "@/lib/ycloud/client";
import { textoPlanoDeMenu } from "@/server/catalog/menu";
import type { MenuInteractivo } from "@/server/catalog/menu";
import { publish } from "@/server/events/bus";
import { registrarEnvioWhatsappConCosto } from "@/server/pricing/rates";
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
   * con su `waUserId` — YCloud lo acepta como destinatario, pero en un campo
   * DISTINTO al de un teléfono (`recipient`, no `to`: ver `RecipientTarget`
   * en @/lib/meta/client). Nunca inventar ni pedir un teléfono para esto.
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
      to: to.value,
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
   *
   * Fase 10C — costo REAL: un mensaje de texto libre es "service" (mismo
   * criterio que Meta usa desde el 1-oct-2026, `docs/korexia/153`). Sin
   * tarifa cargada en `pricing_rate` para ese país/proveedor, el costo se
   * anota en 0 — nunca se inventa un número.
   */
  const providerEnvio: "ycloud" | "graph" = clientApiKey || isYcloudEnabled() ? "ycloud" : "graph";
  await registrarEnvioWhatsappConCosto({
    organizationId: input.organizationId,
    tipo: "text",
    ref: waMessageId,
    provider: providerEnvio,
    category: "service",
    phone: to.kind === "phone" ? to.value : row.contact.phone,
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

/**
 * Envía una FOTO con su pie de texto.
 *
 * Paralela a `sendText` y con sus mismas guardas (conversación de prueba,
 * ventana de 24 h, credenciales, destinatario por teléfono o por BSUID). Se
 * escribió aparte en vez de refactorizar `sendText` a propósito: aquella es la
 * ruta por la que sale CADA respuesta a CADA cliente, y tocarla para añadir un
 * caso nuevo es arriesgar lo que ya funciona por comodidad.
 *
 * **Solo por YCloud.** El camino de Meta directo (`callGraphSend`) no se
 * implementa porque ningún cliente lo usa hoy; si alguno vuelve, saltará este
 * error en vez de mandar algo a medias.
 */
/**
 * Lo que `sendImage` y `sendDocument` necesitan comprobar por igual antes de
 * mandar cualquier archivo: que la conversación exista y sea de esta
 * organización, que no sea del Laboratorio (FR-031), que la ventana de 24 h
 * siga abierta, que haya credenciales de WhatsApp y un destinatario, y que
 * haya por dónde mandarlo (hoy, solo YCloud).
 */
async function prepararEnvioDeMedia(
  conversationId: string,
  organizationId: string,
  tipoParaError: string
): Promise<{
  contact: typeof schema.contact.$inferSelect;
  to: NonNullable<ReturnType<typeof resolveRecipient>>;
  credentials: Credentials;
  clientApiKey: string | undefined;
}> {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.organizationId !== organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  // Misma aserción dura que en sendText (FR-031): una conversación del
  // Laboratorio jamás llega a la API real.
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

  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  const to = resolveRecipient(row.contact);
  if (!to) {
    throw new SendError(
      "meta_error",
      "El contacto no tiene teléfono ni identificador de WhatsApp"
    );
  }

  const clientApiKey = ycloudApiKeyOf(credentials);
  if (!clientApiKey && !isYcloudEnabled()) {
    throw new SendError(
      "meta_error",
      `El envío de ${tipoParaError} solo está disponible por YCloud`
    );
  }

  return { contact: row.contact, to, credentials, clientApiKey };
}

/** Registra el mensaje saliente y publica el evento — igual para foto y documento. */
async function registrarEnvioDeMedia(input: {
  organizationId: string;
  conversationId: string;
  waMessageId: string;
  type: "image" | "document";
  text: string;
  mediaUrl: string;
  aiGenerated?: boolean;
  /** Fase 10C — para resolver el costo real (`calcularCostoWhatsapp`). Media solo se envía por YCloud (ver `prepararEnvioDeMedia`). */
  phone: string | null;
}): Promise<SendResult> {
  const db = getDb();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: input.waMessageId,
      direction: "out",
      type: input.type,
      text: input.text,
      mediaUrl: input.mediaUrl,
      status: "pending",
      aiGenerated: input.aiGenerated ?? false,
    })
    .returning();
  const message = inserted[0]!;

  await registrarEnvioWhatsappConCosto({
    organizationId: input.organizationId,
    tipo: input.type,
    ref: input.waMessageId,
    provider: "ycloud",
    category: "service",
    phone: input.phone,
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

  return { messageId: message.id };
}

export async function sendImage(input: {
  conversationId: string;
  organizationId: string;
  /** URL pública https. Meta la descarga desde ahí. */
  link: string;
  caption?: string;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  const { to, contact, credentials, clientApiKey } = await prepararEnvioDeMedia(
    input.conversationId,
    input.organizationId,
    "fotos"
  );

  let waMessageId: string;
  try {
    waMessageId = await ycloudSendImage({
      from: credentials.displayPhoneNumber ?? "",
      to,
      link: input.link,
      caption: input.caption,
      apiKey: clientApiKey,
    });
  } catch (err) {
    throw new SendError(
      "meta_error",
      err instanceof Error ? err.message : "Error enviando la foto por YCloud"
    );
  }

  return registrarEnvioDeMedia({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId,
    type: "image",
    // El pie queda como texto del mensaje para que la bandeja muestre algo
    // legible: una fila vacía con "image" no le dice nada a quien la lee.
    text: input.caption ?? "[foto]",
    mediaUrl: input.link,
    aiGenerated: input.aiGenerated,
    phone: contact.phone,
  });
}

/**
 * Envía un menú interactivo (lista o botones que el cliente toca) — el
 * arranque guiado de un negocio con `menu_mode='guiado'` (25-ago-2026).
 * Mismas guardas que `sendImage`/`sendDocument`: conversación de prueba
 * prohibida, ventana de 24 h, solo YCloud.
 */
export async function sendInteractiveMenu(input: {
  conversationId: string;
  organizationId: string;
  menu: MenuInteractivo;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  const { to, contact, credentials, clientApiKey } = await prepararEnvioDeMedia(
    input.conversationId,
    input.organizationId,
    "menús interactivos"
  );

  let waMessageId: string;
  try {
    waMessageId = await ycloudSendInteractive({
      from: credentials.displayPhoneNumber ?? "",
      to,
      menu: input.menu,
      apiKey: clientApiKey,
    });
  } catch (err) {
    throw new SendError(
      "meta_error",
      err instanceof Error ? err.message : "Error enviando el menú por YCloud"
    );
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "interactive",
      text: textoPlanoDeMenu(input.menu),
      status: "pending",
      aiGenerated: input.aiGenerated ?? false,
    })
    .returning();
  const message = inserted[0]!;

  await registrarEnvioWhatsappConCosto({
    organizationId: input.organizationId,
    tipo: "interactive",
    ref: waMessageId,
    provider: "ycloud",
    category: "service",
    phone: contact.phone,
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

  return { messageId: message.id };
}

/**
 * Envía un documento: un catálogo en PDF, cuando lo que pide el cliente son
 * varios diseños a la vez y no un producto suelto. Mismo camino que
 * `sendImage` — la URL pública que YCloud descarga —, con `filename` porque
 * un documento necesita nombre de archivo en la burbuja del chat.
 */
export async function sendDocument(input: {
  conversationId: string;
  organizationId: string;
  /** URL pública https. Meta la descarga desde ahí. */
  link: string;
  /** Cómo se llama el archivo en la burbuja del chat, con extensión. */
  filename: string;
  caption?: string;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  const { to, contact, credentials, clientApiKey } = await prepararEnvioDeMedia(
    input.conversationId,
    input.organizationId,
    "documentos"
  );

  let waMessageId: string;
  try {
    waMessageId = await ycloudSendDocument({
      from: credentials.displayPhoneNumber ?? "",
      to,
      link: input.link,
      filename: input.filename,
      caption: input.caption,
      apiKey: clientApiKey,
    });
  } catch (err) {
    throw new SendError(
      "meta_error",
      err instanceof Error ? err.message : "Error enviando el documento por YCloud"
    );
  }

  return registrarEnvioDeMedia({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId,
    type: "document",
    text: input.caption ?? `[documento: ${input.filename}]`,
    mediaUrl: input.link,
    aiGenerated: input.aiGenerated,
    phone: contact.phone,
  });
}
