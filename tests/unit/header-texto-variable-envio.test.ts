import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INCIDENTE REAL (Camilabrandcol, 15-sep-2026).
 *
 * Su plantilla `ventana_cerrada_23h`, aprobada por Meta, tiene el BODY sin
 * variables y el HEADER con una: `"{{1}} Estamos para ayudarte"`.
 *
 * Korex solo miraba el body para decidir si hacían falta parámetros:
 *
 *     const needsVariable = countVariables(contenido.body) === 1;
 *
 * Como el body no tenía ninguna, concluía "esta plantilla no necesita
 * nada", la pantalla no pedía ningún valor, y el envío salía sin
 * parámetros. Meta lo rechazaba:
 *
 *     (#132000) Number of parameters does not match the expected number of params
 *
 * El mensaje aparecía en el chat con marca de error y nunca llegaba a la
 * clienta. Meta numera las variables POR COMPONENTE: el `{{1}}` del header
 * y el del body son dos parámetros distintos, cada uno en su componente.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({ scoped: (...conds: unknown[]) => conds }));

vi.mock("@/server/ai/fotos", () => ({
  urlPublicaDeFoto: () => "https://cdn.korex.ia/media/foto1.jpg",
}));

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
  getYcloudApiKey: vi.fn().mockResolvedValue("clave-de-prueba"),
  getCredentialsByWabaId: vi.fn(),
  markReconnectRequired: vi.fn(),
}));

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectQueue: Fila[][] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{}]) }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => Promise.resolve([{ ...v, id: "msg_1", createdAt: new Date() }]),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tabla) => new Proxy({}, { get: (_t2, col) => `${String(tabla)}.${String(col)}` }) }
  ),
}));

/** La plantilla REAL de Camilabrandcol: body fijo, variable SOLO en el header. */
const PLANTILLA_DE_CAMILA = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "ventana_cerrada_23h",
  language: "es_CO",
  body: "✨ ¡Hola! Bienvenido(a) a Camilabrandcol. ¡Gracias por tu paciencia!",
  status: "approved",
  components: { header: { type: "TEXT", text: "{{1}} Estamos para ayudarte" }, footer: null },
};

const conversationRow = {
  conversation: { id: "cv_1", organizationId: "org_1", isTest: false },
  contact: { id: "ct_1", phone: "573001112233", waUserId: null },
};
const credsYcloud = {
  organizationId: "org_1",
  phoneNumberId: "ycloud:573043884918",
  token: "clientkey",
  displayPhoneNumber: "573043884918",
  status: "connected",
};
const credsGraph = { ...credsYcloud, phoneNumberId: "123456", token: "graph-token" };

beforeEach(() => {
  selectQueue.length = 0;
  getCredentialsByOrg.mockReset();
  graphRequest.mockReset();
  ycloudSendTemplateMock.mockReset();
  isYcloudEnabled.mockReset();
  getCredentialsByOrg.mockResolvedValue(credsYcloud);
});

describe("plantilla con variable SOLO en el encabezado (el caso que Meta rechazaba con #132000)", () => {
  it("YCloud: el valor del encabezado viaja como headerTextParam", async () => {
    selectQueue.push([PLANTILLA_DE_CAMILA], [conversationRow]);
    ycloudSendTemplateMock.mockResolvedValue("wamid.header.1");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const r = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      headerVariable: "Valentina",
    });

    expect(r.kind).toBe("SUCCESS");
    expect(ycloudSendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ headerTextParam: "Valentina" })
    );
    // El body no tiene variables: no se inventa ningún parámetro para él.
    expect(ycloudSendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ bodyParams: [] })
    );
  });

  it("Graph: arma el componente header de TEXTO con el formato que Meta espera", async () => {
    getCredentialsByOrg.mockResolvedValue(credsGraph);
    isYcloudEnabled.mockReturnValue(false);
    selectQueue.push([PLANTILLA_DE_CAMILA], [conversationRow]);
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.header.2" }] });
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const r = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      headerVariable: "Valentina",
    });

    expect(r.kind).toBe("SUCCESS");
    const payload = graphRequest.mock.calls[0]![1] as {
      body: { template: { components: unknown[] } };
    };
    expect(payload.body.template.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "Valentina" }] },
    ]);
  });

  it("si falta el valor del encabezado, falla ANTES de llamar al proveedor — no se gasta un envío rechazado", async () => {
    selectQueue.push([PLANTILLA_DE_CAMILA], [conversationRow]);
    const { enviarTemplateAlProveedor, TemplateError } = await import(
      "@/server/whatsapp/templates"
    );

    const err = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(TemplateError);
    expect(String(err.message)).toMatch(/encabezado/i);
    expect(ycloudSendTemplateMock).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("REGRESIÓN: una plantilla sin variable en el encabezado sigue enviándose igual que siempre", async () => {
    const sinHeaderVariable = {
      ...PLANTILLA_DE_CAMILA,
      body: "Hola {{1}}, tu pedido está listo",
      components: { header: { type: "TEXT", text: "Novedades" }, footer: null },
    };
    selectQueue.push([sinHeaderVariable], [conversationRow]);
    ycloudSendTemplateMock.mockResolvedValue("wamid.normal.1");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const r = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
    });

    expect(r.kind).toBe("SUCCESS");
    expect(ycloudSendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ bodyParams: ["María"], headerTextParam: undefined })
    );
  });
});

describe("headerTextConVariable — la detección pura", () => {
  it("detecta el header de TEXTO con {{1}}", async () => {
    const { headerTextConVariable } = await import("@/server/whatsapp/template-validation");
    expect(
      headerTextConVariable({ header: { type: "TEXT", text: "{{1}} Estamos para ayudarte" }, footer: null })
    ).toBe("{{1}} Estamos para ayudarte");
  });

  it("un header de texto FIJO no pide ningún valor", async () => {
    const { headerTextConVariable } = await import("@/server/whatsapp/template-validation");
    expect(
      headerTextConVariable({ header: { type: "TEXT", text: "Novedades" }, footer: null })
    ).toBeNull();
  });

  it("un header de IMAGEN no se confunde con uno de texto", async () => {
    const { headerTextConVariable } = await import("@/server/whatsapp/template-validation");
    expect(
      headerTextConVariable({ header: { type: "IMAGE", mediaAssetId: "a1" }, footer: null })
    ).toBeNull();
  });

  it("sin components, no hay variable de encabezado", async () => {
    const { headerTextConVariable } = await import("@/server/whatsapp/template-validation");
    expect(headerTextConVariable(null)).toBeNull();
    expect(headerTextConVariable(undefined)).toBeNull();
  });
});
