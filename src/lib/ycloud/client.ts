import { getEnv } from "@/lib/env";
import type { RecipientTarget } from "@/lib/meta/client";
import type { MenuInteractivo } from "@/server/catalog/menu";

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
 *
 * `retry`/`timeoutMs` (Fase 5C, auditoría de idempotencia de campañas):
 * ninguno de los dos cambia el comportamiento para quien no los pase —
 * `retry` por defecto sigue reintentando exactamente como antes, y sin
 * `timeoutMs` el `fetch` sigue sin límite propio, igual que hasta ahora.
 * Existen para que el futuro motor de campañas pueda pedir `retry: false`
 * (una ejecución del worker = una sola llamada HTTP real, nunca las hasta
 * tres ocultas de `sendDirectly`) y un `timeoutMs` explícito — ver
 * `enviarTemplateAlProveedor` en `@/server/whatsapp/templates`.
 */
export async function ycloudSendTemplate(input: {
  from: string;
  to: RecipientTarget;
  name: string;
  language: string;
  bodyParams: string[];
  /**
   * Fase 9P — URL pública de la imagen del HEADER, ya resuelta (nunca un
   * `mediaAssetId`: la resolución/validación de ownership vive en
   * `enviarTemplateAlProveedor`). Formato confirmado contra la
   * documentación oficial de envío de YCloud (`whatsapp-messaging-examples`,
   * Fase 9P sección 13): `{type:"header", parameters:[{type:"image",
   * image:{link:url}}]}`, como componente ADICIONAL al de `body` — nunca
   * lo reemplaza.
   */
  headerImageUrl?: string;
  /**
   * Valor del `{{1}}` de un header de TEXTO. Excluyente con
   * `headerImageUrl`: una plantilla tiene un solo header.
   *
   * Sin esto, una plantilla con encabezado personalizado se rechazaba con
   * `(#132000) Number of parameters does not match the expected number of
   * params` — el envío solo sabía mandar headers de imagen (incidente de
   * Camilabrandcol, 15-sep-2026; ver `headerTextConVariable`).
   */
  headerTextParam?: string;
  apiKey?: string | null;
  retry?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const key = resolveApiKey(input.apiKey);
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  const headerComponent = input.headerImageUrl
    ? [
        {
          type: "header",
          parameters: [{ type: "image", image: { link: input.headerImageUrl } }],
        },
      ]
    : input.headerTextParam
      ? [
          {
            type: "header",
            parameters: [{ type: "text", text: input.headerTextParam }],
          },
        ]
      : [];
  const bodyComponent = input.bodyParams.length
    ? [
        {
          type: "body",
          parameters: input.bodyParams.map((text) => ({
            type: "text",
            text,
          })),
        },
      ]
    : [];

  return sendDirectly(
    {
      from: input.from,
      ...recipientField(input.to),
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        components: [...headerComponent, ...bodyComponent],
      },
    },
    key,
    { retry: input.retry, timeoutMs: input.timeoutMs }
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
 * Envía un menú interactivo (lista o botones que el cliente toca), ya armado
 * y validado contra los límites de WhatsApp por `armarMenuDeIntenciones` /
 * `armarMenuDeCatalogo` (`@/server/catalog/menu`) — este cliente solo lo
 * transporta, no decide su contenido.
 */
export async function ycloudSendInteractive(input: {
  from: string;
  to: RecipientTarget;
  menu: MenuInteractivo;
  apiKey?: string | null;
}): Promise<string> {
  const key = resolveApiKey(input.apiKey);
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");

  const interactive =
    input.menu.tipo === "button"
      ? {
          type: "button",
          body: { text: input.menu.body },
          action: {
            buttons: input.menu.botones.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.titulo },
            })),
          },
        }
      : {
          type: "list",
          body: { text: input.menu.body },
          action: {
            button: input.menu.boton,
            sections: input.menu.secciones.map((s) => ({
              title: s.titulo,
              rows: s.filas.map((f) => ({
                id: f.id,
                title: f.titulo,
                ...(f.descripcion ? { description: f.descripcion } : {}),
              })),
            })),
          },
        };

  return sendDirectly(
    {
      from: input.from,
      ...recipientField(input.to),
      type: "interactive",
      interactive,
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
 * Envía un documento: un catálogo en PDF, cuando "una foto" no alcanza
 * porque son varias páginas. Mismo mecanismo que `ycloudSendImage` — una
 * URL pública que WhatsApp descarga —, con `filename` porque WhatsApp
 * necesita un nombre de archivo para mostrar la burbuja del documento (una
 * imagen no lo necesita, un documento sí).
 */
export async function ycloudSendDocument(input: {
  from: string;
  to: RecipientTarget;
  /** URL pública del documento. Meta la descarga desde ahí. */
  link: string;
  /** Cómo se llama el archivo en la burbuja del chat, con extensión. */
  filename: string;
  caption?: string;
  apiKey?: string | null;
}): Promise<string> {
  const key = resolveApiKey(input.apiKey);
  if (!input.from) throw new Error("Falta el número de origen (from) para YCloud");
  if (!/^https:\/\//i.test(input.link)) {
    throw new Error(`El documento debe estar en una URL https pública: ${input.link}`);
  }

  return sendDirectly(
    {
      from: input.from,
      ...recipientField(input.to),
      type: "document",
      document: {
        link: input.link,
        filename: input.filename,
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
  return true; // fetch lanzó: no hubo respuesta (red, DNS, timeout, AbortError por timeoutMs)
}

/**
 * Exportada (Fase 5C) para que `enviarTemplateAlProveedor`
 * (`@/server/whatsapp/templates`) pueda clasificar el `status` real en
 * `ResultadoProveedor` sin duplicar aquí el conocimiento de esa capa —
 * `ycloud/client.ts` solo expone el dato crudo, nunca decide qué significa
 * para campañas.
 */
export class YcloudHttpError extends Error {
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
 *
 * `opts.retry === false` (Fase 5C) apaga esto por completo: exactamente UN
 * POST, sin importar qué tan pasajero parezca el fallo — es lo que pide el
 * motor de campañas, que tiene su PROPIA máquina de reintento (más lenta,
 * auditable, con un estado `indeterminado` para lo ambiguo) y no puede
 * permitirse que esta función dispare hasta tres llamadas reales por cada
 * intento que el worker cree que hizo solo una. `opts.retry` ausente o
 * `true` preserva EXACTAMENTE el comportamiento anterior a esta fase, para
 * todo el envío conversacional que ya dependía de él.
 */
async function sendDirectly(
  payload: Record<string, unknown>,
  apiKey: string,
  opts?: { retry?: boolean; timeoutMs?: number }
): Promise<string> {
  const retryHabilitado = opts?.retry ?? true;
  const intentosDeReintento = retryHabilitado ? REINTENTOS_MS.length : 0;
  let ultimo: unknown;
  for (let intento = 0; intento <= intentosDeReintento; intento++) {
    try {
      const wamid = await postSendDirectly(payload, apiKey, opts?.timeoutMs);
      /*
       * Diagnóstico aditivo (patrón F,F/F,F,T de saludos duplicados,
       * auditoría de Lashes Valen): si esto se registra con `intento > 0`,
       * es evidencia directa de que el POST anterior pudo haber llegado a
       * YCloud (mensaje real enviado, con su propio wamid) aunque la
       * respuesta se perdiera del lado del cliente — el "riesgo asumido"
       * documentado arriba, ahora visible en el log en vez de solo en teoría.
       */
      if (intento > 0) {
        console.warn(
          `[ycloud] envío tuvo éxito TRAS reintento (intento ${intento + 1} de ` +
            `${intentosDeReintento + 1}) — wamid=${wamid}. Si el intento anterior ` +
            `también llegó a WhatsApp, el cliente puede haber recibido el mensaje dos veces.`
        );
      }
      return wamid;
    } catch (err) {
      ultimo = err;
      if (!retryHabilitado) break;
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

/**
 * Un solo POST, sin reintentos.
 *
 * `timeoutMs` (Fase 5C) es opcional y sin valor por defecto propio: quien
 * no lo pasa conserva el comportamiento de siempre (`fetch` sin límite). Un
 * `AbortError` por vencimiento se propaga tal cual — no es un
 * `YcloudHttpError`, así que `esPasajero` ya lo trata como pasajero (mismo
 * camino que cualquier fallo de red), y en la clasificación de más alto
 * nivel (`enviarTemplateAlProveedor`) cae como `AMBIGUOUS_FAILURE`: nunca
 * se sabe si YCloud llegó a procesar la petición antes del corte.
 */
async function postSendDirectly(
  payload: Record<string, unknown>,
  apiKey: string,
  timeoutMs?: number
): Promise<string> {
  const env = getEnv();
  const controller = timeoutMs !== undefined ? new AbortController() : undefined;
  const timer =
    controller && timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  let res: Response;
  try {
    res = await fetch(
      `${env.YCLOUD_BASE_URL}/v2/whatsapp/messages/sendDirectly`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      }
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

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
