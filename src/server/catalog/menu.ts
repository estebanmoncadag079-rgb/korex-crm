import type { ProductoDelCatalogo } from "./queries";
import type { OpcionDeMenu } from "@/server/ai/generador/ficha";

/**
 * Arma el menú guiado de WhatsApp (25-ago-2026): lo que el cliente TOCA en
 * vez de escribir texto libre que el modelo tiene que interpretar.
 *
 * Dos usos, misma forma de salida:
 *   - `armarMenuDeIntenciones`: el menú de apertura ("Ver menú", "Pedir"…),
 *     declarado por el negocio en `ficha.menu`.
 *   - `armarMenuDeCatalogo`: categorías → productos, DERIVADO de `product`
 *     en el momento de enviarlo — nunca se declara aparte, para no repetir
 *     el catálogo en dos lugares (el mismo error que ya corrigió
 *     `catalog_source`).
 *
 * Los límites son los que impone WhatsApp, no una elección de este proyecto:
 * hasta 3 botones o hasta 10 filas repartidas en hasta 10 secciones, título
 * de fila hasta 24 caracteres, descripción hasta 72. Cuando algo no cabe,
 * estas funciones devuelven `null` — quien las llama debe caer al mensaje de
 * texto de siempre, nunca fallar en silencio ni truncar un nombre a algo
 * ambiguo.
 */

const LIMITE_BOTONES = 3;
const LIMITE_TITULO_BOTON = 20;
const LIMITE_FILAS_LISTA = 10;
const LIMITE_SECCIONES_LISTA = 10;
const LIMITE_TITULO_FILA = 24;
const LIMITE_DESCRIPCION_FILA = 72;

export type MenuInteractivo =
  | { tipo: "button"; body: string; botones: { id: string; titulo: string }[] }
  | {
      tipo: "list";
      body: string;
      boton: string;
      secciones: {
        titulo: string;
        filas: { id: string; titulo: string; descripcion?: string }[];
      }[];
    };

function pesos(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 })}`;
}

/** El menú de apertura: 3 opciones caben en botones, 4-10 necesitan lista. */
export function armarMenuDeIntenciones(
  opciones: OpcionDeMenu[],
  body = "¿Cómo te ayudo hoy?"
): MenuInteractivo | null {
  if (opciones.length === 0 || opciones.length > LIMITE_FILAS_LISTA) return null;
  if (
    opciones.length <= LIMITE_BOTONES &&
    opciones.every((o) => o.etiqueta.length <= LIMITE_TITULO_BOTON)
  ) {
    return {
      tipo: "button",
      body,
      botones: opciones.map((o) => ({ id: o.id, titulo: o.etiqueta })),
    };
  }
  if (opciones.some((o) => o.etiqueta.length > LIMITE_TITULO_FILA)) return null;
  return {
    tipo: "list",
    body,
    boton: "Ver opciones",
    secciones: [
      { titulo: "Opciones", filas: opciones.map((o) => ({ id: o.id, titulo: o.etiqueta })) },
    ],
  };
}

/**
 * El catálogo agrupado por categoría, en una sola lista con secciones —
 * nivel 1: solo funciona si TODO el catálogo cabe en 10 filas.
 *
 * Cuando no cabe (caso real: Lis, 15 productos, 25-ago-2026), quien llama
 * debe usar `armarMenuDelCatalogo`, que cae a categorías (nivel 2) en vez de
 * degradar directo a texto.
 */
export function armarMenuDeCatalogo(
  productos: ProductoDelCatalogo[],
  body = "Nuestro menú 🍰"
): MenuInteractivo | null {
  if (productos.length === 0 || productos.length > LIMITE_FILAS_LISTA) return null;
  if (productos.some((p) => p.nombre.length > LIMITE_TITULO_FILA)) return null;

  const porCategoria = new Map<string, ProductoDelCatalogo[]>();
  for (const p of productos) {
    const categoria = p.categoria?.trim() || "General";
    const arr = porCategoria.get(categoria) ?? [];
    arr.push(p);
    porCategoria.set(categoria, arr);
  }
  if (porCategoria.size > LIMITE_SECCIONES_LISTA) return null;

  const secciones = [...porCategoria.entries()].map(([categoria, items]) => ({
    titulo: categoria.slice(0, LIMITE_TITULO_FILA),
    filas: items.map((p) => {
      const descripcion =
        p.precioCents === null ? "Precio a confirmar" : pesos(p.precioCents);
      return {
        id: p.id,
        titulo: p.nombre,
        descripcion: descripcion.slice(0, LIMITE_DESCRIPCION_FILA),
      };
    }),
  }));

  return { tipo: "list", body, boton: "Ver el menú", secciones };
}

/** La fila con la que se vuelve de una categoría a la lista de categorías. */
export const ID_VOLVER_A_CATEGORIAS = "__volver__";
const ETIQUETA_VOLVER = "⬅ Volver a categorías";

/**
 * Nivel 2, primer paso: solo los NOMBRES de categoría, cuando el catálogo
 * entero no cabe en una lista. El cliente toca una y el servidor le muestra
 * sus productos (`armarMenuDeCategoria`).
 */
export function armarMenuDeCategorias(
  productos: ProductoDelCatalogo[],
  body = "¿Qué te gustaría ver?"
): MenuInteractivo | null {
  const categorias = [...new Set(productos.map((p) => p.categoria?.trim() || "General"))];
  if (categorias.length === 0 || categorias.length > LIMITE_FILAS_LISTA) return null;
  if (categorias.some((c) => c.length > LIMITE_TITULO_FILA)) return null;
  return {
    tipo: "list",
    body,
    boton: "Ver categorías",
    secciones: [{ titulo: "Categorías", filas: categorias.map((c) => ({ id: c, titulo: c })) }],
  };
}

/**
 * Nivel 2, segundo paso: los productos de UNA categoría, con una fila para
 * volver a la lista de categorías — ninguna sub-lista es un callejón sin
 * salida.
 */
export function armarMenuDeCategoria(
  productos: ProductoDelCatalogo[],
  categoria: string,
  body?: string
): MenuInteractivo | null {
  const deLaCategoria = productos.filter((p) => (p.categoria?.trim() || "General") === categoria);
  if (deLaCategoria.length === 0 || deLaCategoria.length + 1 > LIMITE_FILAS_LISTA) return null;
  if (deLaCategoria.some((p) => p.nombre.length > LIMITE_TITULO_FILA)) return null;

  const filas: { id: string; titulo: string; descripcion?: string }[] = deLaCategoria.map((p) => ({
    id: p.id,
    titulo: p.nombre,
    descripcion: (p.precioCents === null ? "Precio a confirmar" : pesos(p.precioCents)).slice(
      0,
      LIMITE_DESCRIPCION_FILA
    ),
  }));
  filas.push({ id: ID_VOLVER_A_CATEGORIAS, titulo: ETIQUETA_VOLVER });

  return {
    tipo: "list",
    body: body ?? `Esto tenemos en ${categoria}:`,
    boton: "Ver productos",
    secciones: [{ titulo: categoria, filas }],
  };
}

/**
 * El punto de entrada que usa el pipeline: intenta el catálogo entero en una
 * lista (nivel 1); si no cabe, cae a categorías (nivel 2). `categoria` no
 * nula pide directamente los productos de esa categoría.
 */
export function armarMenuDelCatalogo(
  productos: ProductoDelCatalogo[],
  categoria: string | null,
  body?: string
): MenuInteractivo | null {
  if (categoria) return armarMenuDeCategoria(productos, categoria, body);
  return armarMenuDeCatalogo(productos, body) ?? armarMenuDeCategorias(productos, body);
}

/** El menú como texto plano — para la bandeja del CRM, el Laboratorio, o si falla el envío. */
export function textoPlanoDeMenu(menu: MenuInteractivo): string {
  const filas =
    menu.tipo === "button"
      ? menu.botones.map((b) => b.titulo)
      : menu.secciones.flatMap((s) => s.filas.map((f) => f.titulo));
  return `${menu.body}\n${filas.map((t) => `• ${t}`).join("\n")}`;
}
