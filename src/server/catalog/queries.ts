import { asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * El catálogo del vertical de PEDIDOS, leído de tablas en vez del prompt.
 *
 * Es el equivalente de `server/appointments/queries.ts:catalogoParaPrompt` para
 * el otro vertical, y sigue su mismo patrón a propósito: se traen los productos,
 * los grupos y las opciones de la organización **en tres consultas planas** y se
 * ensamblan en memoria con un `Map`. Nada de un join por producto ni de N+1: el
 * pipeline lee esto en CADA turno del agente y tiene que costar poco.
 *
 * Todo va `scoped()` por organización (Constitución III).
 */

export type OpcionDeProducto = {
  id: string;
  nombre: string;
  /** 0 = incluida en el precio; >0 = adición que se cobra aparte. */
  precioExtraCents: number;
};

export type GrupoDeOpciones = {
  id: string;
  nombre: string;
  /** >=1 = el cliente TIENE que elegir. */
  minimo: number;
  maximo: number;
  opciones: OpcionDeProducto[];
};

export type ProductoDelCatalogo = {
  id: string;
  nombre: string;
  categoria: string | null;
  /** `null` = el negocio no dio precio. NO es gratis: hay que preguntarlo. */
  precioCents: number | null;
  descripcion: string | null;
  grupos: GrupoDeOpciones[];
};

/** El catálogo entero de una organización, listo para renderizar. */
export async function catalogoDePedidos(
  organizationId: string
): Promise<ProductoDelCatalogo[]> {
  const db = getDb();

  const productos = await db
    .select({
      id: schema.product.id,
      nombre: schema.product.name,
      categoria: schema.product.category,
      precioCents: schema.product.priceCents,
      descripcion: schema.product.description,
    })
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        isNull(schema.product.archivedAt),
        eq(schema.product.available, true)
      )
    )
    .orderBy(asc(schema.product.position), asc(schema.product.name));

  if (productos.length === 0) return [];

  const grupos = await db
    .select({
      id: schema.productOptionGroup.id,
      productId: schema.productOptionGroup.productId,
      nombre: schema.productOptionGroup.name,
      minimo: schema.productOptionGroup.minSelect,
      maximo: schema.productOptionGroup.maxSelect,
    })
    .from(schema.productOptionGroup)
    .where(scoped(schema.productOptionGroup.organizationId, organizationId))
    .orderBy(asc(schema.productOptionGroup.position));

  const opciones = await db
    .select({
      id: schema.productOption.id,
      groupId: schema.productOption.groupId,
      nombre: schema.productOption.name,
      precioExtraCents: schema.productOption.priceDeltaCents,
    })
    .from(schema.productOption)
    .where(
      scoped(
        schema.productOption.organizationId,
        organizationId,
        eq(schema.productOption.available, true)
      )
    )
    .orderBy(asc(schema.productOption.position));

  const opcionesPorGrupo = new Map<string, OpcionDeProducto[]>();
  for (const o of opciones) {
    const arr = opcionesPorGrupo.get(o.groupId) ?? [];
    arr.push({
      id: o.id,
      nombre: o.nombre,
      precioExtraCents: o.precioExtraCents,
    });
    opcionesPorGrupo.set(o.groupId, arr);
  }

  const gruposPorProducto = new Map<string, GrupoDeOpciones[]>();
  for (const g of grupos) {
    const arr = gruposPorProducto.get(g.productId) ?? [];
    arr.push({
      id: g.id,
      nombre: g.nombre,
      minimo: g.minimo,
      maximo: g.maximo,
      opciones: opcionesPorGrupo.get(g.id) ?? [],
    });
    gruposPorProducto.set(g.productId, arr);
  }

  return productos.map((p) => ({
    ...p,
    grupos: gruposPorProducto.get(p.id) ?? [],
  }));
}

/** Cuántos productos vivos tiene una organización. Para el gate de la bandera. */
export async function contarProductos(organizationId: string): Promise<number> {
  const db = getDb();
  const filas = await db
    .select({ id: schema.product.id })
    .from(schema.product)
    .where(
      scoped(schema.product.organizationId, organizationId, isNull(schema.product.archivedAt))
    );
  return filas.length;
}
