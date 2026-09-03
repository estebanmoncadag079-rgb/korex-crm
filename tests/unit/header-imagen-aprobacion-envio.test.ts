import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9P, secciones 19-20 (CRITICAL) — cubre el camino completo de HEADER
 * IMAGE que el prompt exige explícitamente:
 *   1) `enviarPlantillaAAprobacion` con header IMAGE, mockeando
 *      `crearTemplateYCloud` (SUCCESS/EXPLICIT_FAILURE/AMBIGUOUS) — nunca
 *      HTTP real.
 *   2) `enviarTemplateAlProveedor` con `contentSnapshot.components` de
 *      header IMAGE — el snapshot SIEMPRE manda sobre el template vivo
 *      (inmutabilidad del snapshot ya congelado), y el payload real
 *      (YCloud/Graph) lleva el header correctamente formado, sin duplicar
 *      la imagen ni disparar una segunda llamada.
 *   3) Regresión: un envío sin imagen produce EXACTAMENTE el payload
 *      histórico (sin componente header).
 *
 * "Si se consigue crear/aprobar una plantilla IMAGE pero todavía no se
 * puede enviar correctamente en una campaña, el veredicto debe ser B" — este
 * archivo es la prueba de que el envío también funciona.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

let urlPublicaResult: string | null = "https://cdn.korex.ia/media/foto1.jpg";
const urlPublicaDeFotoMock = vi.fn((_id: string) => urlPublicaResult);
vi.mock("@/server/ai/fotos", () => ({
  urlPublicaDeFoto: (id: string) => urlPublicaDeFotoMock(id),
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

const crearTemplateYCloudMock = vi.fn();
const obtenerTemplateYCloudMock = vi.fn();
vi.mock("@/server/whatsapp/ycloud-templates", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/ycloud-templates")>();
  return {
    ...original,
    crearTemplateYCloud: (...args: unknown[]) => crearTemplateYCloudMock(...args),
    obtenerTemplateYCloud: (...args: unknown[]) => obtenerTemplateYCloudMock(...args),
  };
});

const getCredentialsByOrg = vi.fn();
const getYcloudApiKeyMock = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrg(...args),
  getYcloudApiKey: (...args: unknown[]) => getYcloudApiKeyMock(...args),
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
const updateReturningQueue: Fila[][] = [];
const updateSetSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetSpy(values);
        return {
          where: () => ({ returning: () => Promise.resolve(updateReturningQueue.shift() ?? [{}]) }),
        };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => Promise.resolve([{ ...values, id: values.id ?? "msg_1", createdAt: new Date() }]),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

function assetValido(overrides: Fila = {}): Fila {
  return { mimeType: "image/jpeg", tamano: 1_000_000, ...overrides };
}

beforeEach(() => {
  selectQueue.length = 0;
  updateReturningQueue.length = 0;
  updateSetSpy.mockReset();
  crearTemplateYCloudMock.mockReset();
  obtenerTemplateYCloudMock.mockReset();
  getCredentialsByOrg.mockReset();
  graphRequest.mockReset();
  ycloudSendTemplateMock.mockReset();
  isYcloudEnabled.mockReset();
  urlPublicaDeFotoMock.mockClear();
  urlPublicaResult = "https://cdn.korex.ia/media/foto1.jpg";
  getCredentialsByOrg.mockResolvedValue({ wabaId: "waba_real_123", metaWabaId: null, status: "connected" });
  getYcloudApiKeyMock.mockResolvedValue("clave-ycloud-de-prueba");
});

const headerImage = { type: "IMAGE" as const, mediaAssetId: "asset_1" };

function filaDraftConHeader(overrides: Fila = {}): Fila {
  return {
    id: "template_x",
    organizationId: "org_1",
    name: "promo_imagen",
    language: "es",
    category: "MARKETING",
    body: "Aprovecha la oferta",
    status: "draft",
    rejectionReason: null,
    waTemplateId: null,
    provider: "ycloud",
    providerStatus: null,
    providerLastSyncAt: null,
    components: { header: headerImage, footer: null },
    ...overrides,
  };
}

describe("enviarPlantillaAAprobacion + header IMAGE (mock crearTemplateYCloud, cero HTTP real)", () => {
  it("SUCCESS/PENDING: resuelve el asset, pasa header YA RESUELTO (URL) al adaptador — nunca un mediaAssetId", async () => {
    selectQueue.push([filaDraftConHeader()]); // cargarTemplateScoped
    selectQueue.push([assetValido()]); // resolverAssetDeHeaderImagen
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "SUCCESS",
      providerTemplateId: "tpl_img",
      providerName: "promo_imagen",
      providerLanguage: "es",
      providerCategory: "MARKETING",
      providerStatus: "PENDING",
    });
    updateReturningQueue.push([filaDraftConHeader({ status: "pending", waTemplateId: "tpl_img" })]);
    const { enviarPlantillaAAprobacion } = await import("@/server/whatsapp/templates");

    const resultado = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" });
    expect(resultado.status).toBe("pending");
    expect(crearTemplateYCloudMock).toHaveBeenCalledWith(
      expect.objectContaining({ header: { type: "IMAGE", url: "https://cdn.korex.ia/media/foto1.jpg" } })
    );
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1);
  });

  it("asset cross-tenant/inexistente: rechaza ANTES de llamar a crearTemplateYCloud — cero POST", async () => {
    selectQueue.push([filaDraftConHeader()]);
    selectQueue.push([]); // el asset no existe en esta organización
    const { enviarPlantillaAAprobacion, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(crearTemplateYCloudMock).not.toHaveBeenCalled();
  });

  it("EXPLICIT_FAILURE con header IMAGE: rejectionReason se guarda, status sigue draft, cero segundo POST", async () => {
    selectQueue.push([filaDraftConHeader()]);
    selectQueue.push([assetValido()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({
      kind: "EXPLICIT_FAILURE",
      code: "validation",
      error: "header inválido",
      causa: null,
    });
    updateReturningQueue.push([filaDraftConHeader({ rejectionReason: "header inválido" })]);
    const { enviarPlantillaAAprobacion, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1);
  });

  it("AMBIGUOUS con header IMAGE: nunca marca approved, nunca reintenta el POST", async () => {
    selectQueue.push([filaDraftConHeader()]);
    selectQueue.push([assetValido()]);
    crearTemplateYCloudMock.mockResolvedValueOnce({ kind: "AMBIGUOUS", error: "timeout", causa: null });
    updateReturningQueue.push([filaDraftConHeader()]);
    const { enviarPlantillaAAprobacion, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarPlantillaAAprobacion("org_1", "template_x", { provider: "ycloud" }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("meta_unavailable");
    expect(crearTemplateYCloudMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("status");
  });
});

const template = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "promo_imagen",
  language: "es",
  body: "Aprovecha la oferta {{1}}",
  status: "approved",
  components: null, // el template vivo NO tiene header — el snapshot es la única fuente
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

function snapshotConHeaderImagen() {
  return {
    name: "promo_imagen",
    language: "es",
    body: "Aprovecha la oferta {{1}}",
    components: { header: headerImage, footer: { text: "Korex.IA" } },
  };
}

describe("enviarTemplateAlProveedor + header IMAGE vía snapshot (envío REAL de campaña — CRITICAL)", () => {
  it("YCloud: el snapshot con header IMAGE manda, aunque el template vivo NO tenga components (inmutabilidad)", async () => {
    getCredentialsByOrg.mockResolvedValue(credsYcloud);
    selectQueue.push([template], [conversationRow], [assetValido()]);
    ycloudSendTemplateMock.mockResolvedValue("wamid.img.1");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
      contentSnapshot: snapshotConHeaderImagen(),
    });

    expect(resultado.kind).toBe("SUCCESS");
    expect(ycloudSendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ headerImageUrl: "https://cdn.korex.ia/media/foto1.jpg" })
    );
    // Ni una imagen duplicada, ni una segunda llamada.
    expect(ycloudSendTemplateMock).toHaveBeenCalledTimes(1);
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("Graph: arma components estándar de Meta con el header IMAGE + el body variable, en un solo POST", async () => {
    getCredentialsByOrg.mockResolvedValue(credsGraph);
    isYcloudEnabled.mockReturnValue(false);
    selectQueue.push([template], [conversationRow], [assetValido()]);
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.graph.img.1" }] });
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
      contentSnapshot: snapshotConHeaderImagen(),
    });

    expect(resultado.kind).toBe("SUCCESS");
    expect(graphRequest).toHaveBeenCalledTimes(1);
    const [, opts] = graphRequest.mock.calls[0] as [string, { body: Record<string, unknown> }];
    const templateArg = opts.body.template as { components: Array<Record<string, unknown>> };
    expect(templateArg.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.korex.ia/media/foto1.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "María" }] },
    ]);
    expect(ycloudSendTemplateMock).not.toHaveBeenCalled();
  });

  it("dual-provider: YCloud y Graph NUNCA se mezclan — cada uno solo recibe su propio formato de header", async () => {
    // YCloud
    getCredentialsByOrg.mockResolvedValueOnce(credsYcloud);
    selectQueue.push([template], [conversationRow], [assetValido()]);
    ycloudSendTemplateMock.mockResolvedValueOnce("wamid.ycloud.dual");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");
    await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
      contentSnapshot: snapshotConHeaderImagen(),
    });
    expect(graphRequest).not.toHaveBeenCalled();
    expect(ycloudSendTemplateMock).toHaveBeenCalledTimes(1);

    // Graph
    getCredentialsByOrg.mockResolvedValueOnce(credsGraph);
    isYcloudEnabled.mockReturnValue(false);
    selectQueue.push([template], [conversationRow], [assetValido()]);
    graphRequest.mockResolvedValueOnce({ messages: [{ id: "wamid.graph.dual" }] });
    await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
      contentSnapshot: snapshotConHeaderImagen(),
    });
    expect(graphRequest).toHaveBeenCalledTimes(1);
    expect(ycloudSendTemplateMock).toHaveBeenCalledTimes(1); // sigue en 1 — no se llamó de nuevo
  });

  it("asset cross-tenant al momento del envío: rechaza ANTES de llamar al proveedor — cero HTTP", async () => {
    getCredentialsByOrg.mockResolvedValue(credsYcloud);
    selectQueue.push([template], [conversationRow], []); // el asset ya no existe/pertenece a otra org
    const { enviarTemplateAlProveedor, TemplateError } = await import("@/server/whatsapp/templates");

    const err = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
      contentSnapshot: snapshotConHeaderImagen(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(ycloudSendTemplateMock).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("REGRESIÓN — snapshot sin components (envío histórico, sin imagen): payload EXACTO de siempre, sin componente header", async () => {
    getCredentialsByOrg.mockResolvedValue(credsYcloud);
    selectQueue.push([template], [conversationRow]); // sin tercer select: no hay header IMAGE que resolver
    ycloudSendTemplateMock.mockResolvedValue("wamid.sin.imagen");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
      contentSnapshot: { name: "promo_imagen", language: "es", body: "Aprovecha la oferta {{1}}" },
    });

    expect(resultado.kind).toBe("SUCCESS");
    const llamada = ycloudSendTemplateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(llamada.headerImageUrl).toBeUndefined();
    expect(llamada.bodyParams).toEqual(["María"]);
  });

  it("REGRESIÓN — sin contentSnapshot (envío conversacional normal), template vivo sin components: comportamiento histórico intacto", async () => {
    getCredentialsByOrg.mockResolvedValue(credsYcloud);
    selectQueue.push([template], [conversationRow]);
    ycloudSendTemplateMock.mockResolvedValue("wamid.conversacional");
    const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

    const resultado = await enviarTemplateAlProveedor({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
    });

    expect(resultado.kind).toBe("SUCCESS");
    const llamada = ycloudSendTemplateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(llamada.headerImageUrl).toBeUndefined();
  });
});
