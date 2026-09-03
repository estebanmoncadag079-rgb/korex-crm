import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { aprobarCampana, CampanaError, campanaErrorStatus } from "@/server/campaigns/motor";
import { serializeCampana } from "@/server/campaigns/consultas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const cuerpo = z.object({ organizationId: z.string().trim().min(1) });

/** Fase 10I — SOLO superadmin: `pending_approval → ready`. */
export const POST = withPlatformAdmin(async (session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  try {
    const campana = await aprobarCampana(body.data.organizationId, id, `user:${session.userId}`);
    return Response.json({ campaign: serializeCampana(campana) });
  } catch (err) {
    if (err instanceof CampanaError) return apiError(campanaErrorStatus(err), err.code, err.message);
    throw err;
  }
});
