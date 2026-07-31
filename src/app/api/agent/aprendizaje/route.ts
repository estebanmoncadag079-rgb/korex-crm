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

/** Lanza el análisis de las conversaciones recientes de este cliente. */
export const POST = withPlatformAdmin(async (session) => {
  if (!isAiConfigured()) {
    return apiError(422, "not_configured", "La IA no está configurada");
  }
  const { propuestas, mensajesRevisados } = await buscarAprendizajes(
    session.organizationId
  );
  return Response.json({ propuestas, mensajesRevisados });
});
