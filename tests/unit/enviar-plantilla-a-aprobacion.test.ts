import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9H: conecta `enviarPlantillaAAprobacion()`/`reconciliarCreacionTemplateYCloud()`
 * con el adaptador YCloud (`crearTemplateYCloud`/`obtenerTemplateYCloud`, ya
 * aprobado en 9G — aquí mockeados, cero HTTP real). Cubre SUCCESS/
 * EXPLICIT_FAILURE/AMBIGUOUS, reconciliación, idempotencia y multi-tenant.
 *
 * Los tres rechazos que NO necesitan red (not_found / status≠draft / sin
 * provider) ya se prueban en `crear-borrador-plantilla.test.ts` (Fase 9B) —
 * no se repiten aquí salvo donde hace falta contexto adicional.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

// Red de seguridad: si esta capa alguna vez llamara directo a Graph/YCloud-envío
// en vez de pasar por el adaptador mockeado abajo, el test debe fallar fuerte.
const graphRequest = vi.fn(() => {
  throw new Error("PROHIBIDO: llamó a graphRequest() (Meta) directo");
});
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const ycloudSendTemplate = vi.fn(() => {
  throw new Error("PROHIBIDO: llamó a ycloudSendTemplate() (envío, no gestión)");
});
vi.mock("@/lib/ycloud/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ycloud/client")>();
  return { ...original, ycloudSendTemplate };
});

const fetchMock = vi.fn(() => {
  throw new Error("PROHIBIDO: disparó un fetch() real — el adaptador debe estar mockeado");
});
vi.stubGlobal("fetch", fetchMock);

const crearTemplateYCloudMock = vi.fn();
const obtenerTemplateYCloudMock = vi.fn();
vi.mock("@/server/whatsapp/ycloud-templates", () => ({
  crearTemplateYCloud: (...args: unknown[]) => crearTemplateYCloudMock(...args),
  obtenerTemplateYCloud: (...args: unknown[]) => obtenerTemplateYCloudMock(...args),
}));

let credsResult: Fila | null = {
  wabaId: "waba_real_123",
  metaWabaId: null,
  status: "connected",
};
let apiKeyResult: string | null = "clave-ycloud-de-prueba";
const getCredentialsByOrgSpy = vi.fn();
const getYcloudApiKeySpy = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => {
    getCredentialsByOrgSpy(...args);
    return Promise.resolve(credsResult);
  },
  getYcloudApiKey: (...args: unknown[]) => {
    getYcloudApiKeySpy(...args);
    return Promise.resolve(apiKeyResult);
  },
}));

const selectQueue: Fila[][] = [];
const updateReturningQueue: Fila[][] = [];
const updateSetSpy = vi.fn();
let updateThrows = false;

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

function updateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = (values: Record<string, unknown>) => {
    updateSetSpy(values);
    return chain;
  };
  chain.where = () => chain;
  chain.returning = () => {
    if (updateThrows) {
      updateThrows = false;
      return Promise.reject(new Error("DB caída"));
    }
    return Promise.resolve(updateReturningQueue.shift() ?? [{}]);
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => updateChain(),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

beforeEach(() => {
  selectQueue.length = 0;
  updateReturningQueue.length = 0;
  updateThrows = false;
  updateSetSpy.mockReset();
  crearTemplateYCloudMock.mockReset();
  obtenerTemplateYCloudMock.mockReset();
  getCredentialsByOrgSpy.mockClear();
  getYcloudApiKeySpy.mockClear();
  graphRequest.mockClear();
  ycloudSendTemplate.mockClear();
  fetchMock.mockClear();
  credsResult = { wabaId: "waba_real_123", metaWabaId: null, status: "connected" };
  apiKeyResult = "clave-ycloud-de-prueba";
});

function filaDraft(overrides: Fila = {}): Fila {
  return {
    id: "template_x",
    organizationId: "org_1",
    name: "confirmacion",
    language: "es",
    category: "UTILITY",
    body: "Hola, gracias",
    status: "draft",
    rejectionReason: null,
    waTemplateId: null,
    provider: null,
    providerStatus: null,
    providerLastSyncAt: null,
    ...overrides,
  };
}

async function cargarModulo() {
  return import("@/server/whatsapp/templates");
}

describe("enviarPlantillaAAprobacion (Fase 9H)", () => {
  it("A: draft + provider=ycloud → usa el adaptador (crearTemplateYCloud llamado 1 vez)", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      providerTemplateId: "tpl_1",
      providerName: "confirmacion",
      providerLanguage: "es",
      providerCategory: "UTILITY",
      providerStatus: "PENDING",
    });
    updateReturningQueue.push([filaDraft({ status: "pending", waTemplateId: "tpl_1", provider: "ycloud", providerStatus: "PENDING" })]);
    const { enviarPlantillaAAprobacion } = await cargarModulo();

    const resultado = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" });
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1);
    expect(resultado.status).toBe("pending");
  });

  it("B: template no draft (approved) → rechazo, 0 llamadas al adaptador", async () => {
    selectQueue.push([filaDraft({ status: "approved" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("invalid");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("C: provider null (ni input ni fila) → rechazo claro, 0 llamadas al adaptador", async () => {
    selectQueue.push([filaDraft({ provider: null })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("invalid");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("D: provider=graph → not_implemented, NO usa el adaptador YCloud", async () => {
    selectQueue.push([filaDraft({ provider: "graph" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("not_implemented");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("E: credentials faltantes → rechazo sin HTTP", async () => {
    selectQueue.push([filaDraft()]);
    credsResult = null;
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("not_connected");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("F: WABA inexistente (cuenta YCloud propia sin metaWabaId capturado) → rechazo sin HTTP", async () => {
    selectQueue.push([filaDraft()]);
    credsResult = { wabaId: "ycloud:573000000000", metaWabaId: null, status: "connected" };
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("not_connected");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("G: SUCCESS con providerStatus=PENDING → DB actualizada a status='pending'", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      providerTemplateId: "tpl_g",
      providerName: "confirmacion",
      providerLanguage: "es",
      providerCategory: "UTILITY",
      providerStatus: "PENDING",
    });
    updateReturningQueue.push([filaDraft({ status: "pending", waTemplateId: "tpl_g", providerStatus: "PENDING" })]);
    const { enviarPlantillaAAprobacion } = await cargarModulo();

    const resultado = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" });
    expect(resultado.status).toBe("pending");
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", waTemplateId: "tpl_g", provider: "ycloud", providerStatus: "PENDING" })
    );
  });

  it("H: SUCCESS con providerStatus=APPROVED → DB actualizada a status='approved'", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      providerTemplateId: "tpl_h",
      providerName: "confirmacion",
      providerLanguage: "es",
      providerCategory: "UTILITY",
      providerStatus: "APPROVED",
    });
    updateReturningQueue.push([filaDraft({ status: "approved", waTemplateId: "tpl_h", providerStatus: "APPROVED" })]);
    const { enviarPlantillaAAprobacion } = await cargarModulo();

    const resultado = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" });
    expect(resultado.status).toBe("approved");
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
  });

  it("I: SUCCESS con providerStatus=REJECTED → DB actualizada a status='rejected' con rejectionReason", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      providerTemplateId: "tpl_i",
      providerName: "confirmacion",
      providerLanguage: "es",
      providerCategory: "UTILITY",
      providerStatus: "REJECTED",
    });
    updateReturningQueue.push([filaDraft({ status: "rejected", waTemplateId: "tpl_i", providerStatus: "REJECTED" })]);
    const { enviarPlantillaAAprobacion } = await cargarModulo();

    const resultado = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" });
    expect(resultado.status).toBe("rejected");
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", rejectionReason: expect.any(String) })
    );
  });

  it("J: EXPLICIT_FAILURE validation → status NO se toca (sigue draft), rejectionReason guardado", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "EXPLICIT_FAILURE",
      code: "validation",
      error: "nombre inválido",
      causa: null,
    });
    updateReturningQueue.push([filaDraft({ rejectionReason: "nombre inválido" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("invalid");
    const setArg = updateSetSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("status");
    expect(setArg.rejectionReason).toBe("nombre inválido");
  });

  it("K: EXPLICIT_FAILURE authentication → estado seguro, status intacto", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "EXPLICIT_FAILURE",
      code: "authentication",
      error: "api key inválida",
      causa: null,
    });
    updateReturningQueue.push([filaDraft({ rejectionReason: "api key inválida" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("invalid");
    const setArg = updateSetSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("status");
  });

  it("L: AMBIGUOUS → NO reintenta el POST (crearTemplateYCloud llamado exactamente 1 vez)", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({ kind: "AMBIGUOUS", error: "timeout", causa: null });
    updateReturningQueue.push([filaDraft({ provider: "ycloud" })]);
    const { enviarPlantillaAAprobacion } = await cargarModulo();

    await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch(() => {});
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1);
  });

  it("M: AMBIGUOUS → NUNCA marca approved (ni ningún otro status)", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({ kind: "AMBIGUOUS", error: "timeout", causa: null });
    updateReturningQueue.push([filaDraft({ provider: "ycloud" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("meta_unavailable");
    const setArg = updateSetSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("status");
    expect(setArg).not.toHaveProperty("rejectionReason");
  });

  it("Q: segundo submit sobre template ya aprobado → 0 llamadas al adaptador", async () => {
    selectQueue.push([filaDraft({ status: "approved", provider: "ycloud", waTemplateId: "tpl_ya" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("invalid");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("R: draft con waTemplateId ya presente (defensa en profundidad) → 0 llamadas al adaptador", async () => {
    selectQueue.push([filaDraft({ status: "draft", provider: "ycloud", waTemplateId: "tpl_defensa" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("invalid");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("S: cross-tenant (organización sin esa plantilla) → not_found, 0 HTTP", async () => {
    selectQueue.push([]); // scoped no encuentra nada
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_ajena", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("not_found");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T: la API key nunca aparece en el error devuelto, aunque sí se usó para llamar al adaptador", async () => {
    selectQueue.push([filaDraft()]);
    apiKeyResult = "clave-secreta-ycloud-nunca-debe-salir";
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "EXPLICIT_FAILURE",
      code: "authentication",
      error: "no autorizado",
      causa: null,
    });
    updateReturningQueue.push([filaDraft({ rejectionReason: "no autorizado" })]);
    const { enviarPlantillaAAprobacion } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(JSON.stringify({ message: (err as Error).message })).not.toContain(apiKeyResult);
    expect(crearTemplateYCloudMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: apiKeyResult }));
  });
});

describe("reconciliarCreacionTemplateYCloud (Fase 9H, sección 11)", () => {
  function filaPendienteReconciliar(overrides: Fila = {}): Fila {
    return filaDraft({ provider: "ycloud", providerLastSyncAt: new Date("2026-09-01T00:00:00Z"), rejectionReason: null, ...overrides });
  }

  it("N: reconcile SUCCESS → actualiza el providerTemplateId real y el status mapeado", async () => {
    selectQueue.push([filaPendienteReconciliar()]);
    obtenerTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      template: { providerTemplateId: "tpl_reconciliado", name: "confirmacion", language: "es", category: "UTILITY", providerStatus: "APPROVED" },
    });
    updateReturningQueue.push([filaDraft({ status: "approved", waTemplateId: "tpl_reconciliado" })]);
    const { reconciliarCreacionTemplateYCloud } = await cargarModulo();

    const resultado = await reconciliarCreacionTemplateYCloud("org_1", "template_x");
    expect(resultado.status).toBe("confirmado");
    expect(resultado.template.waTemplateId).toBe("tpl_reconciliado");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled(); // NUNCA un POST desde reconciliar
  });

  it("O: reconcile NOT_FOUND → marca que se puede reintentar (fallo_explicito), NUNCA reintenta sola", async () => {
    selectQueue.push([filaPendienteReconciliar()]);
    obtenerTemplateYCloudMock.mockResolvedValueOnce({ kind: "NOT_FOUND" });
    updateReturningQueue.push([filaDraft({ rejectionReason: "no encontrada, reintentable" })]);
    const { reconciliarCreacionTemplateYCloud } = await cargarModulo();

    const resultado = await reconciliarCreacionTemplateYCloud("org_1", "template_x");
    expect(resultado.status).toBe("no_encontrado_reintentable");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("P: reconcile AMBIGUOUS → sigue pendiente, no se afirma nada", async () => {
    selectQueue.push([filaPendienteReconciliar()]);
    obtenerTemplateYCloudMock.mockResolvedValueOnce({ kind: "AMBIGUOUS", error: "timeout", causa: null });
    updateReturningQueue.push([filaPendienteReconciliar()]);
    const { reconciliarCreacionTemplateYCloud } = await cargarModulo();

    const resultado = await reconciliarCreacionTemplateYCloud("org_1", "template_x");
    expect(resultado.status).toBe("pendiente");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("reconcile EXPLICIT_FAILURE (de la propia consulta) NUNCA se trata como NOT_FOUND", async () => {
    selectQueue.push([filaPendienteReconciliar()]);
    obtenerTemplateYCloudMock.mockResolvedValueOnce({ kind: "EXPLICIT_FAILURE", code: "rate_limited", error: "429", causa: null });
    updateReturningQueue.push([filaPendienteReconciliar()]);
    const { reconciliarCreacionTemplateYCloud } = await cargarModulo();

    const resultado = await reconciliarCreacionTemplateYCloud("org_1", "template_x");
    expect(resultado.status).toBe("pendiente");
  });

  it("reconcile sobre una plantilla nunca sometida → rechazo, sin llamar al adaptador", async () => {
    selectQueue.push([filaDraft({ provider: "ycloud", providerLastSyncAt: null })]);
    const { reconciliarCreacionTemplateYCloud, TemplateError } = await cargarModulo();

    const err = await reconciliarCreacionTemplateYCloud("org_1", "template_x").catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(obtenerTemplateYCloudMock).not.toHaveBeenCalled();
  });
});

describe("ESPECIAL — no doble creación: submit AMBIGUOUS → reconcile NOT_FOUND → retry queda habilitado pero NO se ejecuta aquí (sección 20)", () => {
  it("POST#1=1, GET=1, POST#2=0", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({ kind: "AMBIGUOUS", error: "timeout", causa: null });
    updateReturningQueue.push([filaDraft({ provider: "ycloud", providerLastSyncAt: new Date() })]);
    const { enviarPlantillaAAprobacion, reconciliarCreacionTemplateYCloud } = await cargarModulo();

    await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch(() => {});
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1); // POST#1

    selectQueue.push([filaDraft({ provider: "ycloud", providerLastSyncAt: new Date(), rejectionReason: null })]);
    obtenerTemplateYCloudMock.mockResolvedValueOnce({ kind: "NOT_FOUND" });
    updateReturningQueue.push([filaDraft({ provider: "ycloud", rejectionReason: "reintentable" })]);
    const reconciliado = await reconciliarCreacionTemplateYCloud("org_1", "template_x");
    expect(obtenerTemplateYCloudMock).toHaveBeenCalledTimes(1); // GET
    expect(reconciliado.status).toBe("no_encontrado_reintentable");

    // POST#2: esta fase NO ejecuta el reintento — sigue en 1 (nunca 2)
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1);
  });
});

describe("ESPECIAL — YCloud SUCCESS pero el UPDATE local falla (sección 21)", () => {
  it("NO hace un segundo POST; el error indica reconciliación, nunca finge éxito ni error genérico silencioso", async () => {
    selectQueue.push([filaDraft()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      providerTemplateId: "tpl_db_failure",
      providerName: "confirmacion",
      providerLanguage: "es",
      providerCategory: "UTILITY",
      providerStatus: "PENDING",
    });
    updateThrows = true;
    const { enviarPlantillaAAprobacion, TemplateError } = await cargarModulo();

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as { code: string }).code).toBe("local_write_failed");
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1); // nunca un segundo POST
  });
});
