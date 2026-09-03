import { apiError, withAuth } from "@/lib/api";
import { CampanaError, campanaErrorStatus, estimarCampanaActual } from "@/server/campaigns/motor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Fase 10F — "Paso 5: Estimación". Solo lectura, nunca transiciona ni escribe. */
export const GET = withAuth(async (session, _req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  try {
    const estimacion = await estimarCampanaActual(session.organizationId, id);
    return Response.json(estimacion);
  } catch (err) {
    if (err instanceof CampanaError) return apiError(campanaErrorStatus(err), err.code, err.message);
    throw err;
  }
});
