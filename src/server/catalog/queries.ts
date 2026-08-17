import { asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Vertical } from "@/server/vertical";

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
  /**
   * ¿La misma opción, dos veces? **Por defecto no.**
   *
   * Lo declara el negocio en su catálogo. Fue una regla del núcleo hasta el
   * 17-ago-2026 —prohibida primero, universal después—, y las dos veces la
   * decidió lo que necesitaba un solo cliente.
   */
  permiteRepeticion: boolean;
  opciones: OpcionDeProducto[];
};

/**
 * **Lo que un negocio vende**, sea del vertical que sea.
 *
 * Un producto y un servicio se parecen en todo lo que le importa al núcleo
 * —tienen nombre, precio y grupos de opciones— y se diferencian en lo que le
 * importa a su vertical: un servicio dura, un producto no.
 *
 * Las tablas siguen siendo dos, **a propósito**: fundirlas obligaría a que un
 * churro tuviera `duration_min`, y arrastraría el acoplamiento con el solape y
 * con `staff_service` ([63](../../../docs/korexia/63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md)).
 * **La unificación es del TIPO DE DOMINIO, no del esquema.**
 */
export type Ofrecible = {
  id: string;
  nombre: string;
  categoria: string | null;
  /** `null` = el negocio no dio precio. NO es gratis: hay que preguntarlo. */
  precioCents: number | null;
  descripcion: string | null;
  /** Solo donde el vertical la usa. Un churro no dura. */
  duracionMin?: number;
  grupos: GrupoDeOpciones[];
};

/** @deprecated El nombre viejo, mientras queden llamadores. Usa `Ofrecible`. */
export type ProductoDelCatalogo = Ofrecible;

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
      permiteRepeticion: schema.productOptionGroup.permiteRepeticion,
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
      permiteRepeticion: g.permiteRepeticion,
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

/**
 * El catálogo de una organización, **sea del vertical que sea**.
 *
 * Es la puerta única que debería usar el núcleo: qué tabla se lee lo decide el
 * vertical —que desde el 17-ago tiene fuente única— y no quien llama.
 *
 * ⚠️ **Los servicios llegan hoy SIN grupos de opciones**, porque `service`
 * todavía no los tiene: eso es el paso 3B. No es un olvido ni un `TODO`
 * escondido — es el estado real del esquema, y por eso se devuelve una lista
 * vacía en vez de fingir que hay algo.
 *
 * Tampoco toca la reserva: ni agendas, ni profesionales, ni solapes. Un
 * `Ofrecible` describe **qué se vende**; quién lo atiende y cuándo es otra capa
 * (paso 4).
 */
export async function catalogoDe(
  organizationId: string,
  vertical: Vertical
): Promise<Ofrecible[]> {
  if (vertical === "pedidos") return catalogoDePedidos(organizationId);

  const db = getDb();
  const servicios = await db
    .select({
      id: schema.service.id,
      nombre: schema.service.name,
      categoria: schema.service.category,
      precioCents: schema.service.priceCents,
      duracionMin: schema.service.durationMin,
    })
    .from(schema.service)
    .where(scoped(schema.service.organizationId, organizationId))
    .orderBy(asc(schema.service.name));

  return servicios.map((s) => ({
    ...s,
    descripcion: null,
    grupos: [],
  }));
}
