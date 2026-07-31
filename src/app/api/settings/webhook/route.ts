import { withPlatformAdmin } from "@/lib/api";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Datos del webhook para pegar en Meta (FR-043). **Solo la agencia.**
 *
 * Estuvo abierto a cualquier usuario con sesión y devolvía en claro el
 * `META_WEBHOOK_VERIFY_TOKEN`, que es **único para toda la instalación** y es
 * el segmento secreto que protege `POST /api/webhooks/wa/<token>`. Con él, el
 * empleado de un negocio cliente podía inyectar mensajes falsos en la bandeja
 * de OTRO negocio y hacer que el WhatsApp de ese otro respondiera a un número
 * elegido por él.
 *
 * La pantalla que lo consume (`/settings/whatsapp`) ya era exclusiva de la
 * agencia: cerrar el endpoint no le quita nada a nadie, solo alinea el permiso
 * de la API con el de su única pantalla.
 */
export const GET = withPlatformAdmin(async () => {
  const env = getEnv();
  const url = `${env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`;
  return Response.json({
    url,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    isHttps: url.startsWith("https://"),
    signatureLayer: Boolean(env.META_APP_SECRET),
  });
});
