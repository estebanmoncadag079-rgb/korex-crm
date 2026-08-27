/**
 * Detección determinista de una pregunta factual concreta sobre un método
 * de pago ("¿puedo pagar por Nequi?", "¿aceptan efectivo?"). Mismo
 * principio que `server/catalog/deteccion.ts` (docs/korexia/143), llevado
 * al pago tras el hallazgo de la prueba controlada (doc 145): "¿Puedo
 * pagar por Nequi?" contra Lis obtuvo la respuesta correcta SIN pasar por
 * `consultar_medio_pago` — el modelo respondió leyendo la ficha en prosa,
 * la misma ruta probabilística que ya se corrigió para productos.
 *
 * Reglas de texto conservadoras, sin IA: si hay cualquier señal de
 * pregunta abierta (cómo se paga, qué medios manejan, cuándo se paga),
 * devuelve `null` y el turno sigue exactamente como hoy — el modelo
 * responde con la ficha completa, sin forzar nada.
 */

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .toLowerCase()
    .trim();
}

/**
 * Preguntas ABIERTAS sobre el pago: piden el listado completo o cómo
 * funciona, no confirman un método concreto. Nunca se fuerza nada aquí.
 */
const SEÑALES_ABIERTAS: RegExp[] = [
  // "qué medios/formas/métodos de pago manejan/aceptan/tienen"
  /\bque\s+(medios?|formas?|metodos?)\s+de\s+pago\b/,
  // "cómo puedo pagar", "cómo se paga", "cómo funciona el pago"
  /\bcomo\s+(puedo|puede|podemos|se)\s+pag/,
  /\bcomo\s+funciona\s+el\s+pago\b/,
  // "cuándo se paga", "cuándo hay que pagar"
  /\bcuando\s+(se\s+paga|hay\s+que\s+pagar|debo\s+pagar)\b/,
  // "qué aceptan/reciben" sin nombrar nada: pide la lista, no confirma uno.
  /\bque\s+(aceptan|acepta|reciben|recibe)\b/,
];

/** "¿puedo/puede/podemos pagar por/con/en X?" → captura X. */
const PATRON_PUEDO_PAGAR =
  /\b(?:puedo|puede|podemos)\s+pagar\s+(?:por|con|en)\s+([a-z0-9À-ÿ ]+?)\s*[?¿]*\s*$/i;

/** "¿aceptan/acepta/reciben/recibe (pago(s) por/con/en) X?" → captura X. */
const PATRON_ACEPTAN =
  /\b(?:aceptan|acepta|reciben|recibe)\s+(?:pagos?\s+(?:por|con|en)\s+)?([a-z0-9À-ÿ ]+?)\s*[?¿]*\s*$/i;

/** "¿se puede pagar por/con/en X?" → captura X. */
const PATRON_SE_PUEDE_PAGAR =
  /\bse\s+puede\s+pagar\s+(?:por|con|en)\s+([a-z0-9À-ÿ ]+?)\s*[?¿]*\s*$/i;

/**
 * Devuelve el método de pago mencionado si el mensaje es una pregunta
 * factual concreta ("¿aceptan Nequi?", "¿puedo pagar en efectivo?"), o
 * `null` si es abierta, ambigua, o no menciona ningún método — en cuyo
 * caso el llamante no debe forzar nada.
 */
export function detectarConsultaFactualDeMedioPago(texto: string): string | null {
  if (!texto?.trim()) return null;
  const t = normalizar(texto);
  if (SEÑALES_ABIERTAS.some((re) => re.test(t))) return null;

  for (const patron of [PATRON_PUEDO_PAGAR, PATRON_ACEPTAN, PATRON_SE_PUEDE_PAGAR]) {
    const m = t.match(patron);
    const metodo = m?.[1]?.trim();
    if (metodo && metodo.length >= 2) return metodo;
  }
  return null;
}
