import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Manos y pies tradicional": una visita con VARIOS servicios a la vez
 * (docs/korexia/88-AUDITORIA-SELECCION-MULTIPLE.md, paso 4). El candidato
 * válido no es quien atiende cualquiera de los servicios, sino quien los
 * atiende TODOS — la intersección, no la unión. Esta prueba cubre esa
 * intersección (`staffIdsForServices`, privada) a través de la función
 * exportada que la usa, `resolverEspecialistaMultiple` — mismo criterio que
 * ya se aplicaba a `staffIdsForService` (singular, tampoco exportada:
 * tests/unit/cascada-agenda.test.ts la ejercita igual, sin importarla directo).
 */

type Fila = Record<string, unknown>;

/** Cada `select` consume la siguiente respuesta de la cola. */
let colaSelect: unknown[][] = [];

function cadena(filas: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c;
  (c as { then: unknown }).then = (r: (v: unknown) => void) =>
    Promise.resolve(filas).then(r);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => cadena(colaSelect.shift() ?? []) }),
  schema: new Proxy(
    {},
    {
      get: (_t, tabla) =>
        new Proxy({}, { get: (_t2, col) => `${String(tabla)}.${String(col)}` }),
    }
  ),
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: (...a: unknown[]) => a }));

/** Laura atiende manos Y pies; Camila solo manos. */
const AMBAS: Fila[] = [
  { staffId: "stf_laura", serviceId: "svc_manos" },
  { staffId: "stf_laura", serviceId: "svc_pies" },
  { staffId: "stf_camila", serviceId: "svc_manos" },
];
/** Nadie atiende pies: la intersección con manos siempre sale vacía. */
const SOLO_MANOS: Fila[] = [{ staffId: "stf_camila", serviceId: "svc_manos" }];

describe("resolverEspecialistaMultiple (intersección de recursos para una visita de varios servicios)", () => {
  beforeEach(() => {
    vi.resetModules();
    colaSelect = [];
  });

  it("sin nombre preferido: cualquiera de la intersección sirve", async () => {
    colaSelect = [AMBAS];
    const { resolverEspecialistaMultiple } = await import("@/server/appointments/queries");

    const r = await resolverEspecialistaMultiple("org_valen", ["svc_manos", "svc_pies"]);
    expect(r).toEqual({ ok: true, staffId: null });
  });

  it("con un nombre que SÍ está en la intersección: lo resuelve", async () => {
    colaSelect = [AMBAS, [{ id: "stf_laura", name: "Laura" }]];
    const { resolverEspecialistaMultiple } = await import("@/server/appointments/queries");

    const r = await resolverEspecialistaMultiple("org_valen", ["svc_manos", "svc_pies"], "Laura");
    expect(r).toEqual({ ok: true, staffId: "stf_laura" });
  });

  it("quien solo atiende UNO de los dos servicios no cuenta como candidata", async () => {
    // Camila atiende manos pero no pies: no debería poder resolverse "Camila"
    // para la combinación, aunque su nombre exista en el sistema.
    colaSelect = [AMBAS, [{ id: "stf_laura", name: "Laura" }]];
    const { resolverEspecialistaMultiple } = await import("@/server/appointments/queries");

    const r = await resolverEspecialistaMultiple("org_valen", ["svc_manos", "svc_pies"], "Camila");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.opciones).toEqual(["Laura"]); // Camila no está entre las opciones
  });

  it("nadie atiende la combinación completa: opciones vacías, sin segunda consulta", async () => {
    colaSelect = [SOLO_MANOS]; // una sola respuesta: si se pidiera una segunda, esto fallaría
    const { resolverEspecialistaMultiple } = await import("@/server/appointments/queries");

    const r = await resolverEspecialistaMultiple("org_valen", ["svc_manos", "svc_pies"], "Camila");
    expect(r).toEqual({ ok: false, opciones: [] });
  });

  it("un solo servicio se comporta como el caso de siempre (la intersección de uno es él mismo)", async () => {
    colaSelect = [SOLO_MANOS];
    const { resolverEspecialistaMultiple } = await import("@/server/appointments/queries");

    const r = await resolverEspecialistaMultiple("org_valen", ["svc_manos"]);
    expect(r).toEqual({ ok: true, staffId: null });
  });
});
