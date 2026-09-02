import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9B: `crearBorradorDePlantilla` — 100% local, nunca toca un
 * proveedor. Los tres rechazos tempranos de `enviarPlantillaAAprobacion`
 * (not_found / status≠draft / sin provider) se cubren aquí porque no
 * necesitan red; el resto de su lógica real (Fase 9H: YCloud, SUCCESS/
 * EXPLICIT_FAILURE/AMBIGUOUS, reconciliación) vive en
 * `tests/unit/enviar-plantilla-a-aprobacion.test.ts`.
 *
 * `createTemplate()` (legacy, sigue intacta) NO se toca ni se re-testea
 * aquí — sus tests existentes (`tests/unit/templates.test.ts` y afines)
 * siguen corriendo sin cambios, confirmando que su comportamiento histórico
 * no varió.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

let contadorId = 0;
vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_fake${++contadorId}`,
}));

// Fase 9B, sección 15 — test especial de "cero HTTP externo": si el camino
// de borrador alguna vez llegara a invocar esto, el mock LANZA en vez de
// responder con éxito silencioso — el test falla de forma inequívoca.
const graphRequest = vi.fn(() => {
  throw new Error("PROHIBIDO: crearBorradorDePlantilla() llamó a graphRequest() (Meta)");
});
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const ycloudSendTemplate = vi.fn(() => {
  throw new Error("PROHIBIDO: crearBorradorDePlantilla() llamó a ycloudSendTemplate() (YCloud)");
});
vi.mock("@/lib/ycloud/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ycloud/client")>();
  return { ...original, ycloudSendTemplate };
});

// Red de seguridad adicional: cualquier `fetch` real (el mecanismo de
// transporte de ambos proveedores) debe fallar el test, no responder.
const fetchMock = vi.fn(() => {
  throw new Error("PROHIBIDO: crearBorradorDePlantilla() disparó un fetch() real");
});
vi.stubGlobal("fetch", fetchMock);

const insertReturningQueue: Fila[][] = [];
const selectQueue: Fila[][] = [];
const insertSpy = vi.fn();
const valuesSpy = vi.fn();

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: (...args: unknown[]) => {
      insertSpy(...args);
      return {
        values: (values: Record<string, unknown>) => {
          valuesSpy(values);
          return {
            onConflictDoNothing: () => ({
              returning: () =>
                Promise.resolve(insertReturningQueue.shift() ?? [{ id: "template_fake1", ...values }]),
            }),
          };
        },
      };
    },
    select: () => selectChain(selectQueue.shift() ?? []),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

beforeEach(() => {
  contadorId = 0;
  insertReturningQueue.length = 0;
  selectQueue.length = 0;
  insertSpy.mockReset();
  valuesSpy.mockReset();
  graphRequest.mockClear();
  ycloudSendTemplate.mockClear();
  fetchMock.mockClear();
});

const inputValido = { name: "Confirmación de prueba", language: "es", category: "UTILITY", body: "Hola {{1}}" };

describe("crearBorradorDePlantilla: 100% local, nunca toca un proveedor", () => {
  it("A — crea el draft: status='draft', 0 llamadas externas", async () => {
    insertReturningQueue.push([
      {
        id: "template_fake1",
        organizationId: "org_1",
        name: "confirmacion_de_prueba",
        language: "es",
        category: "UTILITY",
        body: "Hola {{1}}",
        status: "draft",
        waTemplateId: null,
        provider: null,
        providerStatus: null,
        providerLastSyncAt: null,
      },
    ]);
    const { crearBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    const resultado = await crearBorradorDePlantilla("org_1", inputValido);
    expect(resultado.status).toBe("draft");
    expect(graphRequest).not.toHaveBeenCalled();
    expect(ycloudSendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("B — el INSERT real usa status='draft' y provider/providerStatus/providerLastSyncAt en null, sin waTemplateId", async () => {
    insertReturningQueue.push([{ id: "template_fake1", status: "draft" }]);
    const { crearBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    await crearBorradorDePlantilla("org_1", inputValido);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        waTemplateId: null,
        provider: null,
        providerStatus: null,
        providerLastSyncAt: null,
      })
    );
  });

  it("C — variable inválida: aborta sin ningún INSERT", async () => {
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await crearBorradorDePlantilla("org_1", { ...inputValido, body: "Hola {{1}} y {{2}}" }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("D — duplicado (mismo organizationId+name+language): bloqueado por el UNIQUE existente", async () => {
    insertReturningQueue.push([]); // onConflictDoNothing: ya existía, sin filas devueltas
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await crearBorradorDePlantilla("org_1", inputValido).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(err.message).toMatch(/ya existe/i);
  });

  it("E — aislamiento multi-tenant: organizationId viaja tal cual al INSERT, nunca se infiere", async () => {
    insertReturningQueue.push([{ id: "template_fake1", organizationId: "org_ajena", status: "draft" }]);
    const { crearBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    const resultado = await crearBorradorDePlantilla("org_ajena", inputValido);
    expect(resultado.organizationId).toBe("org_ajena");
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("enviarPlantillaAAprobacion: placeholder deliberado — nunca finge éxito", () => {
  it("plantilla inexistente: not_found, sin llegar al placeholder", async () => {
    selectQueue.push([]);
    const { enviarPlantillaAAprobacion, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("not_found");
  });

  it("plantilla ya no está en draft (ej. approved): invalid, sin llegar al placeholder", async () => {
    selectQueue.push([{ status: "approved" }]);
    const { enviarPlantillaAAprobacion, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
  });

  it("draft válido pero SIN provider asignado (ni en el input ni en la fila): invalid, sin llegar a red — comportamiento real desde Fase 9H", async () => {
    selectQueue.push([{ status: "draft", provider: null }]);
    const { enviarPlantillaAAprobacion, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(graphRequest).not.toHaveBeenCalled();
    expect(ycloudSendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
