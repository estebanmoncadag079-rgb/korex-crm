import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticación en dos capas del webhook (contrato webhook.md / DV-VC-02).
 * Este módulo es puro (sin BD) para poder testearse unitariamente.
 */

/** Comparación timing-safe de strings de longitud arbitraria. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Capa 1: el segmento de la ruta debe coincidir con el verify token. */
export function isValidWebhookToken(
  segment: string,
  verifyToken: string
): boolean {
  return verifyToken.length > 0 && safeEqual(segment, verifyToken);
}

/**
 * Capa 2: firma HMAC-SHA256 de Meta sobre el body CRUDO.
 *
 * Sin `META_APP_SECRET` esta capa queda desactivada y la única defensa de
 * `/api/webhooks/wa/<token>` es el token de la URL — que es el mismo para toda
 * la instalación. En producción se falla CERRADO: quien conozca el token no
 * debe poder, además, inyectar eventos de cualquier negocio sin firmarlos.
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret) return process.env.NODE_ENV !== "production";
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

/* ---------- Tipos del payload de Meta (subconjunto soportado) ---------- */

export type WebhookMessage = {
  /**
   * Opcional a propósito: si Meta alguna vez omite el remitente (p. ej. el
   * mismo caso de nombres de usuario de WhatsApp que ya se ve en YCloud, ver
   * `ycloud-webhook.ts`), el tipo no debe fingir que siempre está — sin esto,
   * `processMessagesValue` intentaría crear un contacto sin identificador y
   * reventaría con una excepción sin capturar en vez de descartar el mensaje
   * con un aviso. Hoy solo YCloud sirve el tráfico real, así que este camino
   * está dormido, pero el tipo debe seguir siendo honesto.
   */
  from?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
};

export type WebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
  errors?: { code: number; title?: string; message?: string }[];
};

export type WebhookValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
  // message_template_status_update
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  message_template_id?: number | string;
  reason?: string | null;
};

export type WebhookChange = { field?: string; value?: WebhookValue };

export type WebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: WebhookChange[] }[];
};
