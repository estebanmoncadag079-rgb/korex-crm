/**
 * Detección determinista de una pregunta factual concreta sobre un producto
 * ("¿tienen torta de chocolate?", "¿cuánto cuesta la porción de chocolate?").
 *
 * Nace de un hallazgo de la prueba controlada con Lis (26-ago-2026,
 * docs/korexia/142): `consultar_producto` funciona, pero el modelo no
 * siempre decide usarla — a veces resuelve directo con el catálogo en prosa
 * que sigue en el prompt, y eso es exactamente la ruta probabilística que se
 * quería dejar de depender para preguntas de este tipo. Este archivo NO es
 * un clasificador de intención ni un segundo LLM: son reglas de texto
 * conservadoras que, cuando coinciden con seguridad, permiten que el
 * SERVIDOR dispare la verificación por su cuenta, sin esperar a que el
 * modelo decida.
 *
 * Deliberadamente conservador: ante la duda, devuelve `null` (no fuerza
 * nada) y la conversación sigue exactamente como hoy — con el modelo
 * decidiendo libremente, catálogo en prosa incluido. Forzar de más
 * convertiría cualquier mención de un producto en una búsqueda única,
 * exactamente lo que se pidió evitar para preguntas abiertas o de
 * recomendación.
 */

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .toLowerCase()
    .trim();
}

/**
 * Si el mensaje trae cualquiera de estas señales, es una pregunta ABIERTA
 * (recomendación, categoría completa, ocasión) y nunca se fuerza una
 * búsqueda de un solo producto — el modelo sigue respondiendo con el
 * catálogo completo, como siempre.
 */
const SEÑALES_ABIERTAS: RegExp[] = [
  // "qué tienen de X", "qué hay de X", "qué manejan de dulces"
  /\bque\s+(tienen|tiene|hay|manejan|maneja|venden|vende|ofrecen|ofrece)\b/,
  // "tienen algo de X" / "hay algo de X": pide una categoría, no UN producto.
  /\b(tienen|tiene|hay|venden|vende|manejan|maneja)\s+algo\s+de\b/,
  /\brecomiendas?\b|\brecomendaci[oó]n\b|\brecomendar\b|\bsugerencia\b|\bsugieres\b/,
  /\bpara\s+\d+\s+personas?\b/,
  /\bno\s+(tan|muy)\s+\w+/,
  /\balgo\s+para\b/,
  /\bque\s+me\b|\bcu[aá]l\s+me\b/,
  /\bopciones\b/,
];

/** "¿tienen/hay/venden/manejan (disponible) X?" → captura X. */
const PATRON_EXISTENCIA =
  /\b(?:tienen|tiene|hay|venden|vende|manejan|maneja)\s+(?:disponible\s+)?([a-z0-9À-ÿ ]+?)\s*[?¿]*\s*$/i;

/** "¿cuánto cuesta/vale/sale (la/el/los/las) X?" → captura X. */
const PATRON_PRECIO =
  /\bcu[aá]nto\s+(?:cuesta|vale|sale)\s+(?:la\s+|el\s+|los\s+|las\s+)?([a-z0-9À-ÿ ]+?)\s*[?¿]*\s*$/i;

/**
 * Devuelve la consulta de producto extraída si el mensaje es una pregunta
 * factual concreta ("¿tienen X?", "¿cuánto cuesta X?"), o `null` si es
 * abierta, ambigua, o no menciona ningún producto — en cuyo caso el
 * llamante no debe forzar nada.
 */
export function detectarConsultaFactualDeProducto(texto: string): string | null {
  if (!texto?.trim()) return null;
  const t = normalizar(texto);
  if (SEÑALES_ABIERTAS.some((re) => re.test(t))) return null;

  for (const patron of [PATRON_EXISTENCIA, PATRON_PRECIO]) {
    const m = t.match(patron);
    const consulta = m?.[1]?.trim();
    if (consulta && consulta.length >= 2) return consulta;
  }
  return null;
}
