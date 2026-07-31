import type { z } from "zod";
import { getEnv, isAiConfigured } from "@/lib/env";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Lo que costó una llamada, tal como lo informa el proveedor.
 *
 * El costo NO se estima a partir de los tokens: OpenRouter devuelve el importe
 * exacto en dólares, y estimarlo se desviaría en cuanto cambien las tarifas o
 * el modelo. `costUsd` acumula TODOS los intentos, incluidos los que fallaron
 * y el rescate con el modelo de respaldo — porque esos también se pagan, y un
 * contador que los ignore miente justo cuando más cuesta el turno.
 */
export type AiUsage = {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string; usage?: AiUsage }
  | {
      ok: false;
      error: "not_configured" | "provider_error" | "invalid_output";
      detail: string;
      usage?: AiUsage;
    };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number }
): Promise<ChatJsonResult<T>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_API_TOKEN configurado",
    };
  }
  const env = getEnv();
  const model =
    opts?.model ??
    (opts?.judge
      ? (env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL)
      : env.OPENROUTER_MODEL);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_MODEL configurado",
    };
  }

  const intento = await intentarCon(model, schema, messages, opts?.timeoutMs);
  if (intento.ok) return intento;

  /**
   * Red de seguridad: el modelo de diario es barato, y si un día se atasca con
   * el formato preferimos gastar una llamada en uno más capaz antes que dejar
   * al cliente sin respuesta y el pedido en manos de una persona.
   *
   * Cubre también al juez del Laboratorio. Antes lo dejaba fuera, y el precio
   * se pagaba en confianza: cuando el juez no devolvía un veredicto legible el
   * caso se quedaba SIN calificar y el reporte lo mostraba en blanco, sin que
   * el dueño del negocio pudiera saber si su agente lo había hecho bien o mal.
   * Solo cuesta cuando el barato ya agotó sus tres intentos.
   */
  const respaldo = getEnv().OPENROUTER_FALLBACK_MODEL?.trim();
  if (respaldo && respaldo !== model && !opts?.model) {
    console.warn(
      `[ia] ${model} no devolvió una respuesta usable; reintentando con ${respaldo}`
    );
    const rescate = await intentarCon(respaldo, schema, messages, opts?.timeoutMs);
    // El turno costó lo del modelo barato (que falló) MÁS lo del respaldo.
    // Devolver solo lo segundo escondería el caso más caro del sistema.
    return { ...rescate, usage: sumarUso(intento.usage, rescate.usage) };
  }
  return intento;
}

/** Une lo gastado en dos tandas; el modelo que se nombra es el último usado. */
function sumarUso(a?: AiUsage, b?: AiUsage): AiUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    model: b.model,
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    costUsd: a.costUsd + b.costUsd,
  };
}

/** Los MAX_ATTEMPTS intentos contra UN modelo. */
async function intentarCon<T>(
  model: string,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  timeoutMs?: number
): Promise<ChatJsonResult<T>> {
  let lastDetail = "";
  // Se suma lo gastado en cada intento: un turno que necesitó tres llamadas
  // costó las tres, aunque solo una devolviera algo usable.
  const gastado: AiUsage = { model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const { content: raw, usage } = await callProvider(
        model,
        attemptMessages,
        timeoutMs
      );
      gastado.tokensIn += usage.tokensIn;
      gastado.tokensOut += usage.tokensOut;
      gastado.costUsd += usage.costUsd;
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw, usage: gastado };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
    usage: gastado,
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<{ content: string; usage: AiUsage }> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      // `usage.include` hace que el proveedor devuelva el costo exacto de esta
      // llamada; sin esta línea habría que estimarlo por tokens y tarifa.
      body: JSON.stringify({ model, messages, usage: { include: true } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`proveedor respondió ${res.status}: ${truncate(text)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
      };
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return {
      content,
      usage: {
        model,
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
        costUsd: json.usage?.cost ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
