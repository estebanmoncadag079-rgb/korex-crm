import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook de YCloud (proveedor oficial WhatsApp Business API).
 * Módulo puro (sin BD) para testeo unitario. Frontera de entrada desde YCloud.
 */

/** Comparación timing-safe de strings de longitud arbitraria. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verifica la firma HMAC-SHA256 del header `YCloud-Signature` (formato `t=..,s=..`).
 * Firma sobre `${t}.${rawBody}`.
 *
 * Sin secreto la capa queda desactivada: cómodo para probar antes de fijarlo en
 * YCloud, pero **en producción eso es aceptar cualquier evento sin firmar**.
 * Bastaría un POST a la URL del webhook para meter mensajes falsos en la
 * bandeja de un negocio y hacer que su WhatsApp conteste a quien sea. Por eso
 * en producción se falla CERRADO: sin secreto no se acepta nada. Un webhook que
 * deja de entregar se nota enseguida; uno que acepta de cualquiera, no.
 */
export function verifyYcloudSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const t = parts["t"];
  const s = parts["s"];
  if (!t || !s) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");
  return safeEqual(s, expected);
}

/* ---------- Payload de YCloud (subconjunto: mensaje entrante de WhatsApp) ---------- */

/** Adjunto de WhatsApp: image, audio, video, document y sticker comparten forma. */
type YcloudMedia = {
  id?: string;
  /** Enlace de descarga de YCloud (requiere X-API-Key pasados unos minutos). */
  link?: string;
  mime_type?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
};

export type YcloudEvent = {
  id?: string;
  type?: string;
  /**
   * Eco de un mensaje enviado desde la APP de WhatsApp Business del negocio
   * (coexistencia). Sin esto, cuando el dueño responde desde su celular el CRM
   * no se entera y el agente le contesta encima al mismo cliente.
   */
  whatsappMessage?: {
    wamid?: string;
    id?: string;
    wabaId?: string;
    from?: string; // número del negocio
    to?: string; // número del cliente
    /**
     * Business-Scoped User ID del cliente cuando usa nombre de usuario de
     * WhatsApp (sin teléfono expuesto). Verificado en vivo: viene en vez de
     * `to`, nunca junto a él.
     */
    toUserId?: string;
    sendTime?: string;
    createTime?: string;
    type?: string;
    // En el eco `text` llega como string plano; en el entrante como objeto.
    text?: string | { body?: string };
    image?: YcloudMedia;
    document?: YcloudMedia;
    video?: YcloudMedia;
    audio?: YcloudMedia;
  };
  whatsappInboundMessage?: {
    id?: string;
    wabaId?: string;
    from?: string; // número del cliente (E.164, con +)
    /**
     * Business-Scoped User ID (formato "CO.xxxx…"): lo que manda YCloud EN
     * VEZ de `from` cuando el cliente tiene nombre de usuario de WhatsApp
     * activado (función lanzada por Meta en 2026, oculta el teléfono a los
     * negocios). Confirmado con el payload completo en producción el
     * 2-ago-2026 — nunca vienen los dos juntos.
     */
    fromUserId?: string;
    to?: string; // número del negocio
    customerProfile?: { name?: string; username?: string };
    sendTime?: string; // ISO 8601
    type?: string; // "text", "image", ...
    text?: { body?: string };
    image?: YcloudMedia;
    audio?: YcloudMedia;
    video?: YcloudMedia;
    document?: YcloudMedia;
    sticker?: YcloudMedia;
    /**
     * Cuando el cliente edita un mensaje de texto reciente, `type` llega
     * como "edit" y `text` viene vacío — el texto nuevo real viaja aquí.
     * Confirmado con el payload completo en producción el 3-ago-2026 (Lis
     * Pastelería): `edit.message.text.body` trae la corrección tal cual.
     */
    edit?: {
      originalMessageId?: string;
      message?: { type?: string; text?: { body?: string } };
    };
  };
};

export type ParsedInbound = {
  id: string;
  wabaId: string;
  /** Uno de los dos SIEMPRE está presente (lo exige `parseYcloudInbound`). */
  from: string | null; // sin "+", consistente con wa_id de Meta
  waUserId: string | null;
  to: string;
  name: string | null;
  type: string;
  text: string | null;
  unixTs: string; // segundos unix como string (lo que espera el ingest)
  /** Adjunto: el enlace se descarga desde el servidor con la API key. */
  mediaUrl: string | null;
  mediaId: string | null;
  mimeType: string | null;
};

const stripPlus = (n: string) => n.replace(/^\+/, "");

/** Mensaje que el negocio envió desde su celular (no por el CRM). */
export type ParsedEcho = {
  waMessageId: string;
  wabaId: string;
  businessPhone: string; // quien lo envió: el número del negocio
  /** Uno de los dos SIEMPRE está presente. */
  customerPhone: string | null;
  customerWaUserId: string | null;
  type: string;
  text: string | null;
  unixTs: string;
  mediaUrl: string | null;
  mediaId: string | null;
  mimeType: string | null;
};

export function parseYcloudEcho(event: YcloudEvent): ParsedEcho | null {
  const m = event.whatsappMessage;
  const waMessageId = m?.wamid ?? m?.id;
  if (!m || !waMessageId || (!m.to && !m.toUserId)) return null;

  const media = m.image ?? m.document ?? m.video ?? m.audio ?? null;
  const text =
    typeof m.text === "string" ? m.text : (m.text?.body ?? media?.caption ?? null);
  const iso = m.sendTime ?? m.createTime;
  const ms = iso ? Date.parse(iso) : Date.now();

  return {
    waMessageId,
    wabaId: m.wabaId ?? "",
    businessPhone: stripPlus(m.from ?? ""),
    customerPhone: m.to ? stripPlus(m.to) : null,
    customerWaUserId: m.to ? null : (m.toUserId ?? null),
    type: m.type ?? "text",
    text,
    unixTs: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
    mediaUrl: media?.link ?? null,
    mediaId: media?.id ?? null,
    mimeType: media?.mime_type ?? media?.mimeType ?? null,
  };
}

/** Extrae el mensaje entrante del evento; null si no es procesable. */
export function parseYcloudInbound(event: YcloudEvent): ParsedInbound | null {
  const m = event.whatsappInboundMessage;
  if (!m?.id || !m.wabaId || (!m.from && !m.fromUserId)) return null;
  const ms = m.sendTime ? Date.parse(m.sendTime) : Date.now();
  const media = m.image ?? m.document ?? m.video ?? m.audio ?? m.sticker ?? null;
  /**
   * Edición de un mensaje de texto: el cliente corrigió lo que escribió.
   * Se trata como un mensaje de texto normal (dispara al agente con el
   * contenido real) en vez de como un tipo "edit" sin texto — antes de esto
   * el agente veía un marcador de "no compatible" y podía confundirse.
   */
  const editedText = m.type === "edit" ? (m.edit?.message?.text?.body ?? null) : null;
  return {
    id: m.id,
    wabaId: m.wabaId,
    from: m.from ? stripPlus(m.from) : null,
    waUserId: m.from ? null : (m.fromUserId ?? null),
    to: stripPlus(m.to ?? ""),
    name: m.customerProfile?.name ?? null,
    type: editedText ? "text" : (m.type ?? "text"),
    // El pie de foto es el texto del mensaje (un comprobante suele traer nota).
    text: m.text?.body ?? editedText ?? media?.caption ?? media?.filename ?? null,
    unixTs: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
    mediaUrl: media?.link ?? null,
    mediaId: media?.id ?? null,
    mimeType: media?.mime_type ?? media?.mimeType ?? null,
  };
}
