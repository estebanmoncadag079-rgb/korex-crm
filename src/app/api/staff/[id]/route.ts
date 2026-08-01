import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { appointmentsEnabledFor, updateStaff } from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** true = archivar (deja de asignarse a nuevas citas). */
  archived: z.boolean().optional(),
  serviceIds: z.array(z.string()).optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const { archived, ...rest } = body.data;
  const staff = await updateStaff(session.organizationId, id, {
    ...rest,
    ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
  });
  if (!staff) return apiError(404, "not_found", "Especialista no encontrada");
  return Response.json({ staff });
});
