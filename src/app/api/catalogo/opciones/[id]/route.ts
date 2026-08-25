import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { actualizarOpcion, eliminarOpcion } from "@/server/catalog/opciones";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(100).optional(),
    precioDeltaCents: z.number().int().optional(),
    disponible: z.boolean().optional(),
  })
  .strict();

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const opcion = await actualizarOpcion(
    session.organizationId,
    id,
    body.data,
    `user:${session.userId}`
  );
  if (!opcion) return apiError(404, "not_found", "Opción no encontrada");
  return Response.json({ opcion });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await eliminarOpcion(session.organizationId, id, `user:${session.userId}`);
  if (!ok) return apiError(404, "not_found", "Opción no encontrada");
  return Response.json({ eliminada: true });
});
