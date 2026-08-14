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
     * Business-Scoped User ID (formato "CO.xxxx…"): el identificador estable
     * que da Meta cuando el cliente tiene nombre de usuario de WhatsApp
     * activado (función lanzada en 2026, oculta el teléfono a los negocios).
     *
     * ⚠️ Aquí decía "nunca vienen los dos juntos", y era **falso**: medido el
     * 5-ago-2026 sobre los eventos reales de `webhook_event`, **98 de 99
     * traen `from` Y `fromUserId` a la vez**; solo 1 trajo el BSUID solo.
     * Por eso se guardan **las dos** señales siempre que lleguen: el día que
     * Meta deje de mandar `from` para alguien que ya escribía, el contacto se
     * reconoce por el BSUID en vez de nacer duplicado.
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
    /**
     * A qué está respondiendo el cliente. Llega de dos formas y la diferencia
     * importa (medido sobre 489 entrantes reales el 9-ago-2026: 40 de la
     * primera, 6 de la segunda):
     *
     * - **Con `id`**: cita un mensaje concreto del chat. Ese `id` es un wamid
     *   de los que ya guardamos en `message.wa_message_id`, así que el mensaje
     *   citado se puede recuperar y ponérselo delante al agente.
     * - **Sin `id`, solo `from`** (el número del propio negocio): responde a un
     *   **Estado**. El contenido de la historia NO llega y no hay forma de
     *   saber qué vio — solo que vio algo nuestro.
     *
     * Esto se descartaba entero. El agente recibía "Qué es eso tan ricón?" a
     * secas y rellenaba el hueco con lo más probable del negocio: le dijo a una
     * clienta que se refería a los cremosos cuando la historia era de un latte.
     */
    context?: { id?: string; from?: string };
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
  /** wamid del mensaje del chat que el cliente citó, si citó alguno. */
  replyToWamid: string | null;
  /** El cliente responde a un Estado del negocio (no llega qué había en él). */
  respondeAEstado: boolean;
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
    // Las dos señales, igual que en el entrante (`parseYcloudInbound`).
    customerWaUserId: m.toUserId ?? null,
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
    // Las DOS señales, no una: ver la nota de `fromUserId` arriba.
    waUserId: m.fromUserId ?? null,
    to: stripPlus(m.to ?? ""),
    name: m.customerProfile?.name ?? null,
    type: editedText ? "text" : (m.type ?? "text"),
    // El pie de foto es el texto del mensaje (un comprobante suele traer nota).
    text: m.text?.body ?? editedText ?? media?.caption ?? media?.filename ?? null,
    unixTs: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
    mediaUrl: media?.link ?? null,
    mediaId: media?.id ?? null,
    mimeType: media?.mime_type ?? media?.mimeType ?? null,
    replyToWamid: m.context?.id ?? null,
    // Hay contexto pero sin mensaje que citar: es una respuesta a un Estado.
    respondeAEstado: Boolean(m.context && !m.context.id),
  };
}

/* ============================================================
 * Historial de la coexistencia (14-ago-2026)
 * ============================================================ */

/**
 * Un mensaje del historial que WhatsApp sincroniza al conectar el número.
 *
 * Al activar la coexistencia, Meta manda **hasta 6 meses de chats anteriores**
 * y YCloud los reenvía como `whatsapp.smb.history`. Hasta ahora se ignoraban
 * (`[ycloud webhook] evento ignorado`), así que la conversación que el negocio
 * ya había tenido con sus clientas se perdía: ni el equipo la veía en la
 * bandeja, ni el aprendizaje podía sacar conocimiento de ella.
 *
 * Un mismo evento trae UNO de los dos lados: `whatsappInboundMessage` (lo que
 * escribió la clienta) o `whatsappMessage` (lo que respondió el negocio desde
 * su celular).
 */
export type ParsedHistory = {
  direction: "in" | "out";
  waMessageId: string;
  wabaId: string;
  businessPhone: string;
  customerPhone: string | null;
  customerWaUserId: string | null;
  profileName: string | null;
  type: string;
  text: string | null;
  unixTs: string;
};

export function parseYcloudHistory(event: YcloudEvent): ParsedHistory | null {
  const entrante = event.whatsappInboundMessage;
  const saliente = event.whatsappMessage;

  if (entrante) {
    const waMessageId = entrante.id;
    if (!waMessageId || (!entrante.from && !entrante.fromUserId)) return null;
    const media = entrante.image ?? entrante.document ?? entrante.video ?? entrante.audio ?? null;
    const text =
      typeof entrante.text === "string"
        ? entrante.text
        : (entrante.text?.body ?? media?.caption ?? null);
    const iso = entrante.sendTime;
    const ms = iso ? Date.parse(iso) : NaN;
    return {
      direction: "in",
      waMessageId,
      wabaId: entrante.wabaId ?? "",
      businessPhone: stripPlus(entrante.to ?? ""),
      customerPhone: entrante.from ? stripPlus(entrante.from) : null,
      customerWaUserId: entrante.fromUserId ?? null,
      profileName: entrante.customerProfile?.name ?? null,
      type: entrante.type ?? "text",
      text,
      unixTs: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
    };
  }

  if (saliente) {
    const waMessageId = saliente.wamid ?? saliente.id;
    if (!waMessageId || (!saliente.to && !saliente.toUserId)) return null;
    const media = saliente.image ?? saliente.document ?? saliente.video ?? saliente.audio ?? null;
    const text =
      typeof saliente.text === "string"
        ? saliente.text
        : (saliente.text?.body ?? media?.caption ?? null);
    const iso = saliente.sendTime ?? saliente.createTime;
    const ms = iso ? Date.parse(iso) : NaN;
    return {
      direction: "out",
      waMessageId,
      wabaId: saliente.wabaId ?? "",
      businessPhone: stripPlus(saliente.from ?? ""),
      customerPhone: saliente.to ? stripPlus(saliente.to) : null,
      customerWaUserId: saliente.toUserId ?? null,
      profileName: null,
      type: saliente.type ?? "text",
      text,
      unixTs: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
    };
  }

  return null;
}
