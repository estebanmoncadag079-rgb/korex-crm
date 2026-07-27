import { getEnv } from "@/lib/env";

/**
 * Cliente de salida hacia YCloud (WhatsApp Business API oficial).
 * Frontera única de envío por YCloud. El API key es de cuenta (env), y el
 * remitente es el número del negocio (`from`).
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
  to: string;
  name: string;
  language: string;
  bodyParams: string[];
}): Promise<string> {
  const env = getEnv();
  if (!env.YCLOUD_API_KEY) throw new Error("YCLOUD_API_KEY no configurada");
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  return sendDirectly({
    from: input.from,
    to: input.to,
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
  });
}

/** Envía un texto libre por WhatsApp vía YCloud (sendDirectly). Devuelve el wamid. */
export async function ycloudSendText(input: {
  from: string;
  to: string;
  text: string;
}): Promise<string> {
  const env = getEnv();
  if (!env.YCLOUD_API_KEY) throw new Error("YCLOUD_API_KEY no configurada");
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  return sendDirectly({
    from: input.from,
    to: input.to,
    type: "text",
    text: { body: input.text },
  });
}

/** POST único a sendDirectly: traduce el error de YCloud y devuelve el wamid. */
async function sendDirectly(payload: Record<string, unknown>): Promise<string> {
  const env = getEnv();
  const res = await fetch(
    `${env.YCLOUD_BASE_URL}/v2/whatsapp/messages/sendDirectly`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.YCLOUD_API_KEY ?? "",
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
