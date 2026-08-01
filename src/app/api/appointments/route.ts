import { apiError, withAuth } from "@/lib/api";
import {
  appointmentsEnabledFor,
  listAppointments,
  type AppointmentStatus,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

const ESTADOS_VALIDOS: AppointmentStatus[] = [
  "pendiente",
  "confirmada",
  "reagendada",
  "cancelada",
  "completada",
  "no_show",
];

export const GET = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status = (ESTADOS_VALIDOS as string[]).includes(statusParam ?? "")
    ? (statusParam as AppointmentStatus)
    : undefined;

  const appointments = await listAppointments(session.organizationId, { status });
  return Response.json({ appointments });
});
