/**
 * Los grupos de opciones **vistos y editados desde el CRM**.
 *
 * `queries.ts` lee el catálogo para el agente —en cada turno, y solo lo que el
 * cliente puede pedir hoy—. Esto es lo contrario: lo lee para que una persona
 * del negocio lo configure, así que muestra también lo que está apagado y trae
 * el nombre del producto y la cuenta de opciones, que al pipeline no le sirven
 * de nada.
 *
 * Hasta el 17-ago-2026 el único camino para cambiar `permiteRepeticion` era
 * `pnpm repeticion`, un script contra producción. Eso contradice la meta del
 * proyecto —un negocio nuevo se configura desde el CRM, sin tocar el núcleo ni
 * escribir código— y es lo que este módulo cierra.
 *
 * Todo va `scoped()` por organización (Constitución III): **ningún grupo de
 * otro cliente se lee ni se escribe desde aquí**, ni siquiera pasando su id.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

/** Un grupo de opciones tal y como se ve en la pantalla de configuración. */
export type GrupoConfigurable = {
  id: string;
  nombre: string;
  productoId: string;
  /** El nombre del producto al que cuelga, para no enseñar un id a nadie. */
  producto: string;
  /** >=1 = hay que elegir algo de este grupo. */
  minimo: number;
  maximo: number;
  /**
   * Cuántas opciones **disponibles** tiene.
   *
   * Disponibles y no todas: es lo que ve el validador, y por tanto lo que
   * decide si el máximo se puede alcanzar sin repetir. Contar aquí una opción
   * apagada diría "hay 4" mientras el agente ve 3.
   */
  opciones: number;
  permiteRepeticion: boolean;
};

/**
 * Lee los grupos de una organización, opcionalmente uno solo.
 *
 * Tres consultas planas y el ensamblado en memoria, igual que
 * `catalogoDePedidos`: son decenas de filas por negocio y un join por grupo no
 * compra nada.
 *
 * Los productos **archivados** se quedan fuera (ya no se venden) pero los
 * marcados como no disponibles entran: *"hoy no hay fresa"* no es motivo para
 * esconder su configuración.
 */
async function leerGrupos(
  organizationId: string,
  soloId?: string
): Promise<GrupoConfigurable[]> {
  const db = getDb();

  const grupos = await db
    .select({
      id: schema.productOptionGroup.id,
      productoId: schema.productOptionGroup.productId,
      nombre: schema.productOptionGroup.name,
      minimo: schema.productOptionGroup.minSelect,
      maximo: schema.productOptionGroup.maxSelect,
      permiteRepeticion: schema.productOptionGroup.permiteRepeticion,
      position: schema.productOptionGroup.position,
    })
    .from(schema.productOptionGroup)
    .where(
      scoped(
        schema.productOptionGroup.organizationId,
        organizationId,
        soloId ? eq(schema.productOptionGroup.id, soloId) : undefined
      )
    )
    .orderBy(asc(schema.productOptionGroup.position));

  if (grupos.length === 0) return [];

  const productos = await db
    .select({
      id: schema.product.id,
      nombre: schema.product.name,
      position: schema.product.position,
    })
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        isNull(schema.product.archivedAt)
      )
    )
    .orderBy(asc(schema.product.position), asc(schema.product.name));

  const opciones = await db
    .select({ groupId: schema.productOption.groupId })
    .from(schema.productOption)
    .where(
      scoped(
        schema.productOption.organizationId,
        organizationId,
        eq(schema.productOption.available, true)
      )
    );

  const cuantas = new Map<string, number>();
  for (const o of opciones) cuantas.set(o.groupId, (cuantas.get(o.groupId) ?? 0) + 1);

  const orden = new Map(productos.map((p, i) => [p.id, i]));

  return grupos
    // Un grupo cuyo producto está archivado no se configura: ya no se vende.
    .filter((g) => orden.has(g.productoId))
    .map((g) => ({
      id: g.id,
      nombre: g.nombre,
      productoId: g.productoId,
      producto: productos.find((p) => p.id === g.productoId)!.nombre,
      minimo: g.minimo,
      maximo: g.maximo,
      opciones: cuantas.get(g.id) ?? 0,
      permiteRepeticion: g.permiteRepeticion,
      position: g.position,
    }))
    // El orden que ve el negocio: sus productos como los presenta, y dentro de
    // cada uno, sus grupos como los cargó.
    .sort(
      (a, b) =>
        orden.get(a.productoId)! - orden.get(b.productoId)! ||
        a.position - b.position ||
        a.nombre.localeCompare(b.nombre)
    )
    .map(({ position: _position, ...g }) => g);
}

/** Todos los grupos de opciones de una organización, listos para la pantalla. */
export async function listarGruposDeOpciones(
  organizationId: string
): Promise<GrupoConfigurable[]> {
  return leerGrupos(organizationId);
}

/**
 * ¿Este negocio tiene algo que configurar aquí?
 *
 * Lo usa el menú para no ofrecer una pantalla vacía. Es una pregunta sobre los
 * DATOS del cliente, no sobre su vertical: quien tenga grupos de opciones tiene
 * dónde configurarlos, sea una churrería o un taller.
 */
export async function hayGruposDeOpciones(organizationId: string): Promise<boolean> {
  const db = getDb();
  const filas = await db
    .select({ id: schema.productOptionGroup.id })
    .from(schema.productOptionGroup)
    .where(scoped(schema.productOptionGroup.organizationId, organizationId))
    .limit(1);
  return filas.length > 0;
}

/**
 * Cambia si un grupo admite repetir la misma opción. **Y nada más.**
 *
 * `null` = ese grupo no existe **en esta organización**. Es el mismo resultado
 * para "no existe" y para "es de otro cliente", a propósito: el `WHERE` lleva
 * el `organization_id` (`scoped`), así que un id ajeno no actualiza nada y
 * tampoco confirma que exista.
 *
 * Queda registrado con `conRegistro`, que compara la fila COMPLETA antes y
 * después: si esta función tocara de paso un mínimo o un máximo, saldría
 * marcado `[NO DECLARADO]` en el log ([68](../../../docs/korexia/68-UN-DUENO-POR-DATO.md)).
 */
export async function actualizarPermiteRepeticion(
  organizationId: string,
  grupoId: string,
  permiteRepeticion: boolean,
  actor: Actor
): Promise<GrupoConfigurable | null> {
  const db = getDb();
  const donde = and(
    scoped(schema.productOptionGroup.organizationId, organizationId),
    eq(schema.productOptionGroup.id, grupoId)
  )!;

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.productOptionGroup).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  const actualizadas = await conRegistro(
    {
      tabla: "product_option_group",
      registro: grupoId,
      leerFila,
      declarados: ["permiteRepeticion"],
      proceso: "crm:repeticion",
      actor,
    },
    async () =>
      db
        .update(schema.productOptionGroup)
        .set({ permiteRepeticion })
        .where(donde)
        .returning({ id: schema.productOptionGroup.id })
  );

  if (actualizadas.length === 0) return null;
  return (await leerGrupos(organizationId, grupoId))[0] ?? null;
}
