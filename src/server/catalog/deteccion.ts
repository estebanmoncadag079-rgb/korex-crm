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
 *
 * Incluye 2ª y 3ª persona ("tienes"/"tienen") por el mismo motivo que
 * `PATRON_EXISTENCIA` (ver más abajo): sin "tienes" aquí, "¿Qué tienes de
 * chocolate?" no calzaba como abierta y `PATRON_EXISTENCIA` capturaba "de
 * chocolate" como si fuera el nombre de un producto.
 */
const SEÑALES_ABIERTAS: RegExp[] = [
  // "qué tienen de X", "qué hay de X", "qué manejan de dulces"
  /\bque\s+(tienen|tiene|tienes|hay|manejan|maneja|manejas|venden|vende|vendes|ofrecen|ofrece|ofreces)\b/,
  // "tienen algo de X" / "hay algo de X": pide una categoría, no UN producto.
  /\b(tienen|tiene|tienes|hay|venden|vende|vendes|manejan|maneja|manejas)\s+algo\s+de\b/,
  /\brecomiendas?\b|\brecomendaci[oó]n\b|\brecomendar\b|\bsugerencia\b|\bsugieres\b/,
  /\bpara\s+\d+\s+personas?\b/,
  /\bno\s+(tan|muy)\s+\w+/,
  /\balgo\s+para\b/,
  /\bque\s+me\b|\bcu[aá]l\s+me\b/,
  /\bopciones\b/,
  /**
   * Incidente real (MALIA, 12-sep-2026): "Hola! Tienes domi a ciudad
   * pacífica?" — `PATRON_EXISTENCIA` no distingue QUÉ hay después de
   * "tienes", así que capturó "domi a ciudad pacifica" entero y lo buscó
   * en el catálogo de productos. Como no es un producto, dio `not_found`,
   * y ese hecho falso llegó al modelo en el MISMO turno que el hecho
   * verdadero del otro detector ("Ciudad Pacífica" sí existe como zona, a
   * $12.000) — dos hechos "verificados" contradictorios sobre la misma
   * frase. El modelo redactó algo que contradecía la tarifa real, el
   * guardarraíl `domicilio_contradicho` lo interceptó, el reintento
   * falló, y derivó sin haberle dicho nunca nada al cliente.
   *
   * Una pregunta de domicilio/envío la resuelve el detector de zonas
   * (`resolverZonaDeEntrega`, vía `consultar_domicilio`) — este archivo no
   * tiene que competir con él. "domi" es el término real que usó la
   * clienta; se verificó contra los catálogos reales de los 5 negocios
   * que ningún producto ni opción usa estas palabras, así que la
   * exclusión no puede tapar un producto de verdad.
   */
  /\bdomicilios?\b|\bdomi\b|\benv[ií]os?\b/,
];

/**
 * "¿tienen/tienes/hay/venden/manejan (disponible) X?" → captura X.
 *
 * Cubre 2ª persona ("tienes", "vendes", "manejas") además de 3ª — el
 * incidente real de Malía usó "tienes", que hasta ahora nunca disparaba
 * esta detección (docs/korexia, auditoría de jerarquía de verdad, 1-sep-2026).
 */
const PATRON_EXISTENCIA =
  /\b(?:tienen|tiene|tienes|hay|venden|vende|vendes|manejan|maneja|manejas)\s+(?:disponible\s+)?([a-z0-9À-ÿ ]+?)\s*[?¿]*\s*$/i;

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

/**
 * Categorías genéricas de listado — nunca nombres de producto concretos
 * (eso rompería la regla de "sin listas por cliente/producto").
 */
const CATEGORIAS_DE_LISTADO =
  "sabores|productos|tamaños|tamanos|opciones|presentaciones|variedades|referencias";

/** "qué/cuáles sabores tienen/manejan/hay/venden/ofrecen(/están disponibles)?" */
const PATRON_LISTADO_CON_SUSTANTIVO = new RegExp(
  `\\b(?:que|cu[aá]les?)\\s+(?:${CATEGORIAS_DE_LISTADO})\\s+` +
    `(?:tienen|tiene|tienes|hay|manejan|maneja|manejas|venden|vende|vendes|ofrecen|ofrece|ofreces|est[aá]n?)\\b`
);

/** "sabores/tamaños/opciones ... disponibles" (sustantivo antes del verbo estar). */
const PATRON_LISTADO_DISPONIBLES = new RegExp(
  `\\b(?:${CATEGORIAS_DE_LISTADO})\\s+(?:hay\\s+)?disponibles?\\b`
);

/**
 * "qué tienen/manejan/venden(/tienes disponible)?" SIN objeto después — pide
 * el catálogo completo, no una categoría con calificativo. Ancla al final de
 * la frase a propósito: "qué tienen de bueno hoy" NO debe calzar aquí (sigue
 * siendo una pregunta abierta sin verificación forzada, como siempre).
 */
const PATRON_LISTADO_GENERICO =
  /\bque\s+(?:tienen|tiene|tienes|hay|manejan|maneja|manejas|venden|vende|vendes|ofrecen|ofrece|ofreces)\s*(?:disponible)?\s*[?¿]*\s*$/;

/**
 * Detecta una pregunta de LISTADO abierto de catálogo ("¿qué sabores
 * tienen?", "¿qué productos manejan?", "¿qué tienen disponible?") — a
 * diferencia de `detectarConsultaFactualDeProducto`, que busca UN producto
 * puntual, esto pide el catálogo completo vigente. Nace de la auditoría de
 * jerarquía de verdad (1-sep-2026): el incidente real de Malía fue
 * exactamente una de estas preguntas ("¿cuáles son los sabores que
 * tienes?"), que `SEÑALES_ABIERTAS` excluye a propósito de la detección de
 * producto puntual — aquí se cubre con su propio mecanismo, sin tocar aquel.
 *
 * Deliberadamente conservador, mismo criterio que el resto del archivo: solo
 * dispara con una categoría genérica reconocida o sin ningún calificativo
 * después del verbo. "¿Qué tienen de chocolate?" (categoría con
 * calificativo) sigue sin forzar nada — el modelo sigue con el catálogo en
 * prosa, como hoy.
 */
export function detectarConsultaDeListadoDeProducto(texto: string): boolean {
  if (!texto?.trim()) return false;
  const t = normalizar(texto);
  return (
    PATRON_LISTADO_CON_SUSTANTIVO.test(t) ||
    PATRON_LISTADO_DISPONIBLES.test(t) ||
    PATRON_LISTADO_GENERICO.test(t)
  );
}
