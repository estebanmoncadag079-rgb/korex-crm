import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { CampanaError, campanaErrorStatus, prepararCampana } from "@/server/campaigns/motor";
import { serializeCampana } from "@/server/campaigns/consultas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const cuerpo = z.object({ organizationId: z.string().trim().min(1) });

/**
 * Fase 10G — el camino DIRECTO `draft → ready`, sin pasar por aprobación
 * (el superadmin arma y prepara la campaña él mismo). Solo superadmin,
 * igual que toda escritura que cuesta dinero de la agencia (mismo
 * principio ya aplicado a plantillas/aprendizaje/Laboratorio).
 */
export const POST = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  try {
    const campana = await prepararCampana(body.data.organizationId, id);
    return Response.json({ campaign: serializeCampana(campana) });
  } catch (err) {
    if (err instanceof CampanaError) return apiError(campanaErrorStatus(err), err.code, err.message);
    throw err;
  }
});
