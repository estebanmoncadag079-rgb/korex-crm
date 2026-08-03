import { getEnv } from "@/lib/env";
import type { RecipientTarget } from "@/lib/meta/client";

/**
 * `sendDirectly` de YCloud exige exactamente uno de "to" (E.164) o
 * "recipient" (BSUID) — nunca el BSUID por "to", que YCloud interpreta como
 * un número de teléfono inválido y rechaza. Ver el comentario de
 * `RecipientTarget` en @/lib/meta/client.
 */
function recipientField(target: RecipientTarget): { to: string } | { recipient: string } {
  return target.kind === "phone" ? { to: target.value } : { recipient: target.value };
}

/**
 * Cliente de salida hacia YCloud (WhatsApp Business API oficial).
 * Frontera única de envío por YCloud; el remitente es el número del negocio
 * (`from`).
 *
 * La API key puede venir de dos sitios: la del CLIENTE (si trajo su propia
 * cuenta de YCloud, guardada cifrada junto a su número) o la de la agencia, en
 * el entorno. Quien llama pasa la que toque; sin `apiKey` se usa la del
 * entorno.
 */
export function isYcloudEnabled(): boolean {
  const k = process.env.YCLOUD_API_KEY;
  return typeof k === "string" && k.trim().length > 0;
}

/**
 * Envía una PLANTILLA aprobada por WhatsApp. Es la única forma de escribirle a
 * alguien que no ha hablado con el negocio en las últimas 24 h — el caso del
 * equipo que recibe los avisos de pedido.
 */
export async function ycloudSendTemplate(input: {
  from: string;
  to: RecipientTarget;
  name: string;
  language: string;
  bodyParams: string[];
  apiKey?: string | null;
}): Promise<string> {
  const key = resolveApiKey(input.apiKey);
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  return sendDirectly(
    {
      from: input.from,
      ...recipientField(input.to),
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: input.bodyParams.length
          ? [
              {
                type: "body",
                parameters: input.bodyParams.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ]
          : [],
      },
    },
    key
  );
}

/** La key del cliente manda; si no trajo la suya, la de la agencia. */
function resolveApiKey(apiKey?: string | null): string {
  const key = apiKey?.trim() || getEnv().YCLOUD_API_KEY?.trim();
  if (!key) throw new Error("YCLOUD_API_KEY no configurada");
  return key;
}

/** Envía un texto libre por WhatsApp vía YCloud (sendDirectly). Devuelve el wamid. */
export async function ycloudSendText(input: {
  from: string;
  to: RecipientTarget;
  text: string;
  apiKey?: string | null;
}): Promise<string> {
  const key = resolveApiKey(input.apiKey);
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  return sendDirectly(
    {
      from: input.from,
      ...recipientField(input.to),
      type: "text",
      text: { body: input.text },
    },
    key
  );
}

/** POST único a sendDirectly: traduce el error de YCloud y devuelve el wamid. */
async function sendDirectly(
  payload: Record<string, unknown>,
  apiKey: string
): Promise<string> {
  const env = getEnv();
  const res = await fetch(
    `${env.YCLOUD_BASE_URL}/v2/whatsapp/messages/sendDirectly`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(payload),
    }
  );

  const json = (await res.json().catch(() => null)) as {
    wamid?: string;
    id?: string;
    message?: string;
    error?: { message?: string };
  } | null;

  if (!res.ok) {
    throw new Error(
      json?.message ?? json?.error?.message ?? `YCloud respondió ${res.status}`
    );
  }
  const id = json?.wamid ?? json?.id;
  if (!id) throw new Error("YCloud no devolvió ID de mensaje");
  return id;
}
