import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  appointmentsEnabledFor,
  moverCita,
  updateAppointmentStatus,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Dos cosas distintas por la misma puerta: marcar el estado de la cita, o
 * MOVERLA de hora. Se distinguen por lo que llega — `status` o `fecha`+`hora`.
 */
const patchSchema = z.union([
  z.object({
    status: z.enum(["confirmada", "cancelada", "completada", "no_show"]),
  }),
  z.object({
    /** DD/MM/AAAA o AAAA-MM-DD: lo normaliza el motor. */
    fecha: z.string().min(8).max(10),
    /** HH:MM en 24 h. */
    hora: z.string().regex(/^\d{1,2}:\d{2}$/),
  }),
]);

/** El equipo confirma, cancela o marca una cita — el cliente lo hace por chat, esto es el panel. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  /*
   * Mover la cita pasa por el MISMO camino que usa el agente por WhatsApp
   * (`reprogramarCita`), así que hereda sus comprobaciones: no deja solapar con
   * otra cita de esa especialista, recalcula el final según la duración del
   * servicio y libera el hueco anterior.
   */
  if ("fecha" in body.data) {
    const r = await moverCita({
      organizationId: session.organizationId,
      appointmentId: id,
      nuevaFecha: body.data.fecha,
      nuevaHora: body.data.hora,
    });
    if (!r.ok) {
      const mensajes: Record<string, string> = {
        no_existe: "Esa cita ya no existe.",
        sin_horario: "Falta configurar el horario del negocio para poder mover citas.",
        sin_cupo:
          "A esa hora la especialista ya tiene otra cita (o el servicio no termina antes de cerrar).",
        fuera_de_horario: "Ese día u hora está fuera del horario de atención.",
      };
      return apiError(422, r.reason, mensajes[r.reason] ?? "No se pudo mover la cita.");
    }
    return Response.json({ ok: true });
  }

  const appointment = await updateAppointmentStatus(
    session.organizationId,
    id,
    body.data.status
  );
  if (!appointment) return apiError(404, "not_found", "Cita no encontrada");
  return Response.json({ appointment });
});
