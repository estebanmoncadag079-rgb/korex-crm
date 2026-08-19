import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { actualizarPermiteRepeticion } from "@/server/catalog/grupos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Lo ÚNICO que este paso deja cambiar de un grupo de opciones.
 *
 * `.strict()` no es celo: un cuerpo que traiga `minSelect`, `maxSelect` o un
 * precio tiene que fallar con un 422, no colarse ignorado. El día que el CRM
 * edite los mínimos será porque alguien lo añadió aquí a propósito y con su
 * prueba, no porque una pantalla mandara un campo de más.
 */
const cuerpo = z.object({ permiteRepeticion: z.boolean() }).strict();

/**
 * Cambiar si un grupo de opciones **admite repetir** la misma opción.
 *
 * Es el sustituto de `pnpm repeticion`: la misma decisión de negocio, tomada
 * desde el CRM por quien lleva el negocio y no por quien tiene acceso a la
 * base ([94](../../../../../docs/korexia/94-BITACORA-PERMITE-REPETICION-CRM.md)).
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const grupo = await actualizarPermiteRepeticion(
    session.organizationId,
    id,
    body.data.permiteRepeticion,
    `user:${session.userId}`
  );
  // Mismo 404 para "no existe" y para "es de otro cliente": el WHERE va
  // filtrado por organización, así que un id ajeno no actualiza nada — y esta
  // respuesta tampoco confirma que exista.
  if (!grupo) return apiError(404, "not_found", "Grupo de opciones no encontrado");
  return Response.json({ grupo });
});
