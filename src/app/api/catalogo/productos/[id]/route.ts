import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { actualizarProducto, archivarProducto } from "@/server/catalog/productos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(200).optional(),
    categoria: z.string().max(100).nullable().optional(),
    precioCents: z.number().int().min(0).nullable().optional(),
    disponible: z.boolean().optional(),
  })
  .strict();

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const producto = await actualizarProducto(
    session.organizationId,
    id,
    body.data,
    `user:${session.userId}`
  );
  // Mismo 404 para "no existe" y "es de otro cliente": ver nota de grupos/[id].
  if (!producto) return apiError(404, "not_found", "Producto no encontrado");
  return Response.json({ producto });
});

/** Archiva el producto — nunca se borra de verdad (ver `archivarProducto`). */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await archivarProducto(session.organizationId, id, `user:${session.userId}`);
  if (!ok) return apiError(404, "not_found", "Producto no encontrado");
  return Response.json({ archivado: true });
});
