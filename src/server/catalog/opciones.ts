/**
 * Las opciones dentro de un grupo (los toppings de "Toppings", los tamaños de
 * "Tamaño") — vistas y editadas desde el CRM. Mismo patrón que `productos.ts`
 * y `grupos.ts`: todo `scoped()` por organización.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

export type OpcionConfigurable = {
  id: string;
  groupId: string;
  nombre: string;
  /** En centavos, puede ser negativo o positivo respecto al precio base. */
  precioDeltaCents: number;
  disponible: boolean;
};

export async function listarOpciones(
  organizationId: string,
  groupId: string
): Promise<OpcionConfigurable[]> {
  const db = getDb();
  const filas = await db
    .select({
      id: schema.productOption.id,
      groupId: schema.productOption.groupId,
      nombre: schema.productOption.name,
      precioDeltaCents: schema.productOption.priceDeltaCents,
      disponible: schema.productOption.available,
    })
    .from(schema.productOption)
    .where(scoped(schema.productOption.organizationId, organizationId, eq(schema.productOption.groupId, groupId)))
    .orderBy(asc(schema.productOption.position), asc(schema.productOption.name));
  return filas;
}

/**
 * Da de alta una opción dentro de un grupo. La FK compuesta
 * (`product_option_group_fk`) exige que el grupo sea de esta organización:
 * un id ajeno falla al insertar.
 */
export async function crearOpcion(
  organizationId: string,
  groupId: string,
  datos: { nombre: string; precioDeltaCents?: number },
  actor: Actor
): Promise<OpcionConfigurable | null> {
  const db = getDb();
  const id = newId("productOption");
  try {
    await db.insert(schema.productOption).values({
      id,
      organizationId,
      groupId,
      name: datos.nombre,
      priceDeltaCents: datos.precioDeltaCents ?? 0,
    });
  } catch {
    return null; // el grupo no existe en esta organización
  }
  console.log(
    `[cambio] tabla=product_option registro=${id} campo=<fila nueva> valor_anterior=ausente ` +
      `valor_nuevo=<creada> proceso=crm:catalogo actor=${actor} timestamp=${new Date().toISOString()}`
  );
  return {
    id,
    groupId,
    nombre: datos.nombre,
    precioDeltaCents: datos.precioDeltaCents ?? 0,
    disponible: true,
  };
}

export async function actualizarOpcion(
  organizationId: string,
  opcionId: string,
  datos: { nombre?: string; precioDeltaCents?: number; disponible?: boolean },
  actor: Actor
): Promise<OpcionConfigurable | null> {
  const db = getDb();
  const donde = and(
    scoped(schema.productOption.organizationId, organizationId),
    eq(schema.productOption.id, opcionId)
  )!;

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.productOption).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  const set: Record<string, unknown> = {};
  const declarados: string[] = [];
  if (datos.nombre !== undefined) {
    set.name = datos.nombre;
    declarados.push("name");
  }
  if (datos.precioDeltaCents !== undefined) {
    set.priceDeltaCents = datos.precioDeltaCents;
    declarados.push("priceDeltaCents");
  }
  if (datos.disponible !== undefined) {
    set.available = datos.disponible;
    declarados.push("available");
  }
  if (declarados.length === 0) {
    const [f] = await db.select().from(schema.productOption).where(donde);
    if (!f) return null;
    return {
      id: f.id,
      groupId: f.groupId,
      nombre: f.name,
      precioDeltaCents: f.priceDeltaCents,
      disponible: f.available,
    };
  }

  const actualizados = await conRegistro(
    {
      tabla: "product_option",
      registro: opcionId,
      leerFila,
      declarados,
      proceso: "crm:catalogo",
      actor,
    },
    async () =>
      db.update(schema.productOption).set(set).where(donde).returning({ id: schema.productOption.id })
  );
  if (actualizados.length === 0) return null;

  const [fila] = await db.select().from(schema.productOption).where(donde);
  if (!fila) return null;
  return {
    id: fila.id,
    groupId: fila.groupId,
    nombre: fila.name,
    precioDeltaCents: fila.priceDeltaCents,
    disponible: fila.available,
  };
}

export async function eliminarOpcion(
  organizationId: string,
  opcionId: string,
  actor: Actor
): Promise<boolean> {
  const db = getDb();
  const donde = and(
    scoped(schema.productOption.organizationId, organizationId),
    eq(schema.productOption.id, opcionId)
  )!;
  const borrados = await db
    .delete(schema.productOption)
    .where(donde)
    .returning({ id: schema.productOption.id });
  if (borrados.length > 0) {
    console.log(
      `[cambio] tabla=product_option registro=${opcionId} campo=<fila borrada> ` +
        `valor_anterior=<existía> valor_nuevo=ausente proceso=crm:catalogo actor=${actor} ` +
        `timestamp=${new Date().toISOString()}`
    );
  }
  return borrados.length > 0;
}
