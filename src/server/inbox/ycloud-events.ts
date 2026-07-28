import {
  parseYcloudEcho,
  parseYcloudInbound,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { resolveInboundRoute, resolveRoute } from "@/server/inbox/ycloud-routing";
import { ingestInboundMessage, ingestOutboundEcho } from "@/server/inbox/ingest";

/**
 * Procesamiento de un evento de YCloud, común a las dos puertas de entrada:
 * el webhook de la cuenta de la agencia y el de la cuenta propia de cada
 * cliente (`/api/webhooks/ycloud/<org>`).
 *
 * `expectOrganizationId` cierra el paso a que la cuenta de un cliente escriba
 * en la bandeja de otro: si el número del evento no le pertenece, se descarta.
 */
export async function handleYcloudEvent(
  event: YcloudEvent,
  opts?: { expectOrganizationId?: string }
): Promise<void> {
  if (event.type === "whatsapp.smb.message.echoes") {
    await handleEcho(event, opts);
    return;
  }
  if (event.type !== "whatsapp.inbound_message.received") return;

  const msg = parseYcloudInbound(event);
  if (!msg) return;

  const route = await resolveInboundRoute(msg);
  if (!route) {
    console.warn(
      `[ycloud webhook] mensaje para un número sin cliente (to=${msg.to}, ` +
        `waba=${msg.wabaId}): regístralo en el panel de clientes`
    );
    return;
  }
  if (!belongsTo(route.organizationId, opts)) return;

  await ingestInboundMessage(
    {
      organizationId: route.organizationId,
      from: msg.from,
      profileName: msg.name,
      waMessageId: msg.id,
      type: msg.type,
      text: msg.text,
      timestamp: msg.unixTs,
      mediaUrl: msg.mediaUrl,
      mediaId: msg.mediaId,
      mimeType: msg.mimeType,
    },
    { triggerAgent: route.triggerAgent }
  );
}

/**
 * El negocio respondió desde la app de WhatsApp de su celular: se registra en
 * el hilo (para que el historial no tenga huecos) y el agente cede el turno.
 */
async function handleEcho(
  event: YcloudEvent,
  opts?: { expectOrganizationId?: string }
): Promise<void> {
  const echo = parseYcloudEcho(event);
  if (!echo) return;

  const route = await resolveRoute(echo.businessPhone, echo.wabaId);
  if (!route) {
    console.warn(
      `[ycloud webhook] eco de un número sin cliente (from=${echo.businessPhone})`
    );
    return;
  }
  if (!belongsTo(route.organizationId, opts)) return;

  await ingestOutboundEcho({
    organizationId: route.organizationId,
    toPhone: echo.customerPhone,
    waMessageId: echo.waMessageId,
    type: echo.type,
    text: echo.text,
    timestamp: echo.unixTs,
    mediaUrl: echo.mediaUrl,
    mediaId: echo.mediaId,
    mimeType: echo.mimeType,
  });
}

function belongsTo(
  organizationId: string,
  opts?: { expectOrganizationId?: string }
): boolean {
  const expected = opts?.expectOrganizationId;
  if (!expected || expected === organizationId) return true;
  console.warn(
    `[ycloud webhook] evento de ${organizationId} recibido por la puerta de ` +
      `${expected}: descartado`
  );
  return false;
}
