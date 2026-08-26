import type { ProductoDelCatalogo } from "./queries";

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

/** Dos palabras "coinciden" si son iguales o comparten un prefijo largo (tolera plural/género). */
function coincide(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= 5 || (i === min && min >= 4);
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
