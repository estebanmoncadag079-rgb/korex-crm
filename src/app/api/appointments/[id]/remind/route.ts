import { apiError, withAuth } from "@/lib/api";
import { horaAAmPm, utcAFechaHoraBogota } from "@/server/appointments/logic";
import {
  appointmentsEnabledFor,
  getCitaParaRecordar,
  marcarCitaRecordada,
} from "@/server/appointments/queries";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError, sendErrorStatus, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Recordatorio de cita: lo dispara el personal con un botón en /appointments,
 * cuando ELLOS decidan — no hay ningún proceso automático que revise citas
 * próximas ni plantilla de WhatsApp involucrada. Por eso solo funciona si el
 * cliente le ha escrito al negocio en las últimas 24 h (texto libre); si no,
 * devuelve un error claro para que el personal sepa por qué no salió, en vez
 * de fallar en silencio.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const { id } = await ctx.params;

  const cita = await getCitaParaRecordar(session.organizationId, id);
  if (!cita) return apiError(404, "not_found", "Cita no encontrada");
  if (cita.status === "cancelada" || cita.status === "completada" || cita.status === "no_show") {
    return apiError(
      422,
      "invalid",
      "Esta cita ya no está activa; no tiene sentido recordarla"
    );
  }

  const { fecha, hora } = utcAFechaHoraBogota(cita.startsAt);
  const texto =
    `¡Hola! 👋 Te recordamos tu cita de *${cita.serviceName}* el ${fecha} a las ` +
    `${horaAAmPm(hora)} con ${cita.staffName}. Si necesitas cambiarla o cancelarla, ` +
    `escríbenos por aquí. ¡Te esperamos! 💗`;

  try {
    const conversation = await getOrCreateConversation(session.organizationId, cita.contactId);
    await sendText({
      conversationId: conversation.id,
      organizationId: session.organizationId,
      text: texto,
      aiGenerated: false,
    });
  } catch (err) {
    if (err instanceof SendError) {
      const message =
        err.code === "window_closed"
          ? "El cliente no le ha escrito al negocio en las últimas 24 horas: WhatsApp no deja mandarle texto libre. Pídele que escriba algo primero, o contáctalo tú directamente."
          : err.message;
      return apiError(sendErrorStatus(err), err.code, message);
    }
    throw err;
  }

  await marcarCitaRecordada(session.organizationId, id);
  return Response.json({ ok: true, remindedAt: new Date().toISOString() });
});
