import { getEnv, isAiConfigured } from "@/lib/env";
import { esOrigenPermitido } from "@/server/whatsapp/media-origen";
import { registrarUsoIa } from "@/server/usage";

/**
 * Notas de voz: se transcriben al llegar, no en cada turno del agente.
 *
 * En Colombia mucha gente pide hablando. Hasta ahora esas notas eran invisibles
 * para el agente —el historial que recibe filtra por texto— así que respondía
 * un saludo genérico a alguien que acababa de explicar su pedido. Pasó de
 * verdad con una clienta de Lis el 31-jul-2026: preguntó por domicilios para
 * una porción de torta de cumpleaños y el agente contestó "qué alegría que nos
 * escribas".
 *
 * Se transcribe UNA vez, al recibir, y el texto se guarda en el propio mensaje.
 * Así vale para todo sin tocar nada más: el agente lo lee como si se lo
 * hubieran escrito, aparece en la bandeja para quien atienda a mano, entra en
 * el aprendizaje y queda en los respaldos. Mandar el audio en cada turno sería
 * pagarlo una y otra vez por la misma frase.
 */

/** Tope de descarga. Un audio de cinco minutos en opus pesa ~1 MB; 10 MB es
 * holgado y evita que un archivo enorme ahogue un servidor de un solo núcleo. */
const MAX_BYTES = 10 * 1024 * 1024;

const TIMEOUT_MS = 60_000;

/** Lo que se le pide al modelo: el texto y nada más. */
const INSTRUCCION =
  "Transcribe este audio en español, tal como suena. Devuelve ÚNICAMENTE la " +
  "transcripción, sin comillas, sin comentarios y sin describir el audio. Si " +
  "no se entiende nada, devuelve exactamente: (audio no entendible)";

export type ResultadoTranscripcion = {
  texto: string | null;
  motivo?: "sin_ia" | "origen" | "descarga" | "grande" | "proveedor";
};

/**
 * Transcribe una nota de voz. Nunca lanza: si algo falla devuelve `null` y el
 * mensaje se guarda igual, sin transcripción — perder el texto es molesto,
 * perder el mensaje entero sería mucho peor.
 */
export async function transcribirAudio(input: {
  organizationId: string;
  mediaUrl: string;
  mimeType?: string | null;
  apiKey?: string | null;
}): Promise<ResultadoTranscripcion> {
  if (!isAiConfigured()) return { texto: null, motivo: "sin_ia" };

  // Mismo filtro que el proxy de adjuntos: aquí importa más, porque esto se
  // dispara solo con cada audio que entre, sin que nadie lo mire.
  if (!esOrigenPermitido(input.mediaUrl)) {
    console.warn("[transcripción] origen no permitido, se omite el audio");
    return { texto: null, motivo: "origen" };
  }

  const descarga = await descargarMedio(input.mediaUrl, input.apiKey);
  if (!descarga.ok) return { texto: null, motivo: descarga.motivo };
  const audio = descarga.datos;

  const env = getEnv();
  const modelo = env.OPENROUTER_MODEL;
  if (!modelo) return { texto: null, motivo: "sin_ia" };

  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: INSTRUCCION },
              {
                type: "input_audio",
                input_audio: {
                  data: Buffer.from(audio).toString("base64"),
                  format: formatoDe(input.mimeType),
                },
              },
            ],
          },
        ],
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[transcripción] el proveedor respondió ${res.status}`);
      return { texto: null, motivo: "proveedor" };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };

    // El gasto se anota aunque la transcripción salga vacía: se pagó igual.
    await registrarUsoIa(
      input.organizationId,
      {
        model: modelo,
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
        costUsd: json.usage?.cost ?? 0,
      },
      "transcripcion"
    );

    const texto = json.choices?.[0]?.message?.content?.trim();
    if (!texto) return { texto: null, motivo: "proveedor" };
    return { texto };
  } catch (err) {
    console.warn("[transcripción] fallo del proveedor:", err);
    return { texto: null, motivo: "proveedor" };
  }
}

/** El formato que espera el proveedor, a partir del mime de WhatsApp. */
function formatoDe(mimeType?: string | null): string {
  const m = (mimeType ?? "").toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  // Las notas de voz de WhatsApp son ogg/opus, que es el caso normal.
  return "ogg";
}

/** Descarga con las guardas comunes a audio e imagen. */
async function descargarMedio(
  url: string,
  apiKey?: string | null
): Promise<
  | { ok: true; datos: ArrayBuffer }
  | { ok: false; motivo: "descarga" | "grande" }
> {
  try {
    const res = await fetch(url, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[medio] no se pudo descargar (${res.status})`);
      return { ok: false, motivo: "descarga" };
    }
    const declarado = Number(res.headers.get("content-length") ?? 0);
    if (declarado > MAX_BYTES) {
      console.warn(`[medio] demasiado grande (${declarado} bytes)`);
      return { ok: false, motivo: "grande" };
    }
    const datos = await res.arrayBuffer();
    // Se comprueba también lo REAL: la cabecera puede mentir o no venir.
    if (datos.byteLength > MAX_BYTES) return { ok: false, motivo: "grande" };
    return { ok: true, datos };
  } catch (err) {
    console.warn("[medio] fallo descargando:", err);
    return { ok: false, motivo: "descarga" };
  }
}

/**
 * Qué se le pide al modelo ante una imagen.
 *
 * El caso que más llega es el comprobante de pago, y el equilibrio importa: el
 * agente **no dictamina si el pago es bueno** —eso mueve dinero y lo decide una
 * persona— pero sí extrae los datos con los que esa persona decide en dos
 * segundos.
 *
 * Los cuatro que delatan un comprobante reutilizado o ajeno:
 *   · A QUIÉN se pagó: si la cuenta no es la del negocio, no hay más que hablar.
 *   · FECHA Y HORA: un comprobante de hace tres días para un pedido de ahora.
 *   · MONTO: si no cuadra con lo pedido.
 *   · REFERENCIA: la misma en dos pedidos es el mismo pago enviado dos veces.
 *
 * Se pide "(no se lee)" en lugar de dejar huecos: un dato que falta es en sí
 * una señal, y sería peor que el modelo lo rellenara a ojo.
 */
const INSTRUCCION_IMAGEN = [
  "Mira esta imagen que un cliente envió por WhatsApp a un negocio, en español.",
  "",
  "Si es un COMPROBANTE de pago o transferencia, responde EXACTAMENTE en este formato, en una línea:",
  "[COMPROBANTE] banco/app · monto · fecha y hora · a nombre de: destinatario · cuenta destino · ref: referencia",
  "Ejemplo: [COMPROBANTE] Bancolombia · $22.000 · 31/07/2026 14:35 · a nombre de: Karen Liseth Ramirez · cuenta 51400008565 · ref: 1234567",
  "",
  "Reglas del comprobante:",
  "- Copia SOLO lo que se lea con claridad. Si un dato no aparece o no se distingue, escribe (no se lee) en su lugar.",
  "- NO inventes ni deduzcas datos que no estén a la vista.",
  "- NO opines sobre si el pago es valido, suficiente o correcto: eso lo decide una persona.",
  "",
  "Si NO es un comprobante, empieza por [IMAGEN] y describe en una linea que se ve.",
  "Ejemplo: [IMAGEN] Foto de un vaso de postre con fresas y crema.",
].join("\n");

/**
 * Describe una imagen recibida. Mismas garantías que el audio: nunca lanza, y
 * si algo falla el mensaje se guarda igual sin descripción.
 */
export async function describirImagen(input: {
  organizationId: string;
  mediaUrl: string;
  mimeType?: string | null;
  apiKey?: string | null;
}): Promise<ResultadoTranscripcion> {
  if (!isAiConfigured()) return { texto: null, motivo: "sin_ia" };
  if (!esOrigenPermitido(input.mediaUrl)) {
    console.warn("[imagen] origen no permitido, se omite");
    return { texto: null, motivo: "origen" };
  }

  const descarga = await descargarMedio(input.mediaUrl, input.apiKey);
  if (!descarga.ok) return { texto: null, motivo: descarga.motivo };

  const env = getEnv();
  const modelo = env.OPENROUTER_MODEL;
  if (!modelo) return { texto: null, motivo: "sin_ia" };

  const mime = input.mimeType?.split(";")[0]?.trim() || "image/jpeg";
  const dataUrl = `data:${mime};base64,${Buffer.from(descarga.datos).toString("base64")}`;

  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: INSTRUCCION_IMAGEN },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[imagen] el proveedor respondió ${res.status}`);
      return { texto: null, motivo: "proveedor" };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };

    await registrarUsoIa(
      input.organizationId,
      {
        model: modelo,
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
        costUsd: json.usage?.cost ?? 0,
      },
      "imagen"
    );

    const texto = json.choices?.[0]?.message?.content?.trim();
    if (!texto) return { texto: null, motivo: "proveedor" };
    return { texto };
  } catch (err) {
    console.warn("[imagen] fallo del proveedor:", err);
    return { texto: null, motivo: "proveedor" };
  }
}
