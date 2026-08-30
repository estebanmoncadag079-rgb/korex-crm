import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `validarConfiguracionArquitectonica` es SOLO LECTURA (Fase 7/8 de la
 * corrección de onboarding): compara la fila real contra la matriz aprobada
 * de `arquitectura.ts` y nunca escribe. Los cuatro casos de abajo reproducen,
 * con nombres genéricos, los cuatro clientes reales que motivaron esta
 * corrección: uno alineado con TODO (como Lis), uno con solo lo recomendado
 * pendiente (como La Churra), uno con un mecanismo CORE apagado (como Malía),
 * y uno de citas alineado (como Lashes Valen).
 */

const selectQueue: unknown[][] = [];
const dbSpies = { insert: vi.fn(), update: vi.fn(), delete: vi.fn() };

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: dbSpies.insert,
    update: dbSpies.update,
    delete: dbSpies.delete,
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

function fila(datos: {
  appointmentsEnabled: boolean;
  catalogSource: "prompt" | "tabla";
  stateSource: "prompt" | "backend";
  paymentSource: "prompt" | "ficha";
  consultasVerificadasEnabled: boolean;
}) {
  return datos;
}

describe("validarConfiguracionArquitectonica", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbSpies.insert.mockReset();
    dbSpies.update.mockReset();
    dbSpies.delete.mockReset();
  });

  it("organización de pedidos con TODO alineado (como Lis) → ALINEADO", async () => {
    selectQueue.push([
      fila({
        appointmentsEnabled: false,
        catalogSource: "tabla",
        stateSource: "backend",
        paymentSource: "ficha",
        consultasVerificadasEnabled: true,
      }),
    ]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    const diag = await validarConfiguracionArquitectonica("org_como_lis");

    expect(diag?.vertical).toBe("pedidos");
    expect(diag?.estado).toBe("ALINEADO");
    expect(diag?.faltantes).toEqual([]);
    expect(diag?.advertencias).toEqual([]);
    expect(diag?.incompatibles).toEqual([]);
    expect(diag?.alineados).toHaveLength(5);
  });

  it("organización de pedidos con solo lo recomendado pendiente (como La Churra) → ADVERTENCIA", async () => {
    selectQueue.push([
      fila({
        appointmentsEnabled: false,
        catalogSource: "tabla",
        stateSource: "backend",
        paymentSource: "prompt",
        consultasVerificadasEnabled: false,
      }),
    ]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    const diag = await validarConfiguracionArquitectonica("org_como_la_churra");

    expect(diag?.estado).toBe("ADVERTENCIA");
    expect(diag?.faltantes).toEqual([]);
    expect(diag?.advertencias.sort()).toEqual(["consultasVerificadasEnabled", "paymentSource"].sort());
  });

  it("organización de pedidos con un mecanismo CORE apagado (como Malía) → INCONSISTENTE", async () => {
    selectQueue.push([
      fila({
        appointmentsEnabled: false,
        catalogSource: "tabla",
        stateSource: "prompt", // el mecanismo que se le olvidó encender a Malía
        paymentSource: "prompt",
        consultasVerificadasEnabled: false,
      }),
    ]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    const diag = await validarConfiguracionArquitectonica("org_como_malia");

    expect(diag?.estado).toBe("INCONSISTENTE");
    expect(diag?.faltantes).toEqual(["stateSource"]);
    // Lo recomendado pendiente sigue reportándose aparte, no se pierde.
    expect(diag?.advertencias.sort()).toEqual(["consultasVerificadasEnabled", "paymentSource"].sort());
  });

  it("organización de citas alineada (como Lashes Valen) → ALINEADO", async () => {
    selectQueue.push([
      fila({
        appointmentsEnabled: true,
        catalogSource: "prompt",
        stateSource: "backend",
        paymentSource: "prompt",
        consultasVerificadasEnabled: false,
      }),
    ]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    const diag = await validarConfiguracionArquitectonica("org_como_lashes");

    expect(diag?.vertical).toBe("citas");
    expect(diag?.estado).toBe("ALINEADO");
    expect(diag?.incompatibles).toEqual([]);
  });

  it("un mecanismo de OTRO vertical encendido donde no aplica → incompatible, INCONSISTENTE", async () => {
    selectQueue.push([
      fila({
        appointmentsEnabled: true, // citas
        catalogSource: "tabla", // esto es de pedidos: no debería estar aquí
        stateSource: "backend",
        paymentSource: "prompt",
        consultasVerificadasEnabled: false,
      }),
    ]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    const diag = await validarConfiguracionArquitectonica("org_con_dato_suelto");

    expect(diag?.incompatibles).toEqual(["catalogSource"]);
    expect(diag?.estado).toBe("INCONSISTENTE");
  });

  it("organización que no existe → null", async () => {
    selectQueue.push([]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    const diag = await validarConfiguracionArquitectonica("org_que_no_existe");
    expect(diag).toBeNull();
  });

  it("una organización recién aprovisionada SIEMPRE valida como ALINEADO (misma fuente que provisionOrganization)", async () => {
    // Prueba de no-duplicación: si `provisionOrganization` y este validador
    // leyeran reglas distintas, un cliente recién creado podría salir
    // ADVERTENCIA/INCONSISTENTE el mismo día que nace. Al alimentar el
    // validador con la salida REAL de `arquitecturaAprobadaPara` (la misma
    // función que usa el alta), esto solo puede pasar si las dos leen de la
    // fuente compartida.
    const { arquitecturaAprobadaPara } = await import("@/server/auth/arquitectura");
    for (const vertical of ["pedidos", "citas"] as const) {
      selectQueue.push([arquitecturaAprobadaPara(vertical)]);
      const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
      const diag = await validarConfiguracionArquitectonica(`org_recien_nacida_${vertical}`);
      expect(diag?.estado).toBe("ALINEADO");
      expect(diag?.vertical).toBe(vertical);
    }
  });

  it("es SOLO LECTURA: nunca inserta, actualiza ni borra", async () => {
    selectQueue.push([
      fila({
        appointmentsEnabled: false,
        catalogSource: "prompt",
        stateSource: "prompt",
        paymentSource: "prompt",
        consultasVerificadasEnabled: false,
      }),
    ]);
    const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
    await validarConfiguracionArquitectonica("org_cualquiera");

    expect(dbSpies.insert).not.toHaveBeenCalled();
    expect(dbSpies.update).not.toHaveBeenCalled();
    expect(dbSpies.delete).not.toHaveBeenCalled();
  });
});
