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

  let audio: ArrayBuffer;
  try {
    const res = await fetch(input.mediaUrl, {
      headers: input.apiKey ? { "X-API-Key": input.apiKey } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[transcripción] no se pudo descargar el audio (${res.status})`);
      return { texto: null, motivo: "descarga" };
    }
    const largo = Number(res.headers.get("content-length") ?? 0);
    if (largo > MAX_BYTES) {
      console.warn(`[transcripción] audio demasiado grande (${largo} bytes)`);
      return { texto: null, motivo: "grande" };
    }
    audio = await res.arrayBuffer();
    if (audio.byteLength > MAX_BYTES) {
      return { texto: null, motivo: "grande" };
    }
  } catch (err) {
    console.warn("[transcripción] fallo descargando el audio:", err);
    return { texto: null, motivo: "descarga" };
  }

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
