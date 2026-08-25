import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { crearGrupo } from "@/server/catalog/grupos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(100),
    minimo: z.number().int().min(0).max(20),
    maximo: z.number().int().min(0).max(20),
  })
  .strict()
  .refine((d) => d.maximo >= d.minimo, {
    message: "el máximo no puede ser menor que el mínimo",
  });

/** Crea un grupo de opciones ("Toppings", "Tamaño") para el producto `id`. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const grupo = await crearGrupo(session.organizationId, id, body.data, `user:${session.userId}`);
  if (!grupo) return apiError(404, "not_found", "Producto no encontrado");
  return Response.json({ grupo }, { status: 201 });
});
