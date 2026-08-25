/**
 * Los productos del catálogo, vistos y editados desde el CRM.
 *
 * Antes de esto, dar de alta un producto era escribirlo en el texto libre del
 * cuestionario (`ficha.catalogo`) y correr `migrar:catalogo` para volcarlo a
 * tablas — un paso intermedio que, una vez migrado un negocio, dejaba de
 * tener efecto en lo que el agente dice pero seguía visible como si lo
 * tuviera. Esto reemplaza ese texto: un negocio nuevo entra su catálogo
 * directo aquí, sin paso de por medio.
 *
 * Todo va `scoped()` por organización (Constitución III): ningún producto de
 * otro cliente se lee ni se escribe desde aquí, ni siquiera pasando su id.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

export type ProductoConfigurable = {
  id: string;
  nombre: string;
  categoria: string | null;
  /** En centavos; `null` = el negocio no lo declaró, el agente debe preguntarlo. */
  precioCents: number | null;
  disponible: boolean;
};

/** Los productos activos (no archivados) de una organización, en su orden. */
export async function listarProductos(
  organizationId: string
): Promise<ProductoConfigurable[]> {
  const db = getDb();
  const filas = await db
    .select({
      id: schema.product.id,
      nombre: schema.product.name,
      categoria: schema.product.category,
      precioCents: schema.product.priceCents,
      disponible: schema.product.available,
    })
    .from(schema.product)
    .where(scoped(schema.product.organizationId, organizationId, isNull(schema.product.archivedAt)))
    .orderBy(asc(schema.product.position), asc(schema.product.name));
  return filas;
}

/**
 * Da de alta un producto. El precio es opcional a propósito (ver
 * `product.priceCents` en el esquema): un negocio que no lo sepa aún puede
 * guardarlo sin precio y completarlo después, en vez de quedar bloqueado.
 */
export async function crearProducto(
  organizationId: string,
  datos: { nombre: string; categoria?: string | null; precioCents?: number | null },
  actor: Actor
): Promise<ProductoConfigurable> {
  const db = getDb();
  const id = newId("product");
  await db.insert(schema.product).values({
    id,
    organizationId,
    name: datos.nombre,
    category: datos.categoria ?? null,
    priceCents: datos.precioCents ?? null,
  });
  console.log(
    `[cambio] tabla=product registro=${id} campo=<fila nueva> valor_anterior=ausente ` +
      `valor_nuevo=<creada> proceso=crm:catalogo actor=${actor} timestamp=${new Date().toISOString()}`
  );
  return {
    id,
    nombre: datos.nombre,
    categoria: datos.categoria ?? null,
    precioCents: datos.precioCents ?? null,
    disponible: true,
  };
}

/**
 * Cambia nombre, categoría, precio o disponibilidad. Solo lo que venga en
 * `datos` — un campo ausente no se toca.
 *
 * `null` = el producto no existe en esta organización (o es de otro cliente:
 * mismo resultado, `scoped` no distingue para no confirmar que exista).
 */
export async function actualizarProducto(
  organizationId: string,
  productoId: string,
  datos: {
    nombre?: string;
    categoria?: string | null;
    precioCents?: number | null;
    disponible?: boolean;
  },
  actor: Actor
): Promise<ProductoConfigurable | null> {
  const db = getDb();
  const donde = and(
    scoped(schema.product.organizationId, organizationId),
    eq(schema.product.id, productoId)
  )!;

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.product).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const declarados: string[] = [];
  if (datos.nombre !== undefined) {
    set.name = datos.nombre;
    declarados.push("name");
  }
  if (datos.categoria !== undefined) {
    set.category = datos.categoria;
    declarados.push("category");
  }
  if (datos.precioCents !== undefined) {
    set.priceCents = datos.precioCents;
    declarados.push("priceCents");
  }
  if (datos.disponible !== undefined) {
    set.available = datos.disponible;
    declarados.push("available");
  }
  declarados.push("updatedAt");

  const actualizados = await conRegistro(
    {
      tabla: "product",
      registro: productoId,
      leerFila,
      declarados,
      proceso: "crm:catalogo",
      actor,
    },
    async () => db.update(schema.product).set(set).where(donde).returning({ id: schema.product.id })
  );
  if (actualizados.length === 0) return null;

  const [fila] = await db.select().from(schema.product).where(donde);
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.name,
    categoria: fila.category,
    precioCents: fila.priceCents,
    disponible: fila.available,
  };
}

/**
 * Archiva un producto — nunca se borra de verdad. Un pedido viejo que lo
 * mencione tiene que seguir siendo legible, y `leerGrupos` ya sabe excluir a
 * los archivados de la pantalla de configuración.
 */
export async function archivarProducto(
  organizationId: string,
  productoId: string,
  actor: Actor
): Promise<boolean> {
  const db = getDb();
  const donde = and(
    scoped(schema.product.organizationId, organizationId),
    eq(schema.product.id, productoId)
  )!;

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.product).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  const actualizados = await conRegistro(
    {
      tabla: "product",
      registro: productoId,
      leerFila,
      declarados: ["archivedAt"],
      proceso: "crm:catalogo",
      actor,
    },
    async () =>
      db
        .update(schema.product)
        .set({ archivedAt: new Date() })
        .where(donde)
        .returning({ id: schema.product.id })
  );
  return actualizados.length > 0;
}
