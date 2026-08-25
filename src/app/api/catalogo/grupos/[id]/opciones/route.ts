import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { crearOpcion, listarOpciones } from "@/server/catalog/opciones";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Las opciones del grupo `id`, de ESTA organización. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const opciones = await listarOpciones(session.organizationId, id);
  return Response.json({ opciones });
});

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(100),
    precioDeltaCents: z.number().int().optional(),
  })
  .strict();

/** Crea una opción (un topping, un tamaño) dentro del grupo `id`. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const opcion = await crearOpcion(session.organizationId, id, body.data, `user:${session.userId}`);
  if (!opcion) return apiError(404, "not_found", "Grupo de opciones no encontrado");
  return Response.json({ opcion }, { status: 201 });
});
