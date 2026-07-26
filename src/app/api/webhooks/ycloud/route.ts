import { after } from "next/server";
import { getEnv } from "@/lib/env";
import {
  verifyYcloudSignature,
  parseYcloudInbound,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { ingestInboundMessage } from "@/server/inbox/ingest";

/**
 * Webhook de YCloud (WhatsApp Business API oficial).
 * MODO OBSERVACIÓN: por ahora solo enruta el WABA configurado en
 * YCLOUD_OBSERVE_WABA hacia YCLOUD_OBSERVE_ORG, e ingiere SIN disparar el
 * agente (no responde). Cualquier otro WABA se ignora → no interfiere con
 * bots de clientes vivos (ej. CHURRA con su propio bot).
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

  const env = getEnv();
  const observeWaba = env.YCLOUD_OBSERVE_WABA;
  const observeOrg = env.YCLOUD_OBSERVE_ORG;
  if (!observeWaba || !observeOrg) return; // modo observación no configurado

  const msg = parseYcloudInbound(event);
  if (!msg) return;

  // Solo el WABA en observación; los demás se descartan (seguridad).
  if (msg.wabaId !== observeWaba) return;

  await ingestInboundMessage(
    {
      organizationId: observeOrg,
      from: msg.from,
      profileName: msg.name,
      waMessageId: msg.id,
      type: msg.type,
      text: msg.text,
      timestamp: msg.unixTs,
    },
    { triggerAgent: false } // OBSERVACIÓN: no responder
  );
}
