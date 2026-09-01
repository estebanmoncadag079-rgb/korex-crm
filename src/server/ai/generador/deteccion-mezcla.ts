/**
 * Analiza texto que un negocio escribe en un campo configurable de su ficha
 * (ej. `entrega.quienPagaElDomicilio`, `entrega.restricciones`) para detectar
 * señales de que ese texto mezcla contenido para el cliente con una
 * instrucción dirigida al agente — el mismo patrón que causó el incidente
 * real de Lis (1-sep-2026, auditoría de fichas de configuración): el campo
 * decía "El domicilio lo paga el cliente... No inventes, asumas ni sumes el
 * valor del domicilio... informa al cliente: ...", y el compilador
 * (`generar.ts`) marca ese campo para citarse LITERAL — el agente terminó
 * recitando la instrucción interna al cliente real.
 *
 * Es SOLO una capa de advertencia: nunca modifica, corrige ni rechaza el
 * texto. Mismo espíritu conservador que `catalog/deteccion.ts` — ante la
 * duda, no marca nada.
 *
 * Deliberadamente NO detecta por palabras sueltas ("nunca", "siempre",
 * "debes"): eso generaría demasiados falsos positivos sobre política
 * comercial legítima ("Nunca congelamos los productos", "El pedido debe
 * pagarse antes de las 5 PM"). Detecta CAMBIO DE AUDIENCIA — frases
 * gramaticalmente dirigidas al agente (imperativo/subjuntivo negativo de 2ª
 * persona sin sujeto explícito, referencias directas a "el agente/bot",
 * notas meta autoreferenciales) en vez de al cliente o al negocio hablando
 * de sí mismo en 1ª persona plural ("congelamos", "aceptamos").
 */

import type { FichaDelNegocio } from "./ficha";

export type TipoAdvertenciaContenido =
  | "posible_instruccion_agente"
  | "nota_meta"
  | "mezcla_de_audiencia";

export type AdvertenciaContenidoConfigurable = {
  tipo: TipoAdvertenciaContenido;
  severidad: "info" | "warning";
  /** El fragmento del texto original que disparó la advertencia, recortado. */
  fragmento: string;
  mensaje: string;
};

export type ResultadoAnalisisContenido = {
  advertencias: AdvertenciaContenidoConfigurable[];
};

/**
 * Verbos en su forma imperativa/subjuntiva NEGATIVA de 2ª persona singular
 * ("no inventes", "nunca prometas", "no le pidas"). A propósito NO es la
 * lista de infinitivos ni de 1ª persona plural ("inventamos", "prometemos",
 * "pedimos") — así es como un negocio habla de sí mismo, y nunca debe
 * marcarse: "Nunca congelamos los productos" es contenido legítimo,
 * "Nunca prometas que podemos entregar hoy" es una orden al agente. Son
 * formas verbales distintas, no la misma palabra con contexto ambiguo.
 */
const VERBOS_ORDEN_NEGATIVA =
  "inventes|asumas|prometas|digas|ofrezcas|sumes|incluyas|menciones|respondas|confirmes|olvides|cambies|alteres|pidas";

/** Señales gramaticales de que la frase se dirige al agente, no al cliente. */
const PATRONES_INSTRUCCION_AGENTE: RegExp[] = [
  new RegExp(`\\b(?:no|nunca)\\s+(?:le\\s+)?(?:${VERBOS_ORDEN_NEGATIVA})\\b`),
  // "informa al cliente", "dile al cliente", "pregúntale al cliente" — verbo
  // de habla con "al cliente" como OBJETO de la orden, nunca como quien lee.
  /\b(?:informa|dile|preg[uú]ntale|expl[ií]cale|av[ií]sale)\s+al\s+cliente\b/,
  // "tu trabajo/tarea/rol es" — describe el papel del agente.
  /\btu\s+(?:trabajo|tarea|rol|funci[oó]n)\s+es\b/,
  // "el agente/bot/asistente/la IA debe/nunca/siempre" — sujeto explícito
  // es el agente, no el negocio ni el cliente.
  /\b(?:el\s+(?:agente|bot|asistente|modelo)|la\s+ia)\s+(?:debe|tiene\s+que|nunca|siempre)\b/,
  // "antes de X, pregunta/confirma/pide/verifica..." — orden condicionada
  // dirigida a quien atiende, no una política que el cliente deba seguir.
  /\bantes\s+de\s+[^,.]+,\s*(?:pregunta(?:le)?|confirma|pide(?:le)?|verifica|revisa|aseg[uú]rate)\b/,
];

/** Notas internas o meta-comentarios: nunca son ni dato ni regla, son ruido de redacción. */
const PATRONES_NOTA_META: RegExp[] = [
  /\((?:esta|esa)\s+(?:frase|respuesta|l[ií]nea|nota|texto)\s+es\b/,
  /\[[^\]]*\b(?:bot|agente|ia|asistente)\b[^\]]*\]/,
  /\bnota\s+para\s+el\s+(?:bot|agente|asistente)\b/,
  /\bpara\s+el\s+(?:bot|agente|asistente)\s*:/,
  /\binstrucci[oó]n\s*:/,
];

function primerMatch(texto: string, patrones: RegExp[]): RegExpMatchArray | null {
  for (const p of patrones) {
    const m = texto.match(p);
    if (m) return m;
  }
  return null;
}

function recortar(s: string, maximo = 160): string {
  const t = s.trim();
  return t.length > maximo ? `${t.slice(0, maximo)}…` : t;
}

/**
 * Divide el texto en segmentos (oraciones o párrafos) para poder comparar
 * "esta parte parece cliente" contra "esta otra parte parece agente" — es
 * lo que distingue una mezcla real ("El domicilio lo paga el cliente. No
 * inventes el valor.", dos oraciones de audiencia distinta) de un texto que
 * es ínteramente una instrucción ("Tu trabajo es cerrar pedidos hablando
 * poco.", una sola oración, sin nada más que comparar).
 */
function segmentos(texto: string): string[] {
  return texto
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Analiza un campo de texto libre configurable por el negocio y advierte si
 * parece mezclar contenido para el cliente con una instrucción dirigida al
 * agente, o con una nota interna.
 *
 * Pura, determinista, sin acceso a base de datos ni a ninguna organización
 * concreta — el mismo texto produce siempre el mismo resultado, sin
 * importar de qué negocio venga.
 *
 * NO modifica el texto. NO lo corrige. Solo devuelve advertencias para que
 * la UI o la API decidan qué mostrar — el guardado nunca se bloquea por
 * esto.
 */
export function analizarContenidoConfigurable(
  texto: string | null | undefined
): ResultadoAnalisisContenido {
  if (!texto?.trim()) return { advertencias: [] };

  const partes = segmentos(texto);
  const advertencias: AdvertenciaContenidoConfigurable[] = [];
  let huboInstruccionONota = false;
  let huboSegmentoLimpio = false;

  for (const parte of partes) {
    const baja = parte.toLowerCase();
    const matchInstruccion = primerMatch(baja, PATRONES_INSTRUCCION_AGENTE);
    const matchMeta = primerMatch(baja, PATRONES_NOTA_META);

    // Independientes a propósito: una nota entre paréntesis pegada a la
    // misma oración que la instrucción ("No inventes X. (Nota para el
    // bot: ...)" sin salto de línea) debe poder disparar AMBAS
    // advertencias, no solo la primera que se pruebe.
    if (matchInstruccion) {
      advertencias.push({
        tipo: "posible_instruccion_agente",
        severidad: "warning",
        fragmento: recortar(parte),
        mensaje:
          "Este texto parece contener una instrucción dirigida al agente, no información para el cliente.",
      });
    }
    if (matchMeta) {
      advertencias.push({
        tipo: "nota_meta",
        severidad: "warning",
        fragmento: recortar(parte),
        mensaje: "Este texto parece una nota interna, no contenido para el cliente ni una regla del agente.",
      });
    }
    if (matchInstruccion || matchMeta) {
      huboInstruccionONota = true;
    } else if (parte.length >= 15) {
      huboSegmentoLimpio = true;
    }
  }

  // Solo se marca "mezcla" cuando hay al menos un segmento distinto que
  // parece contenido normal Y otro que parece instrucción/nota — no cuando
  // el campo entero es una sola oración instructiva (eso ya lo cubre la
  // advertencia individual de arriba).
  if (huboInstruccionONota && huboSegmentoLimpio) {
    advertencias.push({
      tipo: "mezcla_de_audiencia",
      severidad: "info",
      fragmento: recortar(texto),
      mensaje:
        "Este campo parece mezclar contenido para el cliente con una instrucción para el agente en el mismo texto.",
    });
  }

  return { advertencias };
}

/**
 * Los campos de la ficha con mayor "radio de explosión" si el negocio
 * escribe ahí una instrucción para el agente en vez de solo el dato: los
 * únicos que el compilador (`generar.ts`, `comoRecibe`/`comoPagan`) marca
 * para citarse literal o casi literal al cliente. Deliberadamente corta —
 * el resto de campos de texto libre no tienen esa marca de cita forzada, así
 * que el mismo error ahí pesa menos (ver la auditoría de fichas,
 * 1-sep-2026, Fase 2B).
 */
const CAMPOS_DE_MAYOR_RIESGO: {
  campo: string;
  leer: (f: Partial<FichaDelNegocio>) => string | null | undefined;
}[] = [
  { campo: "entrega.quienPagaElDomicilio", leer: (f) => f.entrega?.quienPagaElDomicilio },
  { campo: "pago.datosDeCuenta", leer: (f) => f.pago?.datosDeCuenta },
];

export type AdvertenciaDeCampo = AdvertenciaContenidoConfigurable & { campo: string };

/**
 * Analiza los campos de mayor riesgo de una ficha (borrador o aplicada) y
 * devuelve sus advertencias, cada una con el nombre del campo al que
 * pertenece. Pura, sin acceso a base de datos — el llamante (la API de
 * onboarding) decide qué hacer con el resultado; esta función nunca
 * bloquea ni modifica nada.
 */
export function advertenciasDeFicha(ficha: Partial<FichaDelNegocio>): AdvertenciaDeCampo[] {
  const todas: AdvertenciaDeCampo[] = [];
  for (const { campo, leer } of CAMPOS_DE_MAYOR_RIESGO) {
    const { advertencias } = analizarContenidoConfigurable(leer(ficha));
    for (const a of advertencias) todas.push({ campo, ...a });
  }
  return todas;
}
