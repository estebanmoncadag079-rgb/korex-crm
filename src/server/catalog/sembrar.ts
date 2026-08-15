import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { leerFicha } from "@/server/ai/generador/leer-ficha";

/**
 * Pasar el catálogo de un negocio de pedidos del TEXTO de su ficha a las tablas.
 *
 * La fuente no es el prompt renderizado sino `ficha.catalogo` + `ficha.variantes`
 * (`agent_profile.ficha`), que ya están medio estructurados: una línea por
 * producto y las opciones aparte.
 *
 * ⚠️ **Esto NO escribe nada por su cuenta.** Devuelve lo que ha entendido para
 * que una persona lo revise antes. Es la lección de
 * `docs/korexia/32-CATALOGO-SALON.md`: en el catálogo del salón se colaron **12
 * precios equivocados** que nadie vio, y un precio mal en una tabla se repite en
 * cada conversación durante meses.
 */

export type ProductoLeido = {
  nombre: string;
  categoria: string | null;
  /** `null` = la línea no traía precio. NO es 0. */
  precioCents: number | null;
  descripcion: string | null;
};

export type GrupoLeido = {
  nombre: string;
  minimo: number;
  maximo: number;
  opciones: { nombre: string; precioExtraCents: number }[];
  /**
   * A qué producto aplica. `null` = a todos.
   *
   * No es un adorno: en La Churra **cada presentación lleva un número distinto
   * de salsas** (la Churrita 1, la Besties 2, el Family Box 3, el Mega Box 5).
   * Un grupo global no puede expresar eso, y decirle al cliente que elija 5
   * salsas en una Churrita es un pedido mal tomado.
   */
  producto: string | null;
};

export type CatalogoLeido = {
  productos: ProductoLeido[];
  grupos: GrupoLeido[];
  /** Líneas que no se supieron interpretar. Se enseñan para no perderlas. */
  sinInterpretar: string[];
};

/** "$10.000" / "10.000" / "10000" → 1000000 (centavos). `null` si no hay. */
function precioACents(texto: string): number | null {
  const m = texto.match(/\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/);
  if (!m) return null;
  const limpio = m[1]!.replace(/[.,]/g, "");
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * 100;
}

/**
 * Lee el catálogo escrito a mano.
 *
 * Formatos que entiende (los que usan los clientes de hoy):
 *   `🥨 Churrita — $10.000 (6 churros · 1 salsa)`
 *   `Cremoso 7 oz — $12.000`
 *   `*CREMOSOS*` / `CREMOSOS:`  → categoría
 * Y para las opciones (de `variantes`):
 *   `SALSAS: 🍯 AREQUIPE · 🍫 CHOCOLATE`
 *   `ADICIONES (opcionales…): 🍫 Salsa $2.000 · 💧 Agua $2.000`
 */
export function leerCatalogoDeTexto(
  catalogo: string,
  variantes?: string
): CatalogoLeido {
  const productos: ProductoLeido[] = [];
  const sinInterpretar: string[] = [];
  let categoriaActual: string | null = null;

  for (const cruda of (catalogo ?? "").split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;

    // Cabecera de categoría: *CREMOSOS*, **CREMOSOS**, CREMOSOS:
    const cat = linea.match(/^\*{1,2}\s*([^*]+?)\s*\*{1,2}$/) ?? linea.match(/^([A-ZÁÉÍÓÚÑ\s]{3,}):$/);
    if (cat && !/\d/.test(linea)) {
      categoriaActual = cat[1]!.trim();
      continue;
    }

    // Las adiciones sueltas dentro del catálogo van al bloque de opciones.
    if (/^adiciones?\s*:/i.test(linea)) {
      sinInterpretar.push(linea);
      continue;
    }

    const precioCents = precioACents(linea);
    // El nombre es lo que va antes del guion largo o del precio.
    const nombre = linea
      .split(/—|--|\s-\s|\$/)[0]!
      .replace(/^[^\p{L}\d]+/u, "") // emojis y viñetas del principio
      .trim();

    if (!nombre) {
      sinInterpretar.push(linea);
      continue;
    }

    const desc = linea.match(/\(([^)]+)\)/);
    productos.push({
      nombre,
      categoria: categoriaActual,
      precioCents,
      descripcion: desc ? desc[1]!.trim() : null,
    });
  }

  const grupos: GrupoLeido[] = [];
  for (const cruda of (variantes ?? "").split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;

    /*
     * Formato "por producto", el que usa La Churra de verdad:
     *   `CHURRITA — $10.000-1 salsa a eleccion entre chocolate,arequipe,lechera`
     * De ahí salen tres cosas: a qué producto aplica, CUÁNTAS puede elegir, y
     * la lista. El número importa: cada presentación trae distinta cantidad.
     */
    const porProducto = linea.match(
      /^(.+?)\s*[—-]\s*\$?[\d.,]*\s*[-–]\s*(\d+)\s+([\p{L}\s]+?)\s+a\s+elecci[oó]n\s+entre\s+(.+)$/iu
    );
    if (porProducto) {
      const nombreProducto = porProducto[1]!.replace(/^[^\p{L}\d]+/u, "").trim();
      const cuantas = Number(porProducto[2]);
      const tipo = porProducto[3]!.trim();
      const opciones = porProducto[4]!
        .split(/[,·|]/)
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => ({ nombre: o, precioExtraCents: 0 }));
      if (opciones.length) {
        grupos.push({
          // "1 salsa" → "SALSA"; "2 salsas" → "SALSAS". Se normaliza en plural
          // solo para el rótulo; lo que manda es `maximo`.
          nombre: tipo.toUpperCase(),
          minimo: cuantas,
          maximo: cuantas,
          opciones,
          producto: nombreProducto,
        });
      }
      continue;
    }

    const m = linea.match(/^([^:]{2,60}):\s*(.+)$/);
    if (!m) {
      sinInterpretar.push(linea);
      continue;
    }
    const encabezado = m[1]!.trim();
    const opcional = /opcional/i.test(encabezado);
    const nombre = encabezado
      .replace(/\([^)]*\)/g, "")
      .replace(/[^\p{L}\s]/gu, "")
      .trim();
    const opciones = m[2]!
      .split(/·|\||,(?![^(]*\))/)
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => ({
        nombre: o
          .replace(/\$?\s*\d[\d.,]*/g, "")
          .replace(/^[^\p{L}\d]+/u, "")
          .trim(),
        precioExtraCents: precioACents(o) ?? 0,
      }))
      .filter((o) => o.nombre);

    if (opciones.length) {
      grupos.push({
        nombre,
        minimo: opcional ? 0 : 1,
        maximo: opciones.length,
        opciones,
        producto: null, // formato "SALSAS: a · b · c" = aplica a todo
      });
    }
  }

  return { productos, grupos, sinInterpretar };
}

/**
 * Escribe en las tablas lo que una persona ya revisó.
 *
 * Reemplaza el catálogo entero de esa organización dentro de una transacción:
 * sembrar dos veces no duplica. **No toca `catalog_source`** — encender la
 * bandera es un acto aparte y deliberado, después de mirar el resultado.
 */
export async function escribirCatalogo(
  organizationId: string,
  leido: CatalogoLeido
): Promise<{ productos: number; grupos: number; opciones: number }> {
  const db = getDb();
  let nGrupos = 0;
  let nOpciones = 0;

  await db.transaction(async (tx) => {
    // Los hijos caen por ON DELETE CASCADE de la FK compuesta.
    await tx
      .delete(schema.product)
      .where(scoped(schema.product.organizationId, organizationId));

    for (const [i, p] of leido.productos.entries()) {
      const productId = newId("product");
      await tx.insert(schema.product).values({
        id: productId,
        organizationId,
        name: p.nombre,
        category: p.categoria,
        priceCents: p.precioCents,
        description: p.descripcion,
        position: i,
      });
    }

    // Un grupo con `producto` va SOLO a ese producto (la Churrita lleva 1 salsa
    // y el Mega Box 5); uno con `producto: null` va a todos (las adiciones se
    // pueden pedir con cualquier presentación).
    const productos = await tx
      .select({ id: schema.product.id, name: schema.product.name })
      .from(schema.product)
      .where(scoped(schema.product.organizationId, organizationId));

    const normalizar = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim();

    for (const prod of productos) {
      const suyos = leido.grupos.filter(
        (g) => g.producto === null || normalizar(g.producto) === normalizar(prod.name)
      );
      for (const [gi, g] of suyos.entries()) {
        const groupId = newId("productOptionGroup");
        await tx.insert(schema.productOptionGroup).values({
          id: groupId,
          organizationId,
          productId: prod.id,
          name: g.nombre,
          minSelect: g.minimo,
          maxSelect: g.maximo,
          position: gi,
        });
        nGrupos++;
        for (const [oi, o] of g.opciones.entries()) {
          await tx.insert(schema.productOption).values({
            id: newId("productOption"),
            organizationId,
            groupId,
            name: o.nombre,
            priceDeltaCents: o.precioExtraCents,
            position: oi,
          });
          nOpciones++;
        }
      }
    }
  });

  return { productos: leido.productos.length, grupos: nGrupos, opciones: nOpciones };
}

/** La ficha guardada de una organización, o `null` si su prompt es manual. */
export async function fichaDe(
  organizationId: string
): Promise<{ catalogo?: string; variantes?: string } | null> {
  const db = getDb();
  const filas = await db
    .select({ ficha: schema.agentProfile.ficha })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  // Lector tolerante: la ficha puede venir plana o por secciones, y aquí solo
  // interesan dos de sus campos. Ver `generador/leer-ficha.ts`.
  return leerFicha(filas[0]?.ficha) as { catalogo?: string; variantes?: string } | null;
}
