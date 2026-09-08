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

  const exacto = catalogo.filter((p) => normalizar(p.nombre) === q);
  if (exacto.length === 1) return { status: "found", producto: exacto[0]! };
  if (exacto.length > 1) return { status: "multiple_matches", productos: exacto };

  // Un único candidato por substring es una resolución segura; con más de
  // uno se cae al paso de tokens (igual que buscarServicio, doc 104): tomar
  // el primero por orden alfabético no tiene relación con lo que pide el
  // cliente.
  const porSubstring = catalogo.filter(
    (p) => normalizar(p.nombre).includes(q) || q.includes(normalizar(p.nombre))
  );
  if (porSubstring.length === 1) return { status: "found", producto: porSubstring[0]! };

  const universo = porSubstring.length > 1 ? porSubstring : catalogo;
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
  if (candidatos.length === 1) return { status: "found", producto: candidatos[0]! };
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
