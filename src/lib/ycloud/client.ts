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

/** Envía un texto libre por WhatsApp vía YCloud (sendDirectly). Devuelve el wamid. */
export async function ycloudSendText(input: {
  from: string;
  to: string;
  text: string;
}): Promise<string> {
  const env = getEnv();
  if (!env.YCLOUD_API_KEY) throw new Error("YCLOUD_API_KEY no configurada");
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  const res = await fetch(
    `${env.YCLOUD_BASE_URL}/v2/whatsapp/messages/sendDirectly`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.YCLOUD_API_KEY,
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        type: "text",
        text: { body: input.text },
      }),
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
