import {
  verifyYcloudSignature,
  type YcloudEvent,
} from "@/server/inbox/ycloud-webhook";
import { handleYcloudEvent } from "@/server/inbox/ycloud-events";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/server/inbox/webhook-event-log";

/**
 * Webhook de un cliente que trajo su PROPIA cuenta de YCloud.
 *
 * Cada cuenta firma con su propio secreto, y la firma se verifica antes de
 * poder mirar el cuerpo del evento: por eso hace falta una puerta por cliente
 * (con una sola no habría forma de saber qué secreto usar). El cliente pone
 * esta URL en su consola de YCloud al conectar su número.
 *
 * Ventaja de este camino: el cupo de números y el saldo de mensajes son del
 * cliente, así que la agencia no tiene techo de clientes ni adelanta el gasto.
 *
 * Captura del evento crudo antes de procesar: ver el comentario en
 * `/api/webhooks/ycloud/route.ts` (Fase 0, 3-ago-2026).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ organizationId: string }> };

export async function POST(req: Request, ctx: Params) {
  const { organizationId } = await ctx.params;
  const rawBody = await req.text();
  const sig = req.headers.get("ycloud-signature");

  const credentials = await getCredentialsByOrg(organizationId);
  const secret = credentials?.webhookSecret;
  // Sin secreto propio no se puede verificar nada: se rechaza en vez de
  // caer al secreto de la agencia, que es de otra cuenta.
  if (!secret) return new Response(null, { status: 404 });

  if (!verifyYcloudSignature(rawBody, sig, secret)) {
    return new Response(null, { status: 401 });
  }

  let recorded: { id: string; payload: unknown };
  try {
    recorded = await recordWebhookEvent({
      source: organizationId,
      rawBody,
      headers: Object.fromEntries(req.headers.entries()),
      signature: sig,
      organizationId,
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
    const { organizationId: resolved } = await handleYcloudEvent(
      recorded.payload as YcloudEvent,
      { expectOrganizationId: organizationId }
    );
    await markWebhookEventProcessed(recorded.id, resolved);
  } catch (err) {
    console.error("[ycloud webhook] error procesando evento:", err);
    await markWebhookEventFailed(recorded.id, err);
  }

  return Response.json({ received: true });
}
