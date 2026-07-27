import { getEnv } from "@/lib/env";
import {
  getCredentialsByDisplayPhone,
  getCredentialsByWabaId,
} from "@/server/whatsapp/credentials";
import type { ParsedInbound } from "@/server/inbox/ycloud-webhook";

export type InboundRoute = {
  organizationId: string;
  /** false = se ingiere y se muestra, pero el agente NO responde. */
  triggerAgent: boolean;
};

/**
 * Decide a QUÉ CLIENTE pertenece un mensaje entrante de YCloud.
 *
 * El webhook de YCloud es por CUENTA, no por número: llegan aquí los mensajes
 * de todos los números conectados. La organización se resuelve por el número
 * del negocio (`to`), que es único por instancia; el WABA es el respaldo. Un
 * número desconocido se DESCARTA — nunca se cae en una organización por
 * defecto, porque eso metería la conversación de un negocio en la bandeja de
 * otro.
 */
export async function resolveInboundRoute(
  msg: ParsedInbound
): Promise<InboundRoute | null> {
  const env = getEnv();

  const byPhone = msg.to ? await getCredentialsByDisplayPhone(msg.to) : null;
  const credentials = byPhone ?? (await getCredentialsByWabaId(msg.wabaId));

  let organizationId = credentials?.organizationId ?? null;

  // Compatibilidad con el modo observación previo al registro del número:
  // el WABA fijado en el entorno se enruta a su organización.
  if (
    !organizationId &&
    env.YCLOUD_OBSERVE_WABA &&
    env.YCLOUD_OBSERVE_ORG &&
    msg.wabaId === env.YCLOUD_OBSERVE_WABA
  ) {
    organizationId = env.YCLOUD_OBSERVE_ORG;
  }

  if (!organizationId) return null;

  // Modo observación: mientras el bot antiguo del cliente siga vivo, korex.ia
  // mira sin responder (dos bots respondiendo el mismo número = respuestas
  // duplicadas). Se apaga quitando YCLOUD_OBSERVE_ORG del entorno.
  const observing = env.YCLOUD_OBSERVE_ORG === organizationId;

  return { organizationId, triggerAgent: !observing };
}
