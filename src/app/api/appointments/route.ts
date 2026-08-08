import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { normalizarFecha } from "@/server/appointments/logic";
import {
  appointmentsEnabledFor,
  citasDelDia,
  crearCita,
  horarioDeLaOrganizacion,
  listAppointments,
  listServices,
  type AppointmentStatus,
} from "@/server/appointments/queries";
import { getOrCreateContact } from "@/server/inbox/ingest";
import { normalizarTelefonoCo } from "@/lib/utils";

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

  /**
   * `?fecha=AAAA-MM-DD` devuelve solo las de ese día.
   *
   * Lo usa el calendario. Sin esto tenía que filtrar en el navegador sobre la
   * lista general, que viene limitada a 200: al saltar a un día lejano podía
   * pintarlo vacío teniendo citas. Un día siempre cabe entero.
   */
  const fecha = normalizarFecha(url.searchParams.get("fecha") ?? "");
  if (fecha) {
    const appointments = await citasDelDia(session.organizationId, fecha);
    return Response.json({ appointments });
  }

  const appointments = await listAppointments(session.organizationId, { status });
  return Response.json({ appointments });
});

const nuevaCitaSchema = z.object({
  serviceId: z.string().min(1),
  /** Opcional: sin especialista, el motor elige una que atienda y esté libre. */
  staffId: z.string().min(1).optional(),
  /** DD/MM/AAAA o AAAA-MM-DD. */
  fecha: z.string().min(1),
  /** "HH:MM" en 24 h, hora de Bogotá. */
  hora: z.string().regex(/^\d{1,2}:\d{2}$/),
  clienteNombre: z.string().min(1).max(120),
  /** Colombiano en cualquier forma; se normaliza a E.164 sin "+". */
  clienteTelefono: z.string().min(7).max(20),
});

/**
 * Agendar una cita A MANO desde el panel.
 *
 * Hasta ahora las citas solo nacían por WhatsApp, y eso dejaba un agujero que
 * duele el primer día: la clienta que llama por teléfono, escribe por
 * Instagram o llega al local **no existía en la agenda**, así que el agente
 * daba ese hueco por libre y se lo ofrecía a otra.
 *
 * Pasa por el mismo `crearCita` que usa el agente: valida el horario del
 * negocio, que la especialista atienda ese servicio y que no haya solape. Que
 * lo escriba una persona no lo hace más fiable que el motor.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const body = await parseBody(req, nuevaCitaSchema);
  if (!body.ok) return body.response;
  const organizationId = session.organizationId;

  const fecha = normalizarFecha(body.data.fecha);
  if (!fecha) return apiError(422, "invalid", "Fecha inválida: usa DD/MM/AAAA");

  const telefono = normalizarTelefonoCo(body.data.clienteTelefono);
  if (!telefono) {
    return apiError(422, "invalid", "Teléfono inválido: escríbelo con indicativo o 10 dígitos");
  }

  const servicios = await listServices(organizationId);
  const servicio = servicios.find((s) => s.id === body.data.serviceId);
  if (!servicio) return apiError(404, "not_found", "Ese servicio no existe");

  const hours = await horarioDeLaOrganizacion(organizationId);
  if (!hours) return apiError(422, "invalid", "Falta configurar el perfil del agente");

  const { contact } = await getOrCreateContact(
    organizationId,
    { phone: telefono, waUserId: null },
    body.data.clienteNombre
  );

  const resultado = await crearCita({
    organizationId,
    contactId: contact.id,
    service: servicio,
    fecha,
    hora: body.data.hora,
    staffIdPreferido: body.data.staffId ?? null,
    hours,
  });

  if (!resultado.ok) {
    return apiError(
      409,
      resultado.reason,
      resultado.reason === "fuera_de_horario"
        ? "Ese día u hora está fuera del horario del negocio"
        : "Ese horario ya está ocupado para todas las que atienden ese servicio"
    );
  }

  return Response.json({
    ok: true,
    appointment: {
      id: resultado.appointment.id,
      staffName: resultado.staffName,
      startsAt: resultado.appointment.startsAt,
    },
  });
});
