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
    to?: string; // número del negocio
    customerProfile?: { name?: string };
    sendTime?: string; // ISO 8601
    type?: string; // "text", "image", ...
    text?: { body?: string };
    image?: YcloudMedia;
    audio?: YcloudMedia;
    video?: YcloudMedia;
    document?: YcloudMedia;
    sticker?: YcloudMedia;
  };
};

export type ParsedInbound = {
  id: string;
  wabaId: string;
  from: string; // sin "+", consistente con wa_id de Meta
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
  customerPhone: string; // a quién
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
  if (!m || !waMessageId || !m.to) return null;

  const media = m.image ?? m.document ?? m.video ?? m.audio ?? null;
  const text =
    typeof m.text === "string" ? m.text : (m.text?.body ?? media?.caption ?? null);
  const iso = m.sendTime ?? m.createTime;
  const ms = iso ? Date.parse(iso) : Date.now();

  return {
    waMessageId,
    wabaId: m.wabaId ?? "",
    businessPhone: stripPlus(m.from ?? ""),
    customerPhone: stripPlus(m.to),
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
  if (!m?.id || !m.wabaId || !m.from) return null;
  const ms = m.sendTime ? Date.parse(m.sendTime) : Date.now();
  const media = m.image ?? m.document ?? m.video ?? m.audio ?? m.sticker ?? null;
  return {
    id: m.id,
    wabaId: m.wabaId,
    from: stripPlus(m.from),
    to: stripPlus(m.to ?? ""),
    name: m.customerProfile?.name ?? null,
    type: m.type ?? "text",
    // El pie de foto es el texto del mensaje (un comprobante suele traer nota).
    text: m.text?.body ?? media?.caption ?? media?.filename ?? null,
    unixTs: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
    mediaUrl: media?.link ?? null,
    mediaId: media?.id ?? null,
    mimeType: media?.mime_type ?? media?.mimeType ?? null,
  };
}
