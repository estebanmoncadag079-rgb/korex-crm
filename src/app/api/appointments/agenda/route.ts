import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  horaAAmPm,
  normalizarFecha,
  utcAFechaHoraBogota,
} from "@/server/appointments/logic";
import {
  agendaDelDia,
  appointmentsEnabledFor,
  liberarAgenda,
  reasignarAgenda,
  type CitaDeAgenda,
  type ResultadoCascada,
} from "@/server/appointments/queries";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const schema = z.object({
  accion: z.enum(["ver", "reasignar", "liberar"]),
  staffId: z.string().min(1),
  /** DD/MM/AAAA o AAAA-MM-DD; se normaliza abajo. */
  fecha: z.string().min(1),
  /** Solo para "reasignar": a quién pasan las citas. */
  staffDestinoId: z.string().min(1).optional(),
});

/**
 * Cascada de agenda: mover el día completo de una especialista a otra, o
 * liberarlo. Herramienta de administración del negocio — la pide el personal
 * desde /appointments, no un cliente por chat.
 *
 * `accion: "ver"` es una vista previa que NO toca nada: devuelve a cuántas
 * clientas afectaría y a cuáles no se les puede avisar. Estas dos operaciones
 * no se deshacen solas, así que la interfaz enseña eso antes de confirmar.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const fecha = normalizarFecha(body.data.fecha);
  if (!fecha) {
    return apiError(422, "invalid", "Fecha inválida: usa DD/MM/AAAA");
  }
  const organizationId = session.organizationId;
  const { accion, staffId, staffDestinoId } = body.data;

  if (accion === "ver") {
    const citas = await agendaDelDia({ organizationId, staffId, fecha });
    return Response.json({ citas: citas.map(resumirCita) });
  }

  if (accion === "reasignar") {
    if (!staffDestinoId) {
      return apiError(422, "invalid", "Falta a quién le pasas las citas");
    }
    if (staffDestinoId === staffId) {
      return apiError(422, "invalid", "Es la misma persona");
    }
    const resultado = await reasignarAgenda({
      organizationId,
      staffOrigenId: staffId,
      staffDestinoId,
      fecha,
    });
    const avisos = await avisarACadaClienta(organizationId, resultado, "reasignada");
    return Response.json({ ...serializar(resultado), avisos });
  }

  const resultado = await liberarAgenda({ organizationId, staffId, fecha });
  const avisos = await avisarACadaClienta(organizationId, resultado, "cancelada");
  return Response.json({ ...serializar(resultado), avisos });
});

function resumirCita(c: CitaDeAgenda) {
  const { fecha, hora } = utcAFechaHoraBogota(c.startsAt);
  return {
    id: c.id,
    clienta: c.contactName,
    servicio: (c.serviceNames.length ? c.serviceNames : [c.serviceName]).join(" + "),
    fecha,
    hora: horaAAmPm(hora),
  };
}

function serializar(r: ResultadoCascada) {
  return {
    aplicadas: r.aplicadas.map(resumirCita),
    conflictos: r.conflictos.map((c) => ({ ...resumirCita(c.cita), motivo: c.motivo })),
  };
}

/**
 * Avisa a cada clienta de que su cita cambió.
 *
 * **Aquí muerde la ventana de 24 horas**: a quien no le haya escrito al
 * negocio en las últimas 24 h, WhatsApp no deja mandarle texto libre. No se
 * silencia el fallo — se devuelve la lista de a quién NO se pudo avisar, para
 * que el salón la llame. Con una plantilla de utilidad aprobada esto dejaría
 * de pasar (ver 19-CITAS.md).
 *
 * El aviso va después de mover la agenda a propósito: la cita ya está
 * cambiada en el CRM, y que falle un mensaje no puede deshacer eso.
 */
async function avisarACadaClienta(
  organizationId: string,
  resultado: ResultadoCascada,
  tipo: "reasignada" | "cancelada"
): Promise<{ avisadas: number; sinAvisar: { clienta: string; motivo: string }[] }> {
  const sinAvisar: { clienta: string; motivo: string }[] = [];
  let avisadas = 0;

  for (const cita of resultado.aplicadas) {
    const { fecha, hora } = utcAFechaHoraBogota(cita.startsAt);
    const nombreVisita = (cita.serviceNames.length ? cita.serviceNames : [cita.serviceName]).join(
      " + "
    );
    const texto =
      tipo === "cancelada"
        ? `¡Hola! 👋 Lamentamos avisarte que tuvimos que cancelar tu cita de *${nombreVisita}* del ${fecha} a las ${horaAAmPm(hora)}. Escríbenos por aquí y la reagendamos cuando te quede bien. ¡Disculpa las molestias!`
        : `¡Hola! 👋 Un cambio en tu cita de *${nombreVisita}* del ${fecha} a las ${horaAAmPm(hora)}: te atenderá otra persona del equipo, a la misma hora. Si prefieres cambiarla, escríbenos por aquí. ¡Te esperamos!`;
    try {
      const conversation = await getOrCreateConversation(organizationId, cita.contactId);
      await sendText({
        conversationId: conversation.id,
        organizationId,
        text: texto,
        aiGenerated: false,
      });
      avisadas++;
    } catch (err) {
      sinAvisar.push({
        clienta: cita.contactName,
        motivo:
          err instanceof SendError && err.code === "window_closed"
            ? "no ha escrito en 24 h: hay que llamarla"
            : err instanceof Error
              ? err.message
              : "error al enviar",
      });
    }
  }
  return { avisadas, sinAvisar };
}
