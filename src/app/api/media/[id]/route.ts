import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Sirve una foto guardada, para que WhatsApp pueda descargarla.
 *
 * ⚠️ **Esta ruta es PÚBLICA, y tiene que serlo**: al enviar una imagen por la
 * API de WhatsApp no se manda el archivo, se manda una URL que **Meta descarga
 * desde sus servidores**. Meta no tiene sesión ni cookies, así que cualquier
 * protección por login dejaría al cliente sin ver la foto.
 *
 * Qué la protege entonces:
 *
 *  - **El id es un `nanoid` aleatorio**, no un número correlativo: no se puede
 *    recorrer el catálogo de nadie probando `/api/media/1`, `/2`, `/3`.
 *  - **Solo hay aquí lo que el negocio quiere enseñar**: fotos de sus productos
 *    y su carta. Nada de comprobantes de pago ni de imágenes de clientes, que
 *    siguen viviendo en YCloud y no pasan por esta tabla.
 *
 * Dicho de otro modo: es tan pública como la foto de un menú pegada en la
 * puerta del local. Lo que NO debe entrar aquí nunca es nada privado.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const db = getDb();
  const filas = await db
    .select({
      mimeType: schema.mediaAsset.mimeType,
      datos: schema.mediaAsset.datos,
    })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.id, id))
    .limit(1);

  const foto = filas[0];
  if (!foto) return new Response("No encontrada", { status: 404 });
  // Un recurso que solo es un enlace no tiene bytes que servir: no existe como
  // archivo, y decirlo con un 404 es más honesto que devolver un cuerpo vacío
  // que Meta interpretaría como una descarga rota.
  if (!foto.datos || !foto.mimeType) {
    return new Response("No encontrada", { status: 404 });
  }

  const bytes = Buffer.from(foto.datos, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": foto.mimeType,
      "Content-Length": String(bytes.length),
      // Un año: la foto de un producto no cambia, y si cambia se sube otra con
      // id nuevo. Que Meta y los navegadores la cacheen ahorra descargas.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
