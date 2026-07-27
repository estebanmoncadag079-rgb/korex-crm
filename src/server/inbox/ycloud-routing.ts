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
  return resolveRoute(msg.to, msg.wabaId);
}

/**
 * Organización dueña de un número del negocio. Sirve tanto para los mensajes
 * que entran (`to` = el negocio) como para los ecos de la app del celular
 * (`from` = el negocio).
 */
export async function resolveRoute(
  businessPhone: string,
  wabaId: string
): Promise<InboundRoute | null> {
  const env = getEnv();

  const byPhone = businessPhone
    ? await getCredentialsByDisplayPhone(businessPhone)
    : null;
  const credentials = byPhone ?? (wabaId ? await getCredentialsByWabaId(wabaId) : null);

  let organizationId = credentials?.organizationId ?? null;

  // Compatibilidad con el modo observación previo al registro del número:
  // el WABA fijado en el entorno se enruta a su organización.
  if (
    !organizationId &&
    env.YCLOUD_OBSERVE_WABA &&
    env.YCLOUD_OBSERVE_ORG &&
    wabaId === env.YCLOUD_OBSERVE_WABA
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
