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
  opts?: {
    model?: string;
    judge?: boolean;
    timeoutMs?: number;
    /**
     * El esquema JSON que se le exige al PROVEEDOR (salidas estructuradas).
     *
     * Zod sigue siendo quien valida lo que llega; esto es lo que evita que haya
     * que pedirlo por escrito y rezar. Medido el 19-ago-2026: sin él,
     * `gemini-2.5-flash` **jamás** añade una clave de nivel superior junto a la
     * acción por mucho que el prompt se lo pida (0 de 3, incluso con un prompt
     * de tres líneas); con él, 3 de 3.
     *
     * ⚠️ El esquema debe declarar TODOS los campos que se esperan: el modelo
     * emite solo lo declarado. Con uno que solo pedía `action` y `estado`, la
     * respuesta perdió el `text` y el cliente se habría quedado sin contestación.
     *
     * Si el proveedor lo rechaza (un modelo sin soporte), se reintenta sin él:
     * degradar al comportamiento de siempre es preferible a perder el turno.
     */
    jsonSchema?: unknown;
  }
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

  /**
   * La cadena: el modelo de diario y, detrás, hasta dos salvavidas.
   *
   * ## Por qué existe otra vez
   *
   * Hubo un respaldo, se quitó el 31-jul-2026 y otra vez el 13-ago con este
   * criterio: si el modelo no logra resolver una conversación, lo que necesita
   * ese cliente no es otro modelo, es una PERSONA. **El dueño se retractó el
   * 9-sep-2026** y pidió reponerlo con dos escalones, para medir si ayudan
   * antes de decidir el modelo de diario.
   *
   * ## Qué NO cambia
   *
   * El rescate humano sigue siendo el último: agotada la cadena entera,
   * `runAgentTurn` avisa al cliente y deriva con `handoff`. Los salvavidas se
   * meten ANTES de eso, no en su lugar.
   *
   * ## Cuándo entra un salvavidas
   *
   * Solo cuando el anterior agotó sus `MAX_ATTEMPTS` y devolvió `provider_error`
   * o `invalid_output` — es decir, cuando NO hay respuesta usable. **No entra
   * porque una respuesta parezca mala**: eso no tiene detector aquí, y confundir
   * "no contestó" con "contestó regular" convertiría el salvavidas en una
   * segunda opinión aleatoria que nadie pidió. Un modelo mal configurado
   * (`not_configured`) tampoco encadena: eso se arregla, no se rodea.
   *
   * ## Lo que se aprendió de la vez anterior
   *
   * El retiro de agosto salió mal por algo operativo: se quitó el código pero
   * la variable quedó puesta en el servidor, y Sonnet siguió entrando en
   * conversaciones reales durante semanas mientras la documentación decía que
   * el respaldo no existía. Por eso ahora **cada salvavidas que entra deja un
   * `console.warn`, y el modelo que de verdad contestó viaja en `usage.model`**
   * hasta la traza del turno. Si un salvavidas está trabajando, se ve; no hay
   * que fiarse de dónde uno cree que está la variable.
   */
  const cadena = [model, env.OPENROUTER_FALLBACK_MODEL, env.OPENROUTER_FALLBACK_MODEL_2]
    .map((m) => m?.trim())
    .filter((m): m is string => Boolean(m));

  let ultimo!: ChatJsonResult<T>;
  const acumulado: AiUsage = { model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  for (const [i, candidato] of cadena.entries()) {
    if (i > 0) {
      console.warn(
        `[ia] ${cadena[i - 1]} agotó sus intentos (${ultimo.ok ? "" : ultimo.detail}); ` +
          `entra el salvavidas ${candidato}`
      );
    }
    ultimo = await intentarCon(candidato, schema, messages, opts?.timeoutMs, opts?.jsonSchema);
    if (ultimo.usage) {
      // Lo gastado por los que fallaron TAMBIÉN se pagó: un contador que solo
      // mire al que respondió miente justo en el turno más caro.
      acumulado.tokensIn += ultimo.usage.tokensIn;
      acumulado.tokensOut += ultimo.usage.tokensOut;
      acumulado.costUsd += ultimo.usage.costUsd;
      // El modelo que de verdad contestó, no el que se intentó primero.
      acumulado.model = ultimo.usage.model;
    }
    if (ultimo.ok) break;
  }
  return { ...ultimo, usage: acumulado };
}

/** Los MAX_ATTEMPTS intentos contra UN modelo. */
async function intentarCon<T>(
  model: string,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  timeoutMs?: number,
  jsonSchema?: unknown
): Promise<ChatJsonResult<T>> {
  // Se apaga solo si el proveedor lo rechaza: un modelo sin salidas
  // estructuradas debe seguir atendiendo, no quedarse sin turno.
  let esquemaDelProveedor = jsonSchema;
  let lastDetail = "";
  const CORRECCION_GENERICA =
    "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.";
  /**
   * El mensaje de corrección para el PRÓXIMO intento (docs/korexia/144).
   *
   * Antes era siempre el genérico de arriba, sin importar POR QUÉ había
   * fallado el intento anterior — "no fue JSON válido" para una respuesta
   * que sí era JSON pero le faltaba un campo concreto. Con el detalle real
   * de Zod (qué campo, qué exigía) el modelo tiene la corrección exacta que
   * necesita en vez de tener que adivinar qué estuvo mal, y sube la chance
   * de que el reintento (que ya existía, `MAX_ATTEMPTS`) tenga éxito.
   */
  let correccionParaElSiguiente = CORRECCION_GENERICA;
  // Se suma lo gastado en cada intento: un turno que necesitó tres llamadas
  // costó las tres, aunque solo una devolviera algo usable.
  const gastado: AiUsage = { model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [...messages, { role: "system", content: correccionParaElSiguiente }];
    try {
      const { content: raw, usage } = await callProvider(
        model,
        attemptMessages,
        timeoutMs,
        esquemaDelProveedor
      );
      gastado.tokensIn += usage.tokensIn;
      gastado.tokensOut += usage.tokensOut;
      gastado.costUsd += usage.costUsd;
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        correccionParaElSiguiente = CORRECCION_GENERICA;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        const detalle = parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ");
        lastDetail = `no cumple el esquema: ${detalle} (raw=${truncate(raw)})`;
        correccionParaElSiguiente = `STRICT: tu respuesta anterior no cumplió el contrato exacto: ${detalle}. Corrige ÚNICAMENTE eso, sin cambiar de acción si sigue siendo la correcta. Responde ÚNICAMENTE el objeto JSON.`;
        continue;
      }
      return { ok: true, data: parsed.data, raw, usage: gastado };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      // Error de red/proveedor, no de contenido: no hay un campo concreto
      // que corregir, así que el próximo intento vuelve al mensaje genérico.
      correccionParaElSiguiente = CORRECCION_GENERICA;
      /*
       * Un proveedor que no admite salidas estructuradas responde 4xx nombrando
       * `response_format`. No es un fallo del turno: se reintenta sin el
       * esquema y ese modelo se queda con el comportamiento de siempre.
       */
      if (esquemaDelProveedor && /response_format|json_schema/i.test(lastDetail)) {
        console.warn(
          `[ia] ${model} no admite salidas estructuradas; se sigue sin ellas: ${truncate(lastDetail)}`
        );
        esquemaDelProveedor = undefined;
      }
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
  timeoutMs = 60_000,
  jsonSchema?: unknown
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
      body: JSON.stringify({
        model,
        messages,
        usage: { include: true },
        ...(jsonSchema ? { response_format: jsonSchema } : {}),
      }),
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
