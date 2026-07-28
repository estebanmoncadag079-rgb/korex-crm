import { after } from "next/server";
import { getEnv } from "@/lib/env";
import {
  verifyYcloudSignature,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { handleYcloudEvent } from "@/server/inbox/ycloud-events";

/**
 * Webhook de la cuenta de YCloud de la AGENCIA.
 *
 * Recibe los mensajes de todos los números conectados a esa cuenta: cada
 * evento se enruta al cliente dueño del número
 * (`src/server/inbox/ycloud-routing.ts`). Número desconocido → se descarta.
 *
 * Los clientes que traen su PROPIA cuenta de YCloud entran por
 * `/api/webhooks/ycloud/<organizationId>`, con el secreto de su cuenta.
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
      await handleYcloudEvent(event);
    } catch (err) {
      console.error("[ycloud webhook] error procesando evento:", err);
    }
  });

  return Response.json({ received: true });
}
