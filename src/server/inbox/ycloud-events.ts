import {
  parseYcloudEcho,
  parseYcloudHistory,
  parseYcloudInbound,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { resolveInboundRoute, resolveRoute } from "@/server/inbox/ycloud-routing";
import {
  ingestHistoryMessage,
  ingestInboundMessage,
  ingestOutboundEcho,
} from "@/server/inbox/ingest";
import { notifyTeam } from "@/server/ai/notify-team";

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
): Promise<{ organizationId: string | null }> {
  if (event.type === "whatsapp.smb.message.echoes") {
    return handleEcho(event, opts);
  }
  /*
   * El historial que sincroniza la coexistencia: hasta 6 MESES de chats
   * anteriores a conectar el número. Hasta el 14-ago-2026 caía en el
   * "evento ignorado" de abajo y se perdía — con él, la conversación que el
   * negocio ya había tenido con sus clientas, que es de donde sale el
   * conocimiento que el agente todavía no tiene.
   */
  if (event.type === "whatsapp.smb.history") {
    return handleHistory(event, opts);
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
    return { organizationId: null };
  }

  const msg = parseYcloudInbound(event);
  if (!msg) {
    const m = event.whatsappInboundMessage;
    console.warn(
      "[ycloud webhook] MENSAJE DESCARTADO: el evento no trae los datos " +
        `mínimos (id=${m?.id ?? "falta"}, wabaId=${m?.wabaId ?? "falta"}, ` +
        `from=${m?.from ?? "falta"}, fromUserId=${m?.fromUserId ?? "falta"}, ` +
        `type=${m?.type ?? "?"})`
    );
    /**
     * El paquete completo, aparte del resumen de arriba: gracias a esto se
     * encontró la causa real el 2-ago-2026 — clientes con nombre de usuario
     * de WhatsApp mandan `fromUserId` en vez de `from`, y eso YA se lee
     * arriba. Si esto se sigue disparando, es un caso todavía más raro (ni
     * uno ni el otro) y hace falta ver el payload de nuevo.
     */
    console.warn(`[ycloud webhook] evento completo descartado: ${JSON.stringify(event)}`);
    // El mensaje del cliente se pierde sin dejar ni una fila: avisar al
    // equipo YA, para que lo atienda a mano en WhatsApp, es lo único que
    // evita que el cliente se quede esperando sin que nadie se entere
    // (verificado en vivo el 1-ago-2026 en Lis Pastelería).
    await alertarMensajePerdido(m?.wabaId, m?.to);
    return { organizationId: null };
  }

  if (!msg.text && !msg.mediaUrl) {
    /**
     * No dispara al agente (ver `ingestInboundMessage`), pero conviene ver el
     * paquete completo la próxima vez que pase: hoy no se sabe si YCloud manda
     * el texto real de una edición en otro campo que el parser no está
     * leyendo (id=${msg.id}, type=${msg.type}).
     */
    console.warn(
      `[ycloud webhook] mensaje sin texto ni adjunto (type=${msg.type}, id=${msg.id}): ` +
        `no dispara al agente. Evento completo: ${JSON.stringify(event)}`
    );
  }

  const route = await resolveInboundRoute(msg);
  if (!route) {
    console.warn(
      `[ycloud webhook] mensaje para un número sin cliente (to=${msg.to}, ` +
        `waba=${msg.wabaId}): regístralo en el panel de clientes`
    );
    return { organizationId: null };
  }
  if (!belongsTo(route.organizationId, opts)) {
    console.warn(
      "[ycloud webhook] MENSAJE DESCARTADO por aislamiento: el número " +
        `${msg.to} es de ${route.organizationId} y el webhook es de ` +
        `${opts?.expectOrganizationId}`
    );
    return { organizationId: route.organizationId };
  }

  await ingestInboundMessage(
    {
      organizationId: route.organizationId,
      from: msg.from,
      waUserId: msg.waUserId,
      profileName: msg.name,
      waMessageId: msg.id,
      type: msg.type,
      text: msg.text,
      timestamp: msg.unixTs,
      mediaUrl: msg.mediaUrl,
      mediaId: msg.mediaId,
      mimeType: msg.mimeType,
      replyToWamid: msg.replyToWamid,
      respondeAEstado: msg.respondeAEstado,
    },
    { triggerAgent: route.triggerAgent }
  );
  return { organizationId: route.organizationId };
}

/**
 * El negocio respondió desde la app de WhatsApp de su celular: se registra en
 * el hilo (para que el historial no tenga huecos) y el agente cede el turno.
 */
/**
 * Un mensaje del historial de la coexistencia.
 *
 * Mismo enrutado que el eco —el número del negocio decide de quién es—, pero
 * lo que hace con él es muy distinto: `ingestHistoryMessage` solo lo guarda.
 * Ni agente, ni relevo humano, ni ventana de 24 h (ver allí el porqué de cada
 * uno).
 */
async function handleHistory(
  event: YcloudEvent,
  opts?: { expectOrganizationId?: string }
): Promise<{ organizationId: string | null }> {
  const msg = parseYcloudHistory(event);
  if (!msg) {
    console.warn(
      "[ycloud webhook] HISTORIAL DESCARTADO: el evento no trae los datos mínimos"
    );
    return { organizationId: null };
  }

  const route = await resolveRoute(msg.businessPhone, msg.wabaId);
  if (!route) {
    console.warn(
      `[ycloud webhook] historial de un número sin cliente (${msg.businessPhone})`
    );
    return { organizationId: null };
  }
  if (!belongsTo(route.organizationId, opts)) {
    console.warn(
      `[ycloud webhook] HISTORIAL DESCARTADO por aislamiento (${msg.businessPhone})`
    );
    return { organizationId: route.organizationId };
  }

  const { guardado } = await ingestHistoryMessage({
    organizationId: route.organizationId,
    direction: msg.direction,
    customerPhone: msg.customerPhone,
    customerWaUserId: msg.customerWaUserId,
    profileName: msg.profileName,
    waMessageId: msg.waMessageId,
    type: msg.type,
    text: msg.text,
    timestamp: msg.unixTs,
  });
  // Se registra en info y no en warn: llegan cientos de golpe y los repetidos
  // son normales (la sincronización reenvía).
  if (!guardado) {
    console.info(`[ycloud webhook] historial repetido (${msg.waMessageId})`);
  }
  return { organizationId: route.organizationId };
}

async function handleEcho(
  event: YcloudEvent,
  opts?: { expectOrganizationId?: string }
): Promise<{ organizationId: string | null }> {
  const echo = parseYcloudEcho(event);
  if (!echo) {
    console.warn(
      "[ycloud webhook] ECO DESCARTADO: el evento no trae los datos mínimos"
    );
    return { organizationId: null };
  }

  const route = await resolveRoute(echo.businessPhone, echo.wabaId);
  if (!route) {
    console.warn(
      `[ycloud webhook] eco de un número sin cliente (from=${echo.businessPhone})`
    );
    return { organizationId: null };
  }
  if (!belongsTo(route.organizationId, opts)) {
    console.warn(
      `[ycloud webhook] ECO DESCARTADO por aislamiento (${echo.businessPhone})`
    );
    return { organizationId: route.organizationId };
  }

  await ingestOutboundEcho({
    organizationId: route.organizationId,
    toPhone: echo.customerPhone,
    toWaUserId: echo.customerWaUserId,
    waMessageId: echo.waMessageId,
    type: echo.type,
    text: echo.text,
    timestamp: echo.unixTs,
    mediaUrl: echo.mediaUrl,
    mediaId: echo.mediaId,
    mimeType: echo.mimeType,
  });
  return { organizationId: route.organizationId };
}

/**
 * Un evento sin "from" no trae contacto ni conversación: no hay dónde
 * escribir una nota en el CRM. Lo único posible es resolver el CLIENTE por
 * `wabaId`/`to` (que sí suelen venir) y avisarle por WhatsApp a su equipo,
 * igual que se avisa un pedido — es la única red de seguridad posible aquí.
 */
async function alertarMensajePerdido(
  wabaId?: string,
  to?: string
): Promise<void> {
  if (!wabaId && !to) return;
  try {
    const route = await resolveRoute(to?.replace(/^\+/, "") ?? "", wabaId ?? "");
    if (!route) return;
    await notifyTeam({
      organizationId: route.organizationId,
      summary:
        "⚠️ Llegó un mensaje de un cliente que el sistema NO pudo procesar " +
        "(posible reacción o respuesta a un Estado de WhatsApp). No quedó " +
        "registrado en el CRM — revisa WhatsApp directamente para no dejarlo " +
        "sin respuesta.",
    });
  } catch (err) {
    console.error(
      "[ycloud webhook] no se pudo avisar al equipo del mensaje perdido:",
      err
    );
  }
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
