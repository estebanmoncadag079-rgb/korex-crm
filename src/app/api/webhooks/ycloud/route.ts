import { getEnv } from "@/lib/env";
import {
  verifyYcloudSignature,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { handleYcloudEvent } from "@/server/inbox/ycloud-events";
import {
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/server/inbox/webhook-event-log";

/**
 * Webhook de la cuenta de YCloud de la AGENCIA.
 *
 * Recibe los mensajes de todos los números conectados a esa cuenta: cada
 * evento se enruta al cliente dueño del número
 * (`src/server/inbox/ycloud-routing.ts`). Número desconocido → se descarta.
 *
 * Los clientes que traen su PROPIA cuenta de YCloud entran por
 * `/api/webhooks/ycloud/<organizationId>`, con el secreto de su cuenta.
 *
 * El evento crudo se guarda ANTES de procesarlo (Fase 0, 3-ago-2026): si el
 * guardado falla, se responde 5xx para que YCloud pueda reintentar — antes
 * se respondía 200 primero y se procesaba después en segundo plano
 * (`after()`), así que un fallo a mitad de camino era invisible e
 * irrecuperable. Ahora, una vez guardado el crudo, el procesamiento ocurre
 * en el mismo request (sin `after()`): no hace falta, porque este proceso
 * es un contenedor de larga vida, no una función serverless que se apaga al
 * responder — y así un fallo de procesamiento queda registrado con su
 * error en vez de perderse en un log que rota.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = getEnv();
  const rawBody = await req.text();
  const sig = req.headers.get("ycloud-signature");

  if (!verifyYcloudSignature(rawBody, sig, env.YCLOUD_WEBHOOK_SECRET)) {
    return new Response(null, { status: 401 });
  }

  let recorded: { id: string; payload: unknown };
  try {
    recorded = await recordWebhookEvent({
      source: "agencia",
      rawBody,
      headers: Object.fromEntries(req.headers.entries()),
      signature: sig,
    });
  } catch (err) {
    console.error("[ycloud webhook] no se pudo guardar el evento crudo:", err);
    return new Response(null, { status: 503 });
  }

  if (!recorded.payload) {
    await markWebhookEventFailed(recorded.id, "cuerpo no es JSON válido");
    return Response.json({ received: true });
  }

  try {
    const { organizationId } = await handleYcloudEvent(
      recorded.payload as YcloudEvent
    );
    await markWebhookEventProcessed(recorded.id, organizationId);
  } catch (err) {
    console.error("[ycloud webhook] error procesando evento:", err);
    await markWebhookEventFailed(recorded.id, err);
  }

  return Response.json({ received: true });
}
