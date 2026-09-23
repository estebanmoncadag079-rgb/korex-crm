import type { OpcionDeProducto, ProductoDelCatalogo } from "./queries";

/**
 * Búsqueda difusa de un producto por nombre — el mismo algoritmo que ya
 * resolvió esto para servicios de citas (`buscarServicio`,
 * `server/appointments/logic.ts`, doc 104), implementado aparte a propósito:
 * cada vertical tiene su propio matcher, mismo criterio que ya separa
 * pedidos de citas en todo el proyecto.
 *
 * Nace del incidente real (25-ago-2026, Lis): una clienta escribió "torta de
 * chocolate", el catálogo real solo tiene "Porción Chocolate", y el modelo
 * — leyendo el catálogo como prosa, sin ninguna búsqueda estructurada detrás
 * — no conectó los dos y escaló. Este archivo es lo que hace ese match
 * verificable en vez de depender de que el modelo "lea bien".
 */

export type ResultadoBusquedaProducto =
  | { status: "found"; producto: ProductoDelCatalogo }
  | { status: "multiple_matches"; productos: ProductoDelCatalogo[] }
  | { status: "not_found" };

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .toLowerCase()
    .trim();
}

/** Conectores que no distinguen un producto de otro. */
const STOP_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "con", "y", "o", "en", "para", "al", "por",
  "un", "una", "unos", "unas", "tus", "mi", "mis", "tienen", "tienes", "hay",
  "producto", "productos", "quiero", "quisiera", "algo", "alguna",
]);

function tokens(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Fase 10S — bug real: la tolerancia original ("comparten los primeros 5
 * caracteres") fusionaba palabras distintas — `coincide("chocolate",
 * "choconuez")` y `coincide("limon", "limonada")` daban `true` porque solo
 * miraba un prefijo compartido de longitud fija, sin exigir que una fuera
 * REALMENTE el inicio completo de la otra. Ahora exige contención total
 * (la corta es un prefijo genuino de la larga) y limita cuánto puede
 * extenderse la larga (≤2 caracteres: cubre plural "-s"/"-es" y variación de
 * género, no una palabra nueva como "-ada" o "-nuez").
 */
function coincide(a: string, b: string): boolean {
  if (a === b) return true;
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  if (corta.length < 4) return false;
  if (!larga.startsWith(corta)) return false;
  return larga.length - corta.length <= 2;
}

/**
 * Fase 8E — incidente real (8-sep-2026, MALIA): una clienta pidió "el pavé
 * de oblea". El catálogo solo tiene "Pavé Cremoso 8 oz" y "Pavé Cremoso 16
 * oz"; "oblea" no existe ni como producto ni como opción. Esta función
 * devolvía `found: Pavé Cremoso 8 oz` — el ÚNICO token que coincidía era
 * "pave", que comparten los dos productos y no distingue nada; la palabra
 * que de verdad pedía la clienta ("oblea") no coincidía con nada; y el
 * desempate entre los dos hermanos lo decidió `ratio`, que ahí solo mide
 * cuál de los dos NOMBRES es más corto.
 *
 * Ese `found` no se queda en una sugerencia: se le inyecta al modelo como
 * hecho verificado ("este dato es real, no lo pongas en duda") y
 * `contradiceProductoEncontrado` lo OBLIGA a sostenerlo. El bot ofreció un
 * producto inexistente, el carrito real lo rechazó en silencio cinco veces
 * ("Oblea" no está entre las opciones), el cierre falló por inconsistencia
 * financiera y el pedido acabó derivado a una persona y perdido.
 *
 * Un match solo identifica de verdad si algo de lo que coincidió DISTINGUE
 * al candidato de sus hermanos. Si todo lo que coincidió es de familia
 * (tokens que comparten dos o más productos del catálogo) y además queda
 * una palabra significativa del cliente sin explicar, esto no es "lo
 * encontré": es "se parece al apellido". Se devuelve `not_found`, que en el
 * pipeline cae a `buscarOpciones` (por si era una opción real, como el
 * "chocolate blanco" de La Churra) antes de responderle nada al cliente.
 */
function soloCoincideElApellido(
  catalogo: ProductoDelCatalogo[],
  ganador: ProductoDelCatalogo,
  qt: string[]
): boolean {
  const pt = tokens(ganador.nombre);
  const coincidieron = pt.filter((t) => qt.some((u) => coincide(t, u)));
  if (!coincidieron.length) return false;
  // Sin palabras del cliente sin explicar, el match cubre lo que pidió: no
  // hay nada que sospechar (ej. "el de 8 oz" → "Pavé Cremoso 8 oz").
  const sinExplicar = qt.filter((u) => !pt.some((t) => coincide(t, u)));
  if (!sinExplicar.length) return false;
  // ¿Alguno de los tokens que coincidió distingue a ESTE producto de los
  // demás? Basta uno para que el match sea una identificación real.
  return coincidieron.every(
    (t) => catalogo.filter((p) => tokens(p.nombre).some((o) => coincide(o, t))).length >= 2
  );
}

/**
 * Una especificación de tamaño dentro de un nombre o de una consulta: el
 * número y la unidad que lo acompaña (16 + oz).
 */
type Tamano = { numero: string; unidad: string };

/**
 * Los pares número+unidad de un texto.
 *
 * La unidad es la palabra que va PEGADA al número, y ahí está toda la
 * gracia: es lo que distingue un tamaño de una cantidad sin tener que
 * escribir en el núcleo ninguna lista de unidades. En `2 paves de 16 oz`,
 * el `2` trae `paves` detrás y el `16` trae `oz`; cuál de las dos es la unidad
 * del catálogo lo decide el catálogo, no este archivo.
 */
function tamanos(texto: string): Tamano[] {
  const encontrados: Tamano[] = [];
  // Una sola vez, fuera del bucle: `re.exec` avanza con su `lastIndex` sobre
  // la misma cadena, así que rehacerla en cada vuelta era una copia por
  // coincidencia encontrada — y dejaba el recorrido dependiendo de que
  // `normalizar` devolviera siempre lo mismo.
  const normalizado = normalizar(texto);
  const re = /([0-9]+) *([a-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizado)) !== null) {
    encontrados.push({ numero: m[1]!, unidad: m[2]! });
  }
  return encontrados;
}

/**
 * ¿El tamaño de este producto CONTRADICE el que pidió el cliente?
 *
 * 22-sep-2026 — el fallo que motiva todo esto: `Pavé Cremoso 7 oz` devolvía
 * `found: Pavé Cremoso 8 oz`, y ese `found` viaja al prompt como hecho
 * verificado. El sistema afirmaba que existe un tamaño que no existe.
 *
 * Eran DOS mecanismos. `tokens()` descarta lo que mide menos de dos
 * caracteres, así que un tamaño de UN dígito desaparecía antes de comparar
 * (`Pavé Cremoso 8 oz` → `[pave, cremoso, oz]`). Y además, también con dos
 * dígitos, un número que contradice nunca descalificaba: solo bajaba el
 * `ratio` (`Cremoso Familiar 43 oz` resolvía al de 44). Por eso la
 * corrección no es aflojar la tokenización —eso tapaba 8 de 17 casos— sino
 * esto: **la contradicción descalifica**.
 *
 * Lo que NO descalifica, y es igual de importante:
 * - un producto sin tamaño en esa unidad (`Porción Chocolate` sigue
 *   resolviendo para `torta de chocolate`);
 * - un número que no lleva detrás una unidad del catálogo, porque eso es una
 *   CANTIDAD. Sin esta mitad se rompe `orders/policy.ts`, que no le pasa un
 *   nombre de producto sino el mensaje entero del cliente: `me agregas 2`
 *   `pavés mas de 16 oz` dejaría de contar como pedido nuevo.
 */
function contradiceElTamano(producto: ProductoDelCatalogo, pedidos: Tamano[]): boolean {
  const suyos = tamanos(producto.nombre).filter((t) =>
    pedidos.some((p) => p.unidad === t.unidad)
  );
  // Sin tamaño propio en esa unidad no hay nada que contradecir.
  if (!suyos.length) return false;
  return !suyos.some((s) =>
    pedidos.some((p) => p.unidad === s.unidad && p.numero === s.numero)
  );
}

/**
 * Busca en el catálogo real, tolerando tildes, mayúsculas y nombres
 * parafraseados por el cliente. A diferencia de `buscarServicio` (que
 * devuelve "el mejor o null"), aquí hace falta distinguir *cuántos*
 * candidatos empatan, para que quien llame sepa si debe preguntar cuál en
 * vez de asumir uno.
 */
export function buscarProductos(
  catalogo: ProductoDelCatalogo[],
  consulta: string
): ResultadoBusquedaProducto {
  const q = normalizar(consulta);
  if (!q || catalogo.length === 0) return { status: "not_found" };

  /*
   * Quién puede competir: todo el catálogo salvo quien lleve un tamaño que
   * contradice al que pidió el cliente (ver `contradiceElTamano`).
   *
   * Se filtra ANTES de las tres etapas —exacto, substring, tokens— porque
   * las tres pueden producir el falso positivo: el nombre exacto nunca, pero
   * el substring y el solapamiento de tokens sí, y son los que devolvían
   * `Pavé Cremoso 8 oz` para `Pavé Cremoso 7 oz`.
   *
   * Quién decide qué es una unidad: **el nombre del producto**, no una lista
   * escrita aquí. Un candidato solo se mira contra los números que ÉL mismo
   * declara, así que `2 pavés` en la consulta no puede contradecir a un
   * producto que mide en `oz`, y un catálogo sin números —La Churra— no
   * puede ser filtrado por ninguna consulta. Un negocio futuro que venda en
   * `ml`, `g` o `und` queda cubierto sin tocar el núcleo.
   *
   * Sin números en la consulta, `pedidos` queda vacío y `elegibles` es el
   * catálogo entero: el algoritmo de siempre, intacto.
   */
  const pedidos = tamanos(consulta);
  const elegibles = pedidos.length
    ? catalogo.filter((p) => !contradiceElTamano(p, pedidos))
    : catalogo;
  /*
   * Ningún candidato con ese tamaño. `not_found` NO significa "dile al
   * cliente que no existe": el pipeline lo pasa por `buscarOpciones` y
   * decide después, exactamente como hace hoy con cualquier otro
   * `not_found`.
   */
  if (elegibles.length === 0) return { status: "not_found" };

  const exacto = elegibles.filter((p) => normalizar(p.nombre) === q);
  if (exacto.length === 1) return { status: "found", producto: exacto[0]! };
  if (exacto.length > 1) return { status: "multiple_matches", productos: exacto };

  // Un único candidato por substring es una resolución segura; con más de
  // uno se cae al paso de tokens (igual que buscarServicio, doc 104): tomar
  // el primero por orden alfabético no tiene relación con lo que pide el
  // cliente.
  const porSubstring = elegibles.filter(
    (p) => normalizar(p.nombre).includes(q) || q.includes(normalizar(p.nombre))
  );
  if (porSubstring.length === 1) return { status: "found", producto: porSubstring[0]! };

  const universo = porSubstring.length > 1 ? porSubstring : elegibles;
  const qt = tokens(consulta);
  if (!qt.length) return { status: "not_found" };

  let mejorPuntaje = { overlap: 0, ratio: 0 };
  let candidatos: ProductoDelCatalogo[] = [];
  for (const p of universo) {
    const pt = tokens(p.nombre);
    if (!pt.length) continue;
    const overlap = pt.filter((t) => qt.some((u) => coincide(t, u))).length;
    if (!overlap) continue;
    const ratio = overlap / pt.length;
    if (
      overlap > mejorPuntaje.overlap ||
      (overlap === mejorPuntaje.overlap && ratio > mejorPuntaje.ratio)
    ) {
      mejorPuntaje = { overlap, ratio };
      candidatos = [p];
    } else if (overlap === mejorPuntaje.overlap && ratio === mejorPuntaje.ratio) {
      candidatos.push(p);
    }
  }

  if (candidatos.length === 0) return { status: "not_found" };
  if (candidatos.length === 1) {
    /*
     * Ojo: aquí va el catálogo COMPLETO, no `elegibles`. Lo que decide esta
     * función es si un token DISTINGUE al ganador de sus hermanos, y eso se
     * mide contra el catálogo entero: filtrarlo antes haría parecer
     * distintivo a un token que solo es de familia.
     */
    // Fase 8E — ver `soloCoincideElApellido`: un match de puro nombre de
    // familia, con una palabra del cliente sin explicar, no es un hallazgo.
    if (soloCoincideElApellido(catalogo, candidatos[0]!, qt)) return { status: "not_found" };
    return { status: "found", producto: candidatos[0]! };
  }
  return { status: "multiple_matches", productos: candidatos };
}

/**
 * Fase urgente (4-sep-2026) — incidente real de La Churra: "¿tienen
 * chocolate blanco?" es una pregunta factual como cualquier otra, pero
 * "chocolate blanco" es una SALSA (una opción dentro de cada producto,
 * `producto.grupos[].opciones[]`), no un producto en sí. `buscarProductos`
 * solo compara contra NOMBRES DE PRODUCTO — nunca contra las opciones — así
 * que devolvía `not_found`, y ese "no encontrado entre los productos" se
 * convertía en "[SISTEMA] no lo tienen", una afirmación falsa sobre algo
 * que sí estaba en el catálogo real, un nivel más abajo.
 *
 * "No encontrado en una fuente" nunca puede leerse como "no existe" sin
 * haber consultado también esta fuente — `buscarOpciones` es exactamente
 * eso: el mismo algoritmo (exacto → substring único → tokens con
 * tolerancia), aplicado a las opciones en vez de a los productos.
 *
 * Se agrupa por NOMBRE de opción, no por fila: la misma salsa suele existir
 * como una fila de `product_option` distinta por cada producto que la
 * ofrece (la Churrita y el Mega Box tienen cada uno su propio "chocolate
 * blanco"), y preguntar "¿tienen X?" es una pregunta sobre la salsa en
 * general — el resultado junta esas filas y dice para QUÉ productos aplica
 * cada una, nunca asume que una opción sirve para todo el catálogo si la
 * relación real dice lo contrario.
 *
 * Solo ve opciones ya filtradas a `available=true` por `catalogoDePedidos`
 * (mismo criterio que ya aplica a productos: una opción desactivada no
 * aparece aquí, y por tanto se resuelve como "no encontrada" — igual que un
 * producto desactivado hoy).
 */
export type OpcionEncontrada = {
  opcion: OpcionDeProducto;
  /** Los productos del catálogo que de verdad ofrecen esta opción con este nombre. */
  productos: { id: string; nombre: string }[];
};

export type ResultadoBusquedaOpcion =
  | { status: "found"; encontrada: OpcionEncontrada }
  | { status: "multiple_matches"; encontradas: OpcionEncontrada[] }
  | { status: "not_found" };

type FilaOpcion = { opcion: OpcionDeProducto; producto: { id: string; nombre: string } };

function agruparOpcionesPorNombre(filas: FilaOpcion[]): OpcionEncontrada[] {
  const porNombre = new Map<string, OpcionEncontrada>();
  for (const f of filas) {
    const clave = normalizar(f.opcion.nombre);
    const existente = porNombre.get(clave);
    if (existente) {
      if (!existente.productos.some((pr) => pr.id === f.producto.id)) {
        existente.productos.push(f.producto);
      }
    } else {
      porNombre.set(clave, { opcion: f.opcion, productos: [f.producto] });
    }
  }
  return [...porNombre.values()];
}

export function buscarOpciones(
  catalogo: ProductoDelCatalogo[],
  consulta: string
): ResultadoBusquedaOpcion {
  const q = normalizar(consulta);
  if (!q) return { status: "not_found" };

  const filas: FilaOpcion[] = [];
  for (const p of catalogo) {
    for (const g of p.grupos) {
      for (const o of g.opciones) {
        filas.push({ opcion: o, producto: { id: p.id, nombre: p.nombre } });
      }
    }
  }
  if (filas.length === 0) return { status: "not_found" };

  const exacto = filas.filter((f) => normalizar(f.opcion.nombre) === q);
  if (exacto.length > 0) {
    const agrupadas = agruparOpcionesPorNombre(exacto);
    if (agrupadas.length === 1) return { status: "found", encontrada: agrupadas[0]! };
    return { status: "multiple_matches", encontradas: agrupadas };
  }

  const porSubstring = filas.filter(
    (f) => normalizar(f.opcion.nombre).includes(q) || q.includes(normalizar(f.opcion.nombre))
  );
  if (porSubstring.length > 0) {
    const agrupadas = agruparOpcionesPorNombre(porSubstring);
    if (agrupadas.length === 1) return { status: "found", encontrada: agrupadas[0]! };
    if (agrupadas.length > 1) {
      // Varios NOMBRES de opción distintos calzan por substring (caso raro):
      // se sigue a tokens, igual que buscarProductos, solo sobre este
      // universo ya reducido.
    }
  }

  const universo = porSubstring.length > 0 ? porSubstring : filas;
  const qt = tokens(consulta);
  if (!qt.length) return { status: "not_found" };

  let mejorPuntaje = { overlap: 0, ratio: 0 };
  let candidatas: FilaOpcion[] = [];
  for (const f of universo) {
    const ot = tokens(f.opcion.nombre);
    if (!ot.length) continue;
    const overlap = ot.filter((t) => qt.some((u) => coincide(t, u))).length;
    if (!overlap) continue;
    const ratio = overlap / ot.length;
    if (
      overlap > mejorPuntaje.overlap ||
      (overlap === mejorPuntaje.overlap && ratio > mejorPuntaje.ratio)
    ) {
      mejorPuntaje = { overlap, ratio };
      candidatas = [f];
    } else if (overlap === mejorPuntaje.overlap && ratio === mejorPuntaje.ratio) {
      candidatas.push(f);
    }
  }

  if (candidatas.length === 0) return { status: "not_found" };
  const agrupadas = agruparOpcionesPorNombre(candidatas);
  if (agrupadas.length === 1) return { status: "found", encontrada: agrupadas[0]! };
  return { status: "multiple_matches", encontradas: agrupadas };
}
