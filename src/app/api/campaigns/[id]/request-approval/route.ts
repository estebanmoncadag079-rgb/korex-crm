import { apiError, withAuth } from "@/lib/api";
import { CampanaError, campanaErrorStatus, solicitarAprobacionCampana } from "@/server/campaigns/motor";
import { serializeCampana } from "@/server/campaigns/consultas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Fase 10I — el CLIENTE pide aprobación: `draft → pending_approval`. El
 * cliente NO puede saltarse este paso para llegar directo a `ready`/enviar
 * — solo el superadmin puede aprobar (`/approve`) o iniciar la campaña.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  try {
    const campana = await solicitarAprobacionCampana(session.organizationId, id, `user:${session.userId}`);
    return Response.json({ campaign: serializeCampana(campana) });
  } catch (err) {
    if (err instanceof CampanaError) return apiError(campanaErrorStatus(err), err.code, err.message);
    throw err;
  }
});
