import { getEnv } from "@/lib/env";
import { countVariables, validateBodyVariables } from "@/server/whatsapp/template-validation";

/**
 * Fase 9D — adaptador server-only de GESTIÓN de plantillas contra la API
 * de YCloud (crear/consultar/listar) — deliberadamente INDEPENDIENTE de
 * `src/lib/ycloud/client.ts` (el cliente de ENVÍO de mensajes, sin tocar
 * en esta fase) y de `src/server/whatsapp/templates.ts` (el dominio local
 * de Korex — `createTemplate`/`sendTemplate`/`enviarTemplateAlProveedor`,
 * ninguno modificado aquí).
 *
 * Cliente HTTP PURO: nunca importa `@/lib/db`, nunca conoce
 * `organizationId` — recibe `apiKey`/`wabaId` ya resueltos por parámetro
 * (Fase 9D, sección 4/19). La resolución de credenciales/organización, y
 * la escritura del resultado en la tabla `template`, son responsabilidad
 * de una capa superior que esta fase NO construye.
 *
 * Fase 9F: la validación de variables se importa de
 * `@/server/whatsapp/template-validation` (módulo puro, sin imports) en
 * vez de `@/server/whatsapp/templates` — ese último arrastraba en su grafo
 * de módulos `@/lib/db`, `@/lib/meta/client`, `@/lib/ycloud/client` de
 * envío, y varios más (hallazgo de acoplamiento de la auditoría 9E). Este
 * archivo ya no importa nada de `templates.ts`, ni directa ni
 * transitivamente.
 *
 * Documentación oficial verificada (Fase 9A/9D, sin asumir nada):
 *   - POST https://api.ycloud.com/v2/whatsapp/templates (crear)
 *   - GET  https://api.ycloud.com/v2/whatsapp/templates (listar, ?wabaId=)
 *   - GET  https://api.ycloud.com/v2/whatsapp/templates/{wabaId}/{name}/{language} (una)
 *   Auth: header `X-API-Key` (misma que el resto de YCloud — nunca
 *   `Authorization`). Ver docs.ycloud.com/reference/whatsapp_template-create
 *   y github.com/YCloud-Developers/ycloud-sdk-java/blob/main/docs/WhatsappTemplatesApi.md.
 */

export class YCloudTemplateError extends Error {
  code:
    | "authentication"
    | "validation"
    | "not_found"
    | "conflict"
    | "rate_limited"
    | "provider_error";
  constructor(code: YCloudTemplateError["code"], message: string) {
    super(message);
    this.name = "YCloudTemplateError";
    this.code = code;
  }
}

/**
 * Timeout PROPIO de la gestión de plantillas — deliberadamente
 * independiente del timeout de ENVÍO de mensajes (`REINTENTOS_MS`/
 * `timeoutMs` de `ycloud/client.ts`, sin tocar): son operaciones distintas,
 * con sus propios plazos razonables. Valor OPERATIVO inicial (mismo
 * criterio que `TIMEOUT_ENVIO_CAMPANA_MS`, Fase 6C) — no representa un
 * límite oficial de YCloud, ajustable cambiando esta constante.
 */
export const TIMEOUT_GESTION_TEMPLATE_YCLOUD_MS = 15_000;

/**
 * El resultado de UN intento de gestión de plantilla — nunca lanzado,
 * siempre devuelto (mismo espíritu que `ResultadoProveedor` de
 * `templates.ts`, Fase 5C, reutilizado aquí como PATRÓN, no como código):
 * separa "el proveedor respondió con certeza" (`EXPLICIT_FAILURE`) de "no
 * se sabe si el proveedor procesó" (`AMBIGUOUS`) — crítico para crear
 * plantillas, donde reintentar a ciegas un ambiguo podría crear un
 * duplicado o un conflicto de nombre en YCloud/Meta.
 */
export type ResultadoCreacionTemplateYCloud =
  | {
      kind: "SUCCESS";
      providerTemplateId: string;
      providerName: string;
      providerLanguage: string;
      providerCategory: string;
      providerStatus: string;
    }
  | { kind: "EXPLICIT_FAILURE"; code: YCloudTemplateError["code"]; error: string; causa: unknown }
  | { kind: "AMBIGUOUS"; error: string; causa: unknown };

export type TemplateYCloudMapeado = {
  providerTemplateId: string;
  name: string;
  language: string;
  category: string;
  /** El estado CRUDO tal como lo devuelve YCloud (PENDING/APPROVED/...) — nunca traducido aquí. */
  providerStatus: string;
  /** Fase 10D — solo presentes si YCloud los devolvió en `components`. */
  body?: string;
  header?: HeaderYCloudResuelto;
  footer?: string;
};

export type ResultadoConsultaTemplateYCloud =
  | { kind: "SUCCESS"; template: TemplateYCloudMapeado }
  | { kind: "NOT_FOUND" }
  | { kind: "EXPLICIT_FAILURE"; code: YCloudTemplateError["code"]; error: string; causa: unknown }
  | { kind: "AMBIGUOUS"; error: string; causa: unknown };

export type ResultadoListadoTemplatesYCloud =
  | { kind: "SUCCESS"; templates: TemplateYCloudMapeado[] }
  | { kind: "EXPLICIT_FAILURE"; code: YCloudTemplateError["code"]; error: string; causa: unknown }
  | { kind: "AMBIGUOUS"; error: string; causa: unknown };

/**
 * Fase 9P — header/footer YA RESUELTOS (URL/text reales, nunca un
 * `mediaAssetId`): resolver la referencia contra `media_asset` es
 * responsabilidad de la capa de dominio (`templates.ts`, que sí toca DB) —
 * este adaptador se mantiene un cliente HTTP puro, sin ninguna dependencia
 * nueva (Fase 9F/9G: la independencia de `ycloud-templates.ts` respecto a
 * `@/lib/db` y clientes de envío es deliberada y auditada, no se reintroduce
 * aquí).
 */
export type HeaderYCloudResuelto =
  | { type: "IMAGE"; url: string }
  | { type: "TEXT"; text: string };

/**
 * Korex → payload YCloud (Fase 9D, sección 5; extendido en Fase 9P para
 * HEADER/FOOTER). Formato confirmado contra la documentación oficial
 * (`whatsapp-template-creation-examples`): un componente `BODY` obligatorio,
 * `example.body_text` como array de arrays SOLO cuando el body tiene una
 * variable — mismo esquema que ya usa `createTemplate()` legacy para Meta
 * Graph directo (BSPs replican el esquema estándar de Meta). Reutiliza
 * `countVariables()` de `template-validation.ts` (módulo puro, sin
 * imports) para no duplicar la regla de "0 o 1 variable {{1}}" en dos
 * sitios.
 *
 * `header`/`footer` son opcionales — el orden HEADER→BODY→FOOTER coincide
 * con el ejemplo oficial de YCloud (Fase 9O, WebFetch). `header.type==="IMAGE"`
 * arma `example.header_url` como array de un elemento (formato confirmado);
 * `header.type==="TEXT"` arma `example.header_text`.
 */
export function mapTemplateToYCloudPayload(input: {
  wabaId: string;
  name: string;
  language: string;
  category: string;
  body: string;
  /** Valor de ejemplo para {{1}} — YCloud lo exige cuando el body tiene variable. */
  variableExample?: string;
  header?: HeaderYCloudResuelto;
  footer?: string;
}): Record<string, unknown> {
  const needsVariable = countVariables(input.body) === 1;
  const headerComponent =
    input.header?.type === "IMAGE"
      ? { type: "HEADER", format: "IMAGE", example: { header_url: [input.header.url] } }
      : input.header?.type === "TEXT"
        ? { type: "HEADER", format: "TEXT", text: input.header.text }
        : null;
  const footerComponent = input.footer ? { type: "FOOTER", text: input.footer } : null;

  return {
    wabaId: input.wabaId,
    name: input.name,
    language: input.language,
    category: input.category,
    components: [
      ...(headerComponent ? [headerComponent] : []),
      {
        type: "BODY",
        text: input.body,
        ...(needsVariable
          ? { example: { body_text: [[(input.variableExample ?? "").trim() || "ejemplo"]] } }
          : {}),
      },
      ...(footerComponent ? [footerComponent] : []),
    ],
  };
}

/**
 * Fase 10D — extrae header/body/footer del array `components` crudo que
 * devuelve YCloud (mismo esquema estándar de Meta que ya usa
 * `mapTemplateToYCloudPayload` para CREAR — HEADER/BODY/FOOTER con
 * mayúsculas). Pura, defensiva: cualquier forma inesperada (no es array,
 * falta un campo) simplemente omite esa pieza en vez de lanzar — una
 * plantilla sincronizada con menos detalle sigue siendo mejor que ninguna.
 */
function extraerComponentesDelTemplateYCloud(
  raw: unknown
): { body?: string; header?: HeaderYCloudResuelto; footer?: string } {
  const componentes = (raw as { components?: unknown })?.components;
  if (!Array.isArray(componentes)) return {};

  let body: string | undefined;
  let header: HeaderYCloudResuelto | undefined;
  let footer: string | undefined;

  for (const c of componentes) {
    const comp = c as {
      type?: string;
      format?: string;
      text?: string;
      example?: { header_url?: unknown[] };
    };
    const tipo = (comp.type ?? "").toUpperCase();
    if (tipo === "BODY" && typeof comp.text === "string") {
      body = comp.text;
    } else if (tipo === "HEADER") {
      if (comp.format === "IMAGE") {
        const url = comp.example?.header_url?.[0];
        if (typeof url === "string" && url) header = { type: "IMAGE", url };
      } else if (comp.format === "TEXT" && typeof comp.text === "string") {
        header = { type: "TEXT", text: comp.text };
      }
    } else if (tipo === "FOOTER" && typeof comp.text === "string") {
      footer = comp.text;
    }
  }
  return { body, header, footer };
}

/**
 * Respuesta YCloud → forma interna del adaptador (Fase 9D, sección 5/10).
 * Solo EXTRAE campos — nunca traduce `status` a los valores internos de
 * Korex (draft/pending/approved/rejected): esa traducción es
 * responsabilidad de la capa superior (Fase 9D, sección 11).
 */
export function mapYCloudTemplateToKorex(raw: unknown): TemplateYCloudMapeado {
  const r = (raw ?? {}) as {
    officialTemplateId?: string;
    name?: string;
    language?: string;
    category?: string;
    status?: string;
  };
  return {
    providerTemplateId: r.officialTemplateId ?? "",
    name: r.name ?? "",
    language: r.language ?? "",
    category: r.category ?? "",
    providerStatus: r.status ?? "",
    ...extraerComponentesDelTemplateYCloud(raw),
  };
}

/**
 * Fase 9F — valida que una respuesta 2xx de YCloud tenga la forma mínima
 * de un template real, antes de poder llamarla SUCCESS. La auditoría 9E
 * encontró que `{}`, `null`, o una estructura incompleta pasaban como
 * SUCCESS con `providerTemplateId: ""` — esta función es la guardia única
 * que create/get comparten para que eso no vuelva a pasar.
 *
 * Exige los tres campos que identifican una plantilla sin ambigüedad
 * (el id que le dio el proveedor, más name+language — el mismo par que ya
 * usa el UNIQUE de Korex): ninguno puede ser un string vacío tras recortar
 * espacios. No valida `category`/`providerStatus`: son datos de la
 * plantilla, no de su identidad.
 */
function esRespuestaDeTemplateValida(mapeado: TemplateYCloudMapeado): boolean {
  return (
    mapeado.providerTemplateId.trim().length > 0 &&
    mapeado.name.trim().length > 0 &&
    mapeado.language.trim().length > 0
  );
}

/**
 * Fase 9F — valida que una respuesta 2xx de YCloud tenga la forma mínima
 * de una LISTA (distingue "lista válida vacía" de "respuesta vacía o
 * malformada", auditoría 9E sección 2): exige que exista la clave `data`
 * y que sea un array — un array vacío es una lista válida, `{}`/`null`/
 * `data` no-array no lo son.
 */
function extraerListaDeTemplates(json: unknown): unknown[] | null {
  if (json === null || typeof json !== "object") return null;
  /**
   * `items` es lo que YCloud devuelve DE VERDAD en
   * `GET /v2/whatsapp/templates`. Verificado contra producción el
   * 15-sep-2026 con el WABA de Camilabrandcol:
   *
   *     { "offset": 0, "limit": 10, "length": 1, "items": [ … ] }
   *
   * Hasta ese día aquí solo se leía `data`, así que toda respuesta real
   * caía en `AMBIGUOUS` ("2xx sin una lista reconocible") y **la
   * sincronización nunca pudo traer una sola plantilla**. No se detectó
   * antes porque esta función no tuvo ningún caller en producción hasta
   * la Fase 10D (ver el comentario de `sync-ycloud-templates.ts`), y
   * porque su prueba unitaria daba por buena la forma `data[]` sin
   * haberla contrastado nunca con la API.
   *
   * Se siguen aceptando las dos: `items` es la real; `data` se conserva
   * por si alguna ruta del proveedor la usa, y para no romper nada que
   * ya dependiera de ella.
   */
  const contenedor = json as { items?: unknown; data?: unknown };
  if (Array.isArray(contenedor.items)) return contenedor.items;
  if (Array.isArray(contenedor.data)) return contenedor.data;
  return null;
}

/** 401/403 auth, 404 not_found, 409 conflict, 429 rate_limited, cualquier otro 4xx → validation. Nunca se llama para 5xx (esos son AMBIGUOUS, más arriba). */
function clasificarStatusHttp4xx(status: number): YCloudTemplateError["code"] {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "validation";
}

/** Formato de error confirmado (`WhatsappApiError`, mismo esquema que Meta Graph): `message` es el campo real. */
function extraerMensajeDeError(json: unknown, status: number): string {
  const j = json as { message?: string } | null;
  return j?.message ?? `YCloud respondió ${status}`;
}

/**
 * Crea EXACTAMENTE una plantilla en YCloud — un solo POST, SIN retry
 * (Fase 9D, sección 9: reintentar automáticamente un timeout/red ambiguo
 * podría crear un duplicado del lado de YCloud/Meta, o topar con el
 * conflicto de nombre que YA se estaba creando en el intento anterior).
 * La API key NUNCA se loguea, nunca aparece en ningún mensaje de error.
 */
export async function crearTemplateYCloud(input: {
  apiKey: string;
  wabaId: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variableExample?: string;
  timeoutMs?: number;
  /** Fase 9P — ya resueltos (URL/texto reales), nunca un `mediaAssetId`. */
  header?: HeaderYCloudResuelto;
  footer?: string;
}): Promise<ResultadoCreacionTemplateYCloud> {
  // Fase 9F: rechazo local (cero HTTP) de cualquier cantidad de variables
  // no soportada por el motor — antes solo se rechazaba "{{1}} sin
  // variableExample"; {{2}} sola, {{3}}, o 2+ variables pasaban sin
  // validar y dependían de que YCloud las rechazara del lado remoto.
  const variableError = validateBodyVariables(input.body);
  if (variableError) {
    return { kind: "EXPLICIT_FAILURE", code: "validation", error: variableError, causa: null };
  }

  const needsVariable = countVariables(input.body) === 1;
  if (needsVariable && !input.variableExample?.trim()) {
    return {
      kind: "EXPLICIT_FAILURE",
      code: "validation",
      error: "La plantilla tiene {{1}} pero no se proporcionó un valor de ejemplo",
      causa: null,
    };
  }

  const payload = mapTemplateToYCloudPayload(input);
  const env = getEnv();
  const timeoutMs = input.timeoutMs ?? TIMEOUT_GESTION_TEMPLATE_YCLOUD_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${env.YCLOUD_BASE_URL}/v2/whatsapp/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": input.apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    // fetch lanzó: red, DNS, o AbortError por vencimiento del timeout — el
    // POST puede o no haber llegado a YCloud. SIEMPRE ambiguo, nunca se
    // reintenta desde aquí (sección 9).
    return { kind: "AMBIGUOUS", error: err instanceof Error ? err.message : String(err), causa: err };
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const mensaje = extraerMensajeDeError(json, res.status);
    if (res.status >= 500) {
      // YCloud respondió, pero con un error de servidor: pudo haber
      // empezado a procesar (y crear la plantilla del lado de Meta) antes
      // de fallar — mismo criterio ya validado para el envío de mensajes.
      return { kind: "AMBIGUOUS", error: mensaje, causa: json };
    }
    return { kind: "EXPLICIT_FAILURE", code: clasificarStatusHttp4xx(res.status), error: mensaje, causa: json };
  }

  const mapeado = mapYCloudTemplateToKorex(json);
  if (!esRespuestaDeTemplateValida(mapeado)) {
    // 2xx sin forma mínima de template (id/name/language) — la respuesta
    // no tiene la forma esperada, no se puede afirmar éxito con certeza.
    return { kind: "AMBIGUOUS", error: "YCloud respondió 2xx sin una estructura de template reconocible", causa: json };
  }
  return {
    kind: "SUCCESS",
    providerTemplateId: mapeado.providerTemplateId,
    providerName: mapeado.name,
    providerLanguage: mapeado.language,
    providerCategory: mapeado.category,
    providerStatus: mapeado.providerStatus,
  };
}

/**
 * Consulta UNA plantilla por nombre+idioma (`GET .../templates/{wabaId}/{name}/{language}`).
 * Idempotente por naturaleza — sin protección especial contra
 * doble-llamada (no hay nada que duplicar en una lectura), pero SIN retry
 * propio tampoco (Fase 9D, sección 9: no introducirlo sin necesidad
 * demostrada).
 */
export async function obtenerTemplateYCloud(input: {
  apiKey: string;
  wabaId: string;
  name: string;
  language: string;
  timeoutMs?: number;
}): Promise<ResultadoConsultaTemplateYCloud> {
  const env = getEnv();
  const timeoutMs = input.timeoutMs ?? TIMEOUT_GESTION_TEMPLATE_YCLOUD_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(
      `${env.YCLOUD_BASE_URL}/v2/whatsapp/templates/${encodeURIComponent(input.wabaId)}/${encodeURIComponent(input.name)}/${encodeURIComponent(input.language)}`,
      { method: "GET", headers: { "X-API-Key": input.apiKey } }
    );
  } catch (err) {
    return { kind: "AMBIGUOUS", error: err instanceof Error ? err.message : String(err), causa: err };
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const mensaje = extraerMensajeDeError(json, res.status);
    if (res.status === 404) return { kind: "NOT_FOUND" };
    if (res.status >= 500) return { kind: "AMBIGUOUS", error: mensaje, causa: json };
    return { kind: "EXPLICIT_FAILURE", code: clasificarStatusHttp4xx(res.status), error: mensaje, causa: json };
  }

  // Fase 9F: un 200 con {}, null, o campos vacíos NO es SUCCESS — antes
  // faltaba esta guardia (la auditoría 9E la encontró como hallazgo ALTO),
  // simétrica a la que crearTemplateYCloud ya tenía.
  const mapeado = mapYCloudTemplateToKorex(json);
  if (!esRespuestaDeTemplateValida(mapeado)) {
    return { kind: "AMBIGUOUS", error: "YCloud respondió 2xx sin una estructura de template reconocible", causa: json };
  }

  return { kind: "SUCCESS", template: mapeado };
}

/**
 * Lista las plantillas de un WABA (`GET .../templates?wabaId=...`) — usada
 * para sincronizar estados en lote. Sin filtros de estado en esta fase
 * (fuera de alcance: solo lo mínimo necesario, sección 2).
 */
export async function listarTemplatesYCloud(input: {
  apiKey: string;
  wabaId: string;
  timeoutMs?: number;
}): Promise<ResultadoListadoTemplatesYCloud> {
  const env = getEnv();
  const timeoutMs = input.timeoutMs ?? TIMEOUT_GESTION_TEMPLATE_YCLOUD_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(
      `${env.YCLOUD_BASE_URL}/v2/whatsapp/templates?wabaId=${encodeURIComponent(input.wabaId)}`,
      { method: "GET", headers: { "X-API-Key": input.apiKey } }
    );
  } catch (err) {
    return { kind: "AMBIGUOUS", error: err instanceof Error ? err.message : String(err), causa: err };
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const mensaje = extraerMensajeDeError(json, res.status);
    if (res.status >= 500) return { kind: "AMBIGUOUS", error: mensaje, causa: json };
    return { kind: "EXPLICIT_FAILURE", code: clasificarStatusHttp4xx(res.status), error: mensaje, causa: json };
  }

  // Fase 9F: distingue "lista válida vacía" (data: [] — sin plantillas, un
  // resultado real) de "respuesta vacía o malformada" ({}, null, data que
  // no es un array — no se sabe qué respondió el proveedor). Antes ambos
  // casos se aplanaban silenciosamente a `templates: []` (hallazgo ALTO de
  // la auditoría 9E, sección 2).
  const lista = extraerListaDeTemplates(json);
  if (lista === null) {
    return { kind: "AMBIGUOUS", error: "YCloud respondió 2xx sin una lista reconocible", causa: json };
  }
  return { kind: "SUCCESS", templates: lista.map(mapYCloudTemplateToKorex) };
}
