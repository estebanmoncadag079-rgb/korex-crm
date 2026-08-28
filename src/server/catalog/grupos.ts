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
import { newId } from "@/lib/db/ids";
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

/**
 * Da de alta un grupo de opciones para un producto — "Salsa", "Tamaño",
 * "Toppings". El producto tiene que ser de la MISMA organización: la FK
 * compuesta (`product_option_group_product_fk`) lo exige a nivel de base de
 * datos, así que un id ajeno falla al insertar, no solo al leer.
 */
export async function crearGrupo(
  organizationId: string,
  productoId: string,
  datos: { nombre: string; minimo: number; maximo: number },
  actor: Actor
): Promise<GrupoConfigurable | null> {
  const db = getDb();
  const id = newId("productOptionGroup");
  try {
    await db.insert(schema.productOptionGroup).values({
      id,
      organizationId,
      productId: productoId,
      name: datos.nombre,
      minSelect: datos.minimo,
      maxSelect: datos.maximo,
    });
  } catch {
    // FK compuesta rechazó el insert: el producto no existe en esta org.
    return null;
  }
  console.log(
    `[cambio] tabla=product_option_group registro=${id} campo=<fila nueva> valor_anterior=ausente ` +
      `valor_nuevo=<creada> proceso=crm:catalogo actor=${actor} timestamp=${new Date().toISOString()}`
  );
  return (await leerGrupos(organizationId, id))[0] ?? null;
}

/**
 * Cambia nombre, mínimo, máximo o si repite — lo que venga en `datos`. Es la
 * versión completa de `actualizarPermiteRepeticion`: existen las dos porque
 * la pantalla de "solo repetición" ya estaba en producción y no había motivo
 * para tocarla; esta la usa la pantalla de catálogo completo.
 */
export async function actualizarGrupo(
  organizationId: string,
  grupoId: string,
  datos: { nombre?: string; minimo?: number; maximo?: number; permiteRepeticion?: boolean },
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

  const set: Record<string, unknown> = {};
  const declarados: string[] = [];
  if (datos.nombre !== undefined) {
    set.name = datos.nombre;
    declarados.push("name");
  }
  if (datos.minimo !== undefined) {
    set.minSelect = datos.minimo;
    declarados.push("minSelect");
  }
  if (datos.maximo !== undefined) {
    set.maxSelect = datos.maximo;
    declarados.push("maxSelect");
  }
  if (datos.permiteRepeticion !== undefined) {
    set.permiteRepeticion = datos.permiteRepeticion;
    declarados.push("permiteRepeticion");
  }
  if (declarados.length === 0) return (await leerGrupos(organizationId, grupoId))[0] ?? null;

  const actualizados = await conRegistro(
    {
      tabla: "product_option_group",
      registro: grupoId,
      leerFila,
      declarados,
      proceso: "crm:catalogo",
      actor,
    },
    async () =>
      db
        .update(schema.productOptionGroup)
        .set(set)
        .where(donde)
        .returning({ id: schema.productOptionGroup.id })
  );
  if (actualizados.length === 0) return null;
  return (await leerGrupos(organizationId, grupoId))[0] ?? null;
}

/**
 * Elimina un grupo de opciones — y sus opciones con él (`ON DELETE CASCADE`
 * en `product_option_group_fk`). A diferencia de los productos, un grupo SÍ
 * se borra de verdad: no es algo que un pedido viejo necesite recordar por
 * su id, solo por su texto ya guardado en el resumen.
 */
export async function eliminarGrupo(
  organizationId: string,
  grupoId: string,
  actor: Actor
): Promise<boolean> {
  const db = getDb();
  const donde = and(
    scoped(schema.productOptionGroup.organizationId, organizationId),
    eq(schema.productOptionGroup.id, grupoId)
  )!;
  const borrados = await db
    .delete(schema.productOptionGroup)
    .where(donde)
    .returning({ id: schema.productOptionGroup.id });
  if (borrados.length > 0) {
    console.log(
      `[cambio] tabla=product_option_group registro=${grupoId} campo=<fila borrada> ` +
        `valor_anterior=<existía> valor_nuevo=ausente proceso=crm:catalogo actor=${actor} ` +
        `timestamp=${new Date().toISOString()}`
    );
  }
  return borrados.length > 0;
}
