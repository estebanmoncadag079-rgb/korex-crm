import { after } from "next/server";
import { getEnv } from "@/lib/env";
import {
  verifyYcloudSignature,
  parseYcloudInbound,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { resolveInboundRoute } from "@/server/inbox/ycloud-routing";
import { ingestInboundMessage } from "@/server/inbox/ingest";

/**
 * Webhook de YCloud (WhatsApp Business API oficial).
 *
 * La cuenta de YCloud es de la agencia y recibe los mensajes de TODOS los
 * números conectados: cada evento se enruta al cliente dueño del número
 * (`src/server/inbox/ycloud-routing.ts`). Número desconocido → se descarta.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = getEnv();
  const rawBody = await req.text();
  const sig = req.headers.get("ycloud-signature");

  if (!verifyYcloudSignature(rawBody, sig, env.YCLOUD_WEBHOOK_SECRET)) {
    return new Response(null, { status: 401 });
  }

  let event: YcloudEvent;
  try {
    event = JSON.parse(rawBody) as YcloudEvent;
  } catch {
    return Response.json({ received: true });
  }

  // Responder rápido (2xx) y procesar en background.
  after(async () => {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("[ycloud webhook] error procesando evento:", err);
    }
  });

  return Response.json({ received: true });
}

async function handleEvent(event: YcloudEvent): Promise<void> {
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
