import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { appointmentsEnabledFor, updateService } from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  durationMin: z.number().int().min(5).max(600).optional(),
  /** true = archivar (deja de ofrecerse; el historial de citas no se toca). */
  archived: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const { archived, ...rest } = body.data;
  const service = await updateService(session.organizationId, id, {
    ...rest,
    ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
  });
  if (!service) return apiError(404, "not_found", "Servicio no encontrado");
  return Response.json({ service });
});
