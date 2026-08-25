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
 * El catálogo agrupado por categoría, en una sola lista con secciones.
 *
 * Fase 1 (25-ago-2026): si el catálogo entero no cabe en 10 filas o 10
 * secciones, degrada a `null` — la sub-lista por categoría (nivel 2) queda
 * pospuesta hasta que un negocio real la necesite.
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

/** El menú como texto plano — para la bandeja del CRM, el Laboratorio, o si falla el envío. */
export function textoPlanoDeMenu(menu: MenuInteractivo): string {
  const filas =
    menu.tipo === "button"
      ? menu.botones.map((b) => b.titulo)
      : menu.secciones.flatMap((s) => s.filas.map((f) => f.titulo));
  return `${menu.body}\n${filas.map((t) => `• ${t}`).join("\n")}`;
}
