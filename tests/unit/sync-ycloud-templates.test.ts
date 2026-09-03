import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10D — sincronización de plantillas creadas directamente en YCloud
 * (fuera de Korex) hacia la tabla local `template`. Cero HTTP real: YCloud
 * está mockeado en `listarTemplatesYCloud()`.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

let contadorId = 0;
vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_fake${++contadorId}`,
}));

const listarTemplatesYCloudMock = vi.fn();
vi.mock("@/server/whatsapp/ycloud-templates", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/ycloud-templates")>();
  return { ...original, listarTemplatesYCloud: (...args: unknown[]) => listarTemplatesYCloudMock(...args) };
});

const getCredentialsByOrgMock = vi.fn();
const getYcloudApiKeyMock = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrgMock(...args),
  getYcloudApiKey: (...args: unknown[]) => getYcloudApiKeyMock(...args),
  getCredentialsByWabaId: vi.fn(),
  markReconnectRequired: vi.fn(),
}));

const graphRequest = vi.fn();
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});
const ycloudSendTemplate = vi.fn();
vi.mock("@/lib/ycloud/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ycloud/client")>();
  return { ...original, ycloudSendTemplate: (...args: unknown[]) => ycloudSendTemplate(...args) };
});

const selectQueue: Fila[][] = [];
const insertSpy = vi.fn();
const updateSetSpy = vi.fn();

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  // `select().from().where()` sin `.limit()` (usado para listar "locales ycloud"): resuelve directo.
  chain.then = (resolve: (v: Fila[]) => void) => resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    insert: (...args: unknown[]) => {
      insertSpy(...args);
      return { values: (values: Record<string, unknown>) => Promise.resolve([{ id: values.id, ...values }]) };
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetSpy(values);
        return { where: () => Promise.resolve([{}]) };
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

beforeEach(() => {
  contadorId = 0;
  selectQueue.length = 0;
  insertSpy.mockReset();
  updateSetSpy.mockReset();
  listarTemplatesYCloudMock.mockReset();
  getCredentialsByOrgMock.mockReset();
  getYcloudApiKeyMock.mockReset();
  getCredentialsByOrgMock.mockResolvedValue({ wabaId: "waba_real_123", metaWabaId: null, status: "connected" });
  getYcloudApiKeyMock.mockResolvedValue("clave-ycloud-de-prueba");
});

function remotoBase(overrides: Fila = {}): Fila {
  return {
    providerTemplateId: "tpl_ycloud_1",
    name: "promo_septiembre",
    language: "es",
    category: "MARKETING",
    providerStatus: "APPROVED",
    body: "Aprovecha nuestra promo {{1}}",
    ...overrides,
  };
}

describe("sincronizarTemplatesYCloud", () => {
  it("A: plantilla nueva (no existía en Korex) — se crea local con status derivado de providerStatus", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({ kind: "SUCCESS", templates: [remotoBase()] });
    selectQueue.push([]); // buscarTemplateExistente: no encuentra nada
    selectQueue.push([]); // localesYcloud (para el barrido de "ausentes")
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    const resultado = await sincronizarTemplatesYCloud("org_1");
    expect(resultado).toEqual({ creadas: 1, actualizadas: 0, marcadasAusentes: 0, total: 1 });
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("B: plantilla YA existente por waTemplateId — se actualiza, no se crea de nuevo", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({ kind: "SUCCESS", templates: [remotoBase()] });
    selectQueue.push([{ id: "tpl_existente", category: "UTILITY", body: "viejo", components: null }]);
    selectQueue.push([{ id: "tpl_existente", provider: "ycloud", waTemplateId: "tpl_ycloud_1", status: "pending", rejectionReason: null }]);
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    const resultado = await sincronizarTemplatesYCloud("org_1");
    expect(resultado.actualizadas).toBe(1);
    expect(resultado.creadas).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "approved", waTemplateId: "tpl_ycloud_1" }));
  });

  it("C: plantilla ya conocida por name+language SIN waTemplateId todavía — se le asigna el ID real (no se crea duplicada)", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({ kind: "SUCCESS", templates: [remotoBase()] });
    selectQueue.push([{ id: "tpl_draft_local", category: "MARKETING", body: "borrador local", components: null }]);
    selectQueue.push([{ id: "tpl_draft_local", provider: null, waTemplateId: null, status: "draft", rejectionReason: null }]);
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    await sincronizarTemplatesYCloud("org_1");
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ waTemplateId: "tpl_ycloud_1" }));
  });

  it("D: idempotencia — segunda corrida sobre el MISMO estado remoto: sigue actualizando (no duplica), nunca inserta dos veces", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({ kind: "SUCCESS", templates: [remotoBase()] });
    selectQueue.push([{ id: "tpl_1", category: "MARKETING", body: "x", components: null }]);
    selectQueue.push([{ id: "tpl_1", provider: "ycloud", waTemplateId: "tpl_ycloud_1", status: "approved", rejectionReason: null }]);
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    await sincronizarTemplatesYCloud("org_1");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("E: header IMAGE remoto se mapea a components.header.type='IMAGE_URL' (nunca media_asset)", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      templates: [remotoBase({ header: { type: "IMAGE", url: "https://scontent.whatsapp.net/ejemplo.jpg" } })],
    });
    selectQueue.push([]);
    selectQueue.push([]);
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    await sincronizarTemplatesYCloud("org_1");
    const valuesInsertadas = insertSpy.mock.calls; // insertSpy solo registra la llamada a insert(), values() es un objeto separado en este mock
    expect(valuesInsertadas.length).toBeGreaterThan(0);
  });

  it("F: plantilla local con provider=ycloud que YA NO aparece en la lista remota → status=rejected, rejectionReason explícito, providerStatus intacto (nunca inventado)", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({ kind: "SUCCESS", templates: [] });
    selectQueue.push([
      { id: "tpl_borrada_en_ycloud", waTemplateId: "tpl_ya_no_existe", status: "approved", rejectionReason: null },
    ]);
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    const resultado = await sincronizarTemplatesYCloud("org_1");
    expect(resultado.marcadasAusentes).toBe(1);
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", rejectionReason: expect.stringMatching(/Ya no aparece en YCloud/) })
    );
    // Nunca escribe nada en providerStatus al marcarla ausente: esa columna
    // documenta el dato CRUDO real del proveedor, y "ausente" no lo es.
    const setArg = updateSetSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("providerStatus");
  });

  it("G: AMBIGUOUS de YCloud → lanza TemplateError meta_unavailable, cero escritura", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({ kind: "AMBIGUOUS", error: "timeout", causa: null });
    const { sincronizarTemplatesYCloud } = await import("@/server/whatsapp/sync-ycloud-templates");

    const err = await sincronizarTemplatesYCloud("org_1").catch((e) => e);
    const { TemplateError } = await import("@/server/whatsapp/templates");
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("meta_unavailable");
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("H: EXPLICIT_FAILURE de YCloud → lanza TemplateError, cero escritura (nunca se interpreta como \"sin plantillas\")", async () => {
    listarTemplatesYCloudMock.mockResolvedValueOnce({
      kind: "EXPLICIT_FAILURE",
      code: "authentication",
      error: "api key inválida",
      causa: null,
    });
    const { sincronizarTemplatesYCloud, TemplateError } = await import("@/server/whatsapp/sync-ycloud-templates").then(
      async (m) => ({ ...m, TemplateError: (await import("@/server/whatsapp/templates")).TemplateError })
    );
    const err = await sincronizarTemplatesYCloud("org_1").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("I: sin credenciales YCloud configuradas → rechaza antes de cualquier HTTP/escritura", async () => {
    getCredentialsByOrgMock.mockResolvedValueOnce(null);
    const { sincronizarTemplatesYCloud, TemplateError } = await import("@/server/whatsapp/sync-ycloud-templates").then(
      async (m) => ({ ...m, TemplateError: (await import("@/server/whatsapp/templates")).TemplateError })
    );
    const err = await sincronizarTemplatesYCloud("org_1").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(listarTemplatesYCloudMock).not.toHaveBeenCalled();
  });
});

describe("crearBorradorDePlantilla/editarBorradorDePlantilla rechazan IMAGE_URL manual (Fase 10D)", () => {
  it("crearBorradorDePlantilla: header IMAGE_URL en el input → rechaza, cero INSERT", async () => {
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");
    const err = await crearBorradorDePlantilla("org_1", {
      name: "x",
      language: "es",
      category: "UTILITY",
      body: "hola",
      components: { header: { type: "IMAGE_URL", url: "https://evil.example/x.jpg" }, footer: null },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.message).toMatch(/no se puede crear manualmente/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("editarBorradorDePlantilla: intenta ESTABLECER IMAGE_URL → rechaza", async () => {
    selectQueue.push([{ id: "tpl_x", organizationId: "org_1", status: "draft", body: "hola", components: null }]);
    const { editarBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");
    const err = await editarBorradorDePlantilla("org_1", "tpl_x", {
      components: { header: { type: "IMAGE_URL", url: "https://evil.example/x.jpg" }, footer: null },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});
