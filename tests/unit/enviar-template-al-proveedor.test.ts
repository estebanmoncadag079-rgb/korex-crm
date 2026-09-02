import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 5C: `enviarTemplateAlProveedor()` / `ResultadoProveedor` — el
 * contrato tipado que separa "esto no llegó a intentarse" (precondición,
 * sigue lanzando `TemplateError`/`SendError`, sin cambios) de "esto fue el
 * resultado real de UN intento de envío" (nunca lanzado, siempre devuelto).
 *
 * Clasificación auditada en Fase 5A/5B, no inventada: YCloud expone el
 * status HTTP real (429 explícito y reintentable, ≥500 ambiguo, cualquier
 * otro 4xx explícito no reintentable); Graph, vía `translateMetaError`, solo
 * distingue auth / no-disponible / "meta_error" genérico — sin evidencia
 * para separar un 429 de un 400 ahí, se clasifica conservadoramente.
 */

const graphRequest = vi.fn();
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const ycloudSendTemplateMock = vi.fn();
const isYcloudEnabled = vi.fn();
vi.mock("@/lib/ycloud/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ycloud/client")>();
  return {
    ...original,
    isYcloudEnabled: (...args: unknown[]) => isYcloudEnabled(...args),
    ycloudSendTemplate: (...args: unknown[]) => ycloudSendTemplateMock(...args),
  };
});

const getCredentialsByOrg = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrg(...args),
  getCredentialsByWabaId: vi.fn(),
  markReconnectRequired: vi.fn(),
}));

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectQueue: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () =>
          Promise.resolve([{ ...values, id: values.id ?? "msg_1", createdAt: new Date() }]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

const template = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "seguimiento",
  language: "es",
  body: "Hola {{1}}",
  status: "approved",
};
const conversationRow = {
  conversation: { id: "cv_1", organizationId: "org_1", isTest: false },
  contact: { id: "ct_1", phone: "573001112233", waUserId: null },
};
const credsYcloud = {
  organizationId: "org_1",
  phoneNumberId: "ycloud:573155136091",
  token: "clientkey",
  displayPhoneNumber: "573155136091",
  status: "connected",
};
const credsGraph = {
  organizationId: "org_1",
  phoneNumberId: "123456",
  token: "graph-token",
  displayPhoneNumber: "573155136091",
  status: "connected",
};

function input() {
  return {
    organizationId: "org_1",
    conversationId: "cv_1",
    templateId: "tpl_1",
    variable: "María",
  };
}

describe("enviarTemplateAlProveedor: clasificación YCloud", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    ycloudSendTemplateMock.mockReset();
    isYcloudEnabled.mockReset();
    getCredentialsByOrg.mockReset();
    selectQueue.length = 0;
    getCredentialsByOrg.mockResolvedValue(credsYcloud);
  });

  it("éxito: SUCCESS con waMessageId y el texto renderizado", async () => {
    selectQueue.push([template], [conversationRow]);
    ycloudSendTemplateMock.mockResolvedValue("wamid.ok");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado).toEqual({
      kind: "SUCCESS",
      waMessageId: "wamid.ok",
      renderedText: "Hola María",
    });
  });

  it.each([
    [400, false],
    [401, false],
    [403, false],
  ])("YCloud %i → EXPLICIT_FAILURE, retryable=%s", async (status, retryable) => {
    selectQueue.push([template], [conversationRow]);
    const { YcloudHttpError } = await import("@/lib/ycloud/client");
    ycloudSendTemplateMock.mockRejectedValue(new YcloudHttpError(status, `error ${status}`));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado.kind).toBe("EXPLICIT_FAILURE");
    expect((resultado as { retryable: boolean }).retryable).toBe(retryable);
  });

  it("YCloud 429 → EXPLICIT_FAILURE, retryable=true (certeza de rechazo, no ambigüedad)", async () => {
    selectQueue.push([template], [conversationRow]);
    const { YcloudHttpError } = await import("@/lib/ycloud/client");
    ycloudSendTemplateMock.mockRejectedValue(new YcloudHttpError(429, "rate limited"));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado).toMatchObject({
      kind: "EXPLICIT_FAILURE",
      retryable: true,
    });
  });

  it("YCloud 500 → AMBIGUOUS_FAILURE (pudo empezar a procesar)", async () => {
    selectQueue.push([template], [conversationRow]);
    const { YcloudHttpError } = await import("@/lib/ycloud/client");
    ycloudSendTemplateMock.mockRejectedValue(new YcloudHttpError(500, "server error"));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado.kind).toBe("AMBIGUOUS_FAILURE");
  });

  it("error de red (no YcloudHttpError) → AMBIGUOUS_FAILURE siempre", async () => {
    selectQueue.push([template], [conversationRow]);
    ycloudSendTemplateMock.mockRejectedValue(new Error("ECONNRESET"));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado.kind).toBe("AMBIGUOUS_FAILURE");
  });

  it("retry/timeoutMs se propagan tal cual a ycloudSendTemplate", async () => {
    selectQueue.push([template], [conversationRow]);
    ycloudSendTemplateMock.mockResolvedValue("wamid.ok");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    await enviarTemplateAlProveedor({ ...input(), retry: false, timeoutMs: 10_000 });
    expect(ycloudSendTemplateMock.mock.calls[0]![0]).toMatchObject({
      retry: false,
      timeoutMs: 10_000,
    });
  });
});

describe("enviarTemplateAlProveedor: clasificación Graph", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    ycloudSendTemplateMock.mockReset();
    isYcloudEnabled.mockReset();
    getCredentialsByOrg.mockReset();
    selectQueue.length = 0;
    getCredentialsByOrg.mockResolvedValue(credsGraph);
    isYcloudEnabled.mockReturnValue(false);
  });

  it("éxito por Graph: SUCCESS", async () => {
    selectQueue.push([template], [conversationRow]);
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.graph.1" }] });
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado).toMatchObject({ kind: "SUCCESS", waMessageId: "wamid.graph.1" });
  });

  it("Graph meta_unavailable (status 0 o ≥500) → AMBIGUOUS_FAILURE", async () => {
    selectQueue.push([template], [conversationRow]);
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(new MetaApiError("no disponible", { status: 500 }));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado.kind).toBe("AMBIGUOUS_FAILURE");
  });

  it("Graph meta_error (4xx explícito, incluido un posible 429 no distinguible) → EXPLICIT_FAILURE no reintentable", async () => {
    selectQueue.push([template], [conversationRow]);
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(new MetaApiError("bad request", { status: 400 }));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor(input());
    expect(resultado).toMatchObject({ kind: "EXPLICIT_FAILURE", retryable: false });
  });

  it("Graph auth error (token vencido) → se relanza como señal de reconexión, NUNCA se convierte en resultado", async () => {
    selectQueue.push([template], [conversationRow]);
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(new MetaApiError("token expirado", { status: 401 }));
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    await expect(enviarTemplateAlProveedor(input())).rejects.toMatchObject({
      code: "reconnect_required",
    });
  });
});
