import { apiError, withPlatformAdmin } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import {
  buscarAprendizajes,
  propuestasPendientes,
} from "@/server/ai/aprendizaje";

export const dynamic = "force-dynamic";

/**
 * Aprendizaje del agente. **Solo la agencia**, aunque el conocimiento sea del
 * cliente.
 *
 * Cada análisis consume IA, y la factura la paga la agencia. Dejarlo en manos
 * del cliente sería darle un botón que gasta dinero ajeno cada vez que lo
 * pulse — el mismo motivo por el que el Laboratorio tiene cupo y la conexión de
 * WhatsApp está cerrada.
 *
 * Opera sobre la organización ACTIVA de la sesión: la agencia entra como el
 * cliente (banner ámbar) y lanza el análisis para ese negocio.
 */
export const GET = withPlatformAdmin(async (session) => {
  return Response.json({
    propuestas: await propuestasPendientes(session.organizationId),
  });
});

/**
 * Lanza el análisis de las conversaciones de este cliente.
 *
 * Con `?historial=1` mira también los chats que trajo la coexistencia al
 * conectar el número (hasta 6 meses, tope de 1.200 mensajes en vez de 400).
 * Se pide a mano porque cuesta y tarda más: tiene sentido UNA vez, al entrar un
 * cliente nuevo con historial, no cada semana.
 */
export const POST = withPlatformAdmin(async (session, req: Request) => {
  if (!isAiConfigured()) {
    return apiError(422, "not_configured", "La IA no está configurada");
  }
  const incluirHistorial = new URL(req.url).searchParams.get("historial") === "1";
  const { propuestas, mensajesRevisados } = await buscarAprendizajes(
    session.organizationId,
    { incluirHistorial }
  );
  return Response.json({ propuestas, mensajesRevisados, incluirHistorial });
});
