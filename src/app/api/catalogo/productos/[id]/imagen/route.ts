import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  eliminarImagenDeProducto,
  guardarImagenDeProducto,
  obtenerImagenDeProducto,
} from "@/server/catalog/imagenes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cuerpo = z
  .object({
    base64: z.string().min(1),
    mimeType: z.string().min(1),
  })
  .strict();

/** La imagen vinculada al producto `id`, si la hay. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const imagen = await obtenerImagenDeProducto(session.organizationId, id);
  return Response.json({ imagen });
});

/** Sube o reemplaza la imagen del producto `id` — misma etiqueta que su nombre real. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const resultado = await guardarImagenDeProducto(
    session.organizationId,
    id,
    body.data,
    `user:${session.userId}`
  );
  if (!resultado.ok) {
    // Mismo 404 silencioso que el resto del catálogo (grupos, opciones): no
    // distingue "no existe" de "es de otro cliente".
    if (resultado.motivo === "producto_no_encontrado") {
      return apiError(404, "not_found", "Producto no encontrado");
    }
    // 409: el archivo está bien, lo que choca es el nombre — ya hay otro
    // recurso (la carta, una foto del local) llamado igual que el producto.
    if (resultado.motivo === "etiqueta_ocupada") {
      return apiError(409, "etiqueta_ocupada", resultado.mensaje);
    }
    return apiError(415, "tipo_no_soportado", "El archivo debe ser JPG, PNG o WEBP.");
  }
  return Response.json({ id: resultado.id }, { status: 201 });
});

/**
 * Quita la imagen del producto `id`, si la tiene.
 *
 * `accion` dice qué pasó DE VERDAD con el archivo: `eliminada` (nadie más lo
 * usaba) o `desvinculada` (una campaña o una plantilla sigue usándolo, así
 * que se conservó). El producto se queda sin imagen en los dos casos — la
 * diferencia solo importa para decírselo a quien lo pulsó, en vez de darle un
 * "borrada" que no sería cierto.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const resultado = await eliminarImagenDeProducto(session.organizationId, id);
  return Response.json(resultado);
});
