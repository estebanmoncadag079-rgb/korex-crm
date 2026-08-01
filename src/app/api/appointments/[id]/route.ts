import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  appointmentsEnabledFor,
  updateAppointmentStatus,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(["confirmada", "cancelada", "completada", "no_show"]),
});

/** El equipo confirma, cancela o marca una cita — el cliente lo hace por chat, esto es el panel. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const appointment = await updateAppointmentStatus(
    session.organizationId,
    id,
    body.data.status
  );
  if (!appointment) return apiError(404, "not_found", "Cita no encontrada");
  return Response.json({ appointment });
});
