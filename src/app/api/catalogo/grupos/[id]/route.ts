import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { actualizarGrupo, eliminarGrupo } from "@/server/catalog/grupos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * `.strict()` no es celo: un cuerpo con un campo que este endpoint no conoce
 * tiene que fallar con un 422, no colarse ignorado — mismo principio que
 * cuando este endpoint solo dejaba tocar `permiteRepeticion`
 * ([94](../../../../../docs/korexia/94-BITACORA-PERMITE-REPETICION-CRM.md)).
 * Ahora la pantalla de catálogo completo también edita nombre y mínimo/máximo,
 * así que el conjunto permitido creció con ella — a propósito y declarado.
 */
const cuerpo = z
  .object({
    nombre: z.string().min(1).max(100).optional(),
    minimo: z.number().int().min(0).max(20).optional(),
    maximo: z.number().int().min(0).max(20).optional(),
    permiteRepeticion: z.boolean().optional(),
  })
  .strict();

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const grupo = await actualizarGrupo(
    session.organizationId,
    id,
    body.data,
    `user:${session.userId}`
  );
  // Mismo 404 para "no existe" y para "es de otro cliente": el WHERE va
  // filtrado por organización, así que un id ajeno no actualiza nada y
  // tampoco confirma que exista.
  if (!grupo) return apiError(404, "not_found", "Grupo de opciones no encontrado");
  return Response.json({ grupo });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await eliminarGrupo(session.organizationId, id, `user:${session.userId}`);
  if (!ok) return apiError(404, "not_found", "Grupo de opciones no encontrado");
  return Response.json({ eliminado: true });
});
