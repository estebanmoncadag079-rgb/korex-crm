import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8G — la configuración de zonas de domicilio desde el CRM.
 *
 * Nace de un incidente real (MALIA, 8-sep-2026): sus tarifas vivían como
 * prosa en la ficha, con una regla final de "cualquier otro barrio, $8.000".
 * El agente la cumplía al pie de la letra y cobraba $8.000 a barrios lejanos
 * (Cañasgordas, Marroquín — verificado en sus pedidos reales). La tabla
 * `delivery_zone` ya existía, pero SOLO se leía: no había forma de cargarla
 * ni de corregir un precio sin SQL a mano, así que el negocio dependía de la
 * agencia para algo que cambia solo.
 *
 * Estas pruebas cubren lo que no puede fallar: aislamiento por organización
 * (Constitución III) y que una zona nazca INACTIVA — una tarifa recién
 * cargada, sin revisar, no puede empezar a cotizarse sola.
 */

const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updated: { set: Record<string, unknown> }[] = [];

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

vi.mock("@/server/registro-de-cambios", () => ({
  // El registro de cambios tiene sus propias pruebas; aquí solo debe dejar
  // pasar la escritura para poder observar QUÉ se escribió.
  conRegistro: async (_meta: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updated.push({ set });
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: "dz_1" }]),
          }),
        };
      },
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

beforeEach(() => {
  selectQueue.length = 0;
  inserted.length = 0;
  updated.length = 0;
});

describe("listarZonas: multi-tenant (Constitución III)", () => {
  it("pasa organizationId a scoped() — nunca confía en el cliente", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([{ id: "dz_1", nombre: "Kachipay", feeCents: 1200000, activa: true }]);

    const { listarZonas } = await import("@/server/delivery/zonas-config");
    await listarZonas("org_1");

    expect(scopedSpy).toHaveBeenCalledWith(
      "deliveryZone.organizationId",
      "org_1",
      expect.anything()
    );
  });

  it("devuelve exactamente lo que entrega la consulta scoped", async () => {
    selectQueue.push([
      { id: "dz_1", nombre: "Kachipay", feeCents: 1200000, activa: true },
      { id: "dz_2", nombre: "Centro", feeCents: 500000, activa: false },
    ]);
    const { listarZonas } = await import("@/server/delivery/zonas-config");
    const zonas = await listarZonas("org_1");
    expect(zonas).toHaveLength(2);
    expect(zonas[1]).toEqual({ id: "dz_2", nombre: "Centro", feeCents: 500000, activa: false });
  });
});

describe("crearZona", () => {
  it("una zona nueva nace INACTIVA: una tarifa sin revisar no se cotiza sola", async () => {
    const { crearZona } = await import("@/server/delivery/zonas-config");
    const zona = await crearZona(
      "org_1",
      { nombre: "Cañasgordas", feeCents: 1000000 },
      "user:u1"
    );

    expect(zona.activa).toBe(false);
    expect(inserted[0]).toMatchObject({
      organizationId: "org_1",
      name: "Cañasgordas",
      feeCents: 1000000,
      active: false,
    });
  });

  it("se puede crear ya activa cuando el precio viene confirmado", async () => {
    const { crearZona } = await import("@/server/delivery/zonas-config");
    const zona = await crearZona(
      "org_1",
      { nombre: "Ciudad Jardín", feeCents: 1000000, activa: true },
      "user:u1"
    );
    expect(zona.activa).toBe(true);
    expect(inserted[0]).toMatchObject({ active: true });
  });

  it("guarda la organización del servidor, no una que venga de fuera", async () => {
    const { crearZona } = await import("@/server/delivery/zonas-config");
    await crearZona("org_2", { nombre: "Centro", feeCents: 800000 }, "user:u1");
    expect(inserted[0]!.organizationId).toBe("org_2");
  });
});

describe("actualizarZona", () => {
  it("cambia solo lo que viene: un campo ausente no se toca", async () => {
    selectQueue.push([
      { id: "dz_1", name: "Kachipay", feeCents: 1200000, active: true },
    ]);
    const { actualizarZona } = await import("@/server/delivery/zonas-config");
    await actualizarZona("org_1", "dz_1", { feeCents: 1300000 }, "user:u1");

    expect(updated[0]!.set).toMatchObject({ feeCents: 1300000 });
    expect(updated[0]!.set).not.toHaveProperty("name");
    expect(updated[0]!.set).not.toHaveProperty("active");
  });

  it("activar/desactivar es un cambio de estado, no un borrado", async () => {
    selectQueue.push([{ id: "dz_1", name: "Kachipay", feeCents: 1200000, active: false }]);
    const { actualizarZona } = await import("@/server/delivery/zonas-config");
    await actualizarZona("org_1", "dz_1", { activa: true }, "user:u1");
    expect(updated[0]!.set).toMatchObject({ active: true });
    expect(updated[0]!.set).not.toHaveProperty("archivedAt");
  });

  it("scoped por organización: nunca se actualiza por id suelto", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([{ id: "dz_1", name: "Kachipay", feeCents: 1200000, active: true }]);

    const { actualizarZona } = await import("@/server/delivery/zonas-config");
    await actualizarZona("org_1", "dz_1", { feeCents: 900000 }, "user:u1");

    expect(scopedSpy).toHaveBeenCalledWith("deliveryZone.organizationId", "org_1");
  });
});

describe("archivarZona", () => {
  it("archiva, nunca borra: un pedido viejo que la mencione tiene que seguir siendo legible", async () => {
    const { archivarZona } = await import("@/server/delivery/zonas-config");
    const ok = await archivarZona("org_1", "dz_1", "user:u1");
    expect(ok).toBe(true);
    expect(updated[0]!.set).toHaveProperty("archivedAt");
  });
});
