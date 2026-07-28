import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getYcloudApiKey } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Tipos que el navegador puede mostrar en línea sin riesgo. */
const INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "video/mp4",
]);

/**
 * Sirve el adjunto de un mensaje (el comprobante de pago, sobre todo).
 *
 * El enlace del proveedor exige la API key de la cuenta, así que la descarga
 * ocurre AQUÍ: al navegador solo llega el archivo. El mensaje se busca con
 * `scoped`, de modo que un negocio jamás puede pedir el adjunto de otro
 * cambiando el id en la URL.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = getDb();
  const rows = await db
    .select({
      mediaUrl: schema.message.mediaUrl,
      mimeType: schema.message.mimeType,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        session.organizationId,
        eq(schema.message.id, id)
      )
    )
    .limit(1);

  const message = rows[0];
  if (!message?.mediaUrl) {
    return apiError(404, "not_found", "Ese mensaje no tiene archivo adjunto");
  }

  // El adjunto vive en la cuenta de YCloud por la que entró el mensaje: la del
  // propio cliente si trajo la suya, si no la de la agencia.
  const apiKey = await getYcloudApiKey(session.organizationId);
  let upstream: Response;
  try {
    upstream = await fetch(message.mediaUrl, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
    });
  } catch {
    return apiError(502, "unavailable", "No se pudo descargar el archivo");
  }

  if (!upstream.ok || !upstream.body) {
    // WhatsApp conserva los adjuntos un tiempo limitado; pasado ese plazo el
    // enlace muere y no hay forma de recuperarlo.
    return apiError(
      upstream.status === 404 ? 410 : 502,
      "unavailable",
      upstream.status === 404
        ? "El archivo ya no está disponible en WhatsApp (caducó)"
        : "No se pudo descargar el archivo"
    );
  }

  const contentType =
    upstream.headers.get("content-type") ||
    message.mimeType ||
    "application/octet-stream";

  return new Response(upstream.body, {
    headers: {
      "content-type": contentType,
      "content-disposition": INLINE_TYPES.has(contentType.split(";")[0]!.trim())
        ? "inline"
        : "attachment",
      // Privado: es contenido de un cliente, jamás en cachés compartidas.
      "cache-control": "private, max-age=3600",
    },
  });
});
