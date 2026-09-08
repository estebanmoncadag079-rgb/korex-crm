/**
 * Las zonas de domicilio, vistas y editadas desde el CRM.
 *
 * Fase 8G — hasta ahora `delivery_zone` solo se LEÍA (`zonas.ts`, para el
 * agente): no existía ninguna pantalla ni API para crearlas o cambiarles el
 * precio, así que la única forma de cargarlas era SQL a mano. Eso deja al
 * negocio dependiendo de la agencia para algo que cambia solo (una tarifa
 * sube, se abre un barrio nuevo) — exactamente lo que las reglas de
 * arquitectura prohíben: la configuración de un cliente se toca desde el
 * CRM, nunca por código ni por script.
 *
 * Mismo patrón EXACTO que `server/catalog/productos.ts`, que ya resolvió
 * esto para el catálogo: lectura del agente en un archivo, configuración del
 * CRM en otro, todo `scoped()` por organización (Constitución III) y todo
 * cambio registrado con `conRegistro`.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

export type ZonaConfigurable = {
  id: string;
  nombre: string;
  /** En centavos, como todo el dinero del sistema. */
  feeCents: number;
  /**
   * `false` = la zona existe pero el agente no la ve (`zonasDeEntregaQuery`
   * solo trae las activas). Sirve para dejar una tarifa cargada y revisada
   * ANTES de que empiece a cotizarse, o para retirar un barrio sin perder su
   * histórico.
   */
  activa: boolean;
};

/** Las zonas no archivadas de una organización, en su orden. */
export async function listarZonas(organizationId: string): Promise<ZonaConfigurable[]> {
  const db = getDb();
  const filas = await db
    .select({
      id: schema.deliveryZone.id,
      nombre: schema.deliveryZone.name,
      feeCents: schema.deliveryZone.feeCents,
      activa: schema.deliveryZone.active,
    })
    .from(schema.deliveryZone)
    .where(
      scoped(
        schema.deliveryZone.organizationId,
        organizationId,
        isNull(schema.deliveryZone.archivedAt)
      )
    )
    .orderBy(asc(schema.deliveryZone.position), asc(schema.deliveryZone.name));
  return filas;
}

/**
 * Da de alta una zona. `activa` por defecto en `false` a propósito: una
 * tarifa recién cargada todavía no está revisada por el negocio, y una zona
 * activa se le cotiza al cliente de inmediato. Se enciende cuando el precio
 * ya está confirmado.
 */
export async function crearZona(
  organizationId: string,
  datos: { nombre: string; feeCents: number; activa?: boolean },
  actor: Actor
): Promise<ZonaConfigurable> {
  const db = getDb();
  const id = newId("deliveryZone");
  const activa = datos.activa ?? false;
  await db.insert(schema.deliveryZone).values({
    id,
    organizationId,
    name: datos.nombre,
    feeCents: datos.feeCents,
    active: activa,
  });
  console.log(
    `[cambio] tabla=delivery_zone registro=${id} campo=<fila nueva> valor_anterior=ausente ` +
      `valor_nuevo=<creada> proceso=crm:domicilios actor=${actor} timestamp=${new Date().toISOString()}`
  );
  return { id, nombre: datos.nombre, feeCents: datos.feeCents, activa };
}

/**
 * Cambia nombre, tarifa o si está activa. Solo lo que venga en `datos`.
 *
 * `null` = la zona no existe en esta organización (o es de otro cliente:
 * mismo resultado, `scoped` no distingue para no confirmar que exista).
 */
export async function actualizarZona(
  organizationId: string,
  zonaId: string,
  datos: { nombre?: string; feeCents?: number; activa?: boolean },
  actor: Actor
): Promise<ZonaConfigurable | null> {
  const db = getDb();
  const donde = and(
    scoped(schema.deliveryZone.organizationId, organizationId),
    eq(schema.deliveryZone.id, zonaId)
  )!;

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.deliveryZone).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const declarados: string[] = [];
  if (datos.nombre !== undefined) {
    set.name = datos.nombre;
    declarados.push("name");
  }
  if (datos.feeCents !== undefined) {
    set.feeCents = datos.feeCents;
    declarados.push("feeCents");
  }
  if (datos.activa !== undefined) {
    set.active = datos.activa;
    declarados.push("active");
  }
  declarados.push("updatedAt");

  const actualizados = await conRegistro(
    {
      tabla: "delivery_zone",
      registro: zonaId,
      leerFila,
      declarados,
      proceso: "crm:domicilios",
      actor,
    },
    async () =>
      db.update(schema.deliveryZone).set(set).where(donde).returning({ id: schema.deliveryZone.id })
  );
  if (actualizados.length === 0) return null;

  const [fila] = await db.select().from(schema.deliveryZone).where(donde);
  if (!fila) return null;
  return { id: fila.id, nombre: fila.name, feeCents: fila.feeCents, activa: fila.active };
}

/**
 * Archiva una zona — nunca se borra de verdad. Un pedido viejo que la
 * mencione tiene que seguir siendo legible, igual que con los productos.
 */
export async function archivarZona(
  organizationId: string,
  zonaId: string,
  actor: Actor
): Promise<boolean> {
  const db = getDb();
  const donde = and(
    scoped(schema.deliveryZone.organizationId, organizationId),
    eq(schema.deliveryZone.id, zonaId)
  )!;

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.deliveryZone).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  const actualizados = await conRegistro(
    {
      tabla: "delivery_zone",
      registro: zonaId,
      leerFila,
      declarados: ["archivedAt"],
      proceso: "crm:domicilios",
      actor,
    },
    async () =>
      db
        .update(schema.deliveryZone)
        .set({ archivedAt: new Date() })
        .where(donde)
        .returning({ id: schema.deliveryZone.id })
  );
  return actualizados.length > 0;
}
