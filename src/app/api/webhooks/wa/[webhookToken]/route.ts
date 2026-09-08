import { getEnv } from "@/lib/env";
import {
  isValidSignature,
  isValidWebhookToken,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import { processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import {
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/server/inbox/webhook-event-log";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 solo si META_APP_SECRET está configurado.
 *
 * Fase 10W (4-sep-2026) — mismo "Fase 0" que ya tiene YCloud
 * (`/api/webhooks/ycloud/route.ts`, 3-ago-2026), hasta ahora ausente aquí: el
 * evento crudo se guarda ANTES de procesarlo, y el procesamiento ocurre en el
 * MISMO request (ya no en `after()`). Antes, un fallo o un reinicio del
 * contenedor a mitad de `after()` perdía el evento sin dejar ningún rastro —
 * ni una fila, ni un log persistente (el de stdout se va con el contenedor
 * viejo). Este camino está dormido en producción hoy (korex.ia solo usa
 * YCloud), pero cualquier cliente futuro con su propia app de Meta hereda
 * ahora la misma protección.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!isValidSignature(rawBody, signature, env.META_APP_SECRET)) {
    return new Response(null, { status: 401 });
  }

  let recorded: { id: string; payload: unknown };
  try {
    recorded = await recordWebhookEvent({
      source: "meta",
      rawBody,
      headers: Object.fromEntries(req.headers.entries()),
      signature,
    });
  } catch (err) {
    console.error("[webhook] no se pudo guardar el evento crudo:", err);
    return new Response(null, { status: 503 });
  }

  if (!recorded.payload) {
    await markWebhookEventFailed(recorded.id, "cuerpo no es JSON válido");
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  try {
    await processPayload(recorded.payload as WebhookPayload);
    await markWebhookEventProcessed(recorded.id, null);
  } catch (err) {
    console.error("[webhook] error procesando payload:", err);
    await markWebhookEventFailed(recorded.id, err);
  }

  return Response.json({ received: true });
}

async function processPayload(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(entry.id ?? null, change.value);
      }
      // otros fields: ignorar sin error
    }
  }
}
