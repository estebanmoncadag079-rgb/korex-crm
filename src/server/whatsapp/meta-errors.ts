import { MetaApiError } from "@/lib/meta/client";
import { markReconnectRequired } from "@/server/whatsapp/credentials";

type MetaErrorCode = "reconnect_required" | "meta_unavailable" | "meta_error";

/**
 * Traduce un `MetaApiError` al error tipado del llamador (`SendError`,
 * `TemplateError`, …), marcando reconexión si el token venció.
 *
 * Antes esta clasificación estaba copiada en tres sitios (`send.ts`,
 * `templates.ts` x2) y ya habían divergido entre sí: `syncTemplates` no
 * distinguía `meta_error` de `meta_unavailable` (cualquier error no-auth caía
 * en "no disponible", incluso uno 4xx de Meta). Un error que no sea de Meta
 * se relanza tal cual — nunca se traga uno inesperado.
 */
export async function translateMetaError<E extends Error>(
  err: unknown,
  organizationId: string,
  make: (code: MetaErrorCode, message: string) => E
): Promise<never> {
  if (!(err instanceof MetaApiError)) throw err;
  if (err.isAuthError) {
    await markReconnectRequired(organizationId);
    throw make(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }
  if (err.status === 0 || err.status >= 500) {
    throw make("meta_unavailable", "Meta no está disponible ahora");
  }
  throw make("meta_error", err.message);
}
