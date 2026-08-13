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

/**
 * Envía una imagen: la foto de un producto, la carta, el local.
 *
 * **Se manda una URL, no el archivo**: Meta la descarga desde sus servidores,
 * así que tiene que ser pública y accesible desde internet. Por eso las fotos
 * se sirven en `/api/media/[id]` sin sesión — ver la nota de esa ruta.
 *
 * `caption` es el texto que va debajo de la imagen, en la misma burbuja. Se usa
 * en vez de mandar un mensaje aparte: dos burbujas seguidas del negocio se leen
 * como spam, y en WhatsApp una foto con su pie es un solo mensaje.
 */
export async function ycloudSendImage(input: {
  from: string;
  to: RecipientTarget;
  /** URL pública de la imagen. Meta la descarga desde ahí. */
  link: string;
  caption?: string;
  apiKey?: string | null;
}): Promise<string> {
  const key = resolveApiKey(input.apiKey);
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");
  if (!/^https:\/\//i.test(input.link)) {
    // Meta rechaza http y no descarga de localhost. Fallar aquí con un mensaje
    // claro es mejor que un 400 opaco de YCloud a mitad de una conversación.
    throw new Error(`La imagen debe estar en una URL https pública: ${input.link}`);
  }

  return sendDirectly(
    {
      from: input.from,
      ...recipientField(input.to),
      type: "image",
      image: {
        link: input.link,
        ...(input.caption ? { caption: input.caption } : {}),
      },
    },
    key
  );
}

/**
 * Esperas entre reintentos de un fallo pasajero. Cortas a propósito: el
 * cliente está esperando la respuesta del negocio en WhatsApp, y un reintento
 * tardío se parece cada vez más a un mensaje duplicado.
 */
const REINTENTOS_MS = [300, 1200];

/**
 * Un fallo del que vale la pena reintentar: se cayó la red o YCloud contestó
 * mal por un momento. Un 4xx (número inválido, clave mala, ventana cerrada)
 * va a fallar igual las veces que se repita — reintentarlo solo retrasa el
 * aviso al equipo.
 */
function esPasajero(err: unknown): boolean {
  if (err instanceof YcloudHttpError) return err.status === 429 || err.status >= 500;
  return true; // fetch lanzó: no hubo respuesta (red, DNS, timeout)
}

class YcloudHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "YcloudHttpError";
  }
}

/**
 * POST a sendDirectly, con reintento de los fallos pasajeros: traduce el
 * error de YCloud y devuelve el wamid.
 *
 * Los reintentos se agregaron el 5-ago-2026. Antes, un hipo de red dejaba
 * perdida la respuesta que el agente ya había generado (y pagado), sin fila
 * en la base ni aviso a nadie — el cliente se quedaba esperando y el equipo
 * no se enteraba. Idea tomada de `nea-agent` (su `pending_send`, incidente
 * del 3-ago-2026); ver docs/korexia/26-NEA-AGENT.md.
 *
 * Riesgo asumido: si YCloud llegó a procesar el mensaje pero la respuesta se
 * perdió en el camino, el reintento lo duplica. Se prefiere un mensaje
 * repetido a un cliente sin respuesta, y por eso los reintentos son pocos y
 * seguidos.
 */
async function sendDirectly(
  payload: Record<string, unknown>,
  apiKey: string
): Promise<string> {
  let ultimo: unknown;
  for (let intento = 0; intento <= REINTENTOS_MS.length; intento++) {
    try {
      return await postSendDirectly(payload, apiKey);
    } catch (err) {
      ultimo = err;
      const espera = REINTENTOS_MS[intento];
      if (espera === undefined || !esPasajero(err)) break;
      console.warn(
        `[ycloud] envío falló (${err instanceof Error ? err.message : err}) — ` +
          `reintento ${intento + 1} de ${REINTENTOS_MS.length} en ${espera} ms`
      );
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimo;
}

/** Un solo POST, sin reintentos. */
async function postSendDirectly(
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
    throw new YcloudHttpError(
      res.status,
      json?.message ?? json?.error?.message ?? `YCloud respondió ${res.status}`
    );
  }
  const id = json?.wamid ?? json?.id;
  if (!id) throw new Error("YCloud no devolvió ID de mensaje");
  return id;
}
