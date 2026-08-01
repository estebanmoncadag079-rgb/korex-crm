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
  /*
   * Todo descarte deja rastro, y esto no es celo de registro: el 31-jul-2026
   * una clienta de Lis escribió "Hola", el webhook respondió 200 y el mensaje
   * no apareció en ninguna parte. Sin una línea de log fue imposible saber si
   * lo tiró el tipo de evento, el parseo o el enrutado. Un mensaje de cliente
   * que se pierde en silencio es lo más caro que puede pasar aquí: nadie lo
   * atiende y nadie se entera de que existió.
   */
  if (event.type !== "whatsapp.inbound_message.received") {
    console.info(`[ycloud webhook] evento ignorado (type=${event.type})`);
    return;
  }

  const msg = parseYcloudInbound(event);
  if (!msg) {
    const m = event.whatsappInboundMessage;
    console.warn(
      "[ycloud webhook] MENSAJE DESCARTADO: el evento no trae los datos " +
        `mínimos (id=${m?.id ?? "falta"}, wabaId=${m?.wabaId ?? "falta"}, ` +
        `from=${m?.from ?? "falta"}, type=${m?.type ?? "?"})`
    );
    return;
  }

  const route = await resolveInboundRoute(msg);
  if (!route) {
    console.warn(
      `[ycloud webhook] mensaje para un número sin cliente (to=${msg.to}, ` +
        `waba=${msg.wabaId}): regístralo en el panel de clientes`
    );
    return;
  }
  if (!belongsTo(route.organizationId, opts)) {
    console.warn(
      "[ycloud webhook] MENSAJE DESCARTADO por aislamiento: el número " +
        `${msg.to} es de ${route.organizationId} y el webhook es de ` +
        `${opts?.expectOrganizationId}`
    );
    return;
  }

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
  if (!echo) {
    console.warn(
      "[ycloud webhook] ECO DESCARTADO: el evento no trae los datos mínimos"
    );
    return;
  }

  const route = await resolveRoute(echo.businessPhone, echo.wabaId);
  if (!route) {
    console.warn(
      `[ycloud webhook] eco de un número sin cliente (from=${echo.businessPhone})`
    );
    return;
  }
  if (!belongsTo(route.organizationId, opts)) {
    console.warn(
      `[ycloud webhook] ECO DESCARTADO por aislamiento (${echo.businessPhone})`
    );
    return;
  }

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
