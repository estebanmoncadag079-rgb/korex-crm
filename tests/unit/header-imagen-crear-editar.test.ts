import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9P — `crearBorradorDePlantilla`/`editarBorradorDePlantilla` con
 * `components.header.type === "IMAGE"`: validan que el asset pertenezca a la
 * MISMA organización (`scoped`), tenga mime jpg/png, pese ≤5MB, y tenga URL
 * pública — todo ANTES de cualquier INSERT/UPDATE. Mismo patrón de mock que
 * `crear-borrador-plantilla.test.ts` (Fase 9B), extendido con un segundo
 * select para `mediaAsset`.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

let contadorId = 0;
vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_fake${++contadorId}`,
}));

const graphRequest = vi.fn(() => {
  throw new Error("PROHIBIDO: llamó a graphRequest() (Meta)");
});
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const ycloudSendTemplate = vi.fn(() => {
  throw new Error("PROHIBIDO: llamó a ycloudSendTemplate() (YCloud, envío)");
});
vi.mock("@/lib/ycloud/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ycloud/client")>();
  return { ...original, ycloudSendTemplate };
});

const fetchMock = vi.fn(() => {
  throw new Error("PROHIBIDO: disparó un fetch() real");
});
vi.stubGlobal("fetch", fetchMock);

let urlPublicaResult: string | null = "https://cdn.korex.ia/media/foto1.jpg";
const urlPublicaDeFotoMock = vi.fn((_id: string) => urlPublicaResult);
vi.mock("@/server/ai/fotos", () => ({
  urlPublicaDeFoto: (id: string) => urlPublicaDeFotoMock(id),
}));

const insertReturningQueue: Fila[][] = [];
const updateReturningQueue: Fila[][] = [];
const selectQueue: Fila[][] = [];
const insertSpy = vi.fn();
const valuesSpy = vi.fn();
const updateSetSpy = vi.fn();

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
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetSpy(values);
        return {
          where: () => ({
            returning: () => Promise.resolve(updateReturningQueue.shift() ?? [{}]),
          }),
        };
      },
    }),
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
  updateReturningQueue.length = 0;
  selectQueue.length = 0;
  insertSpy.mockReset();
  valuesSpy.mockReset();
  updateSetSpy.mockReset();
  graphRequest.mockClear();
  ycloudSendTemplate.mockClear();
  fetchMock.mockClear();
  urlPublicaDeFotoMock.mockClear();
  urlPublicaResult = "https://cdn.korex.ia/media/foto1.jpg";
});

const inputBase = { name: "promo_imagen", language: "es", category: "MARKETING", body: "Aprovecha la oferta" };

function assetValido(overrides: Fila = {}): Fila {
  return { mimeType: "image/jpeg", tamano: 1_000_000, ...overrides };
}

describe("crearBorradorDePlantilla + header IMAGE", () => {
  it("sin components: comportamiento histórico, sin select adicional de mediaAsset", async () => {
    insertReturningQueue.push([{ id: "template_fake1", status: "draft" }]);
    const { crearBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    await crearBorradorDePlantilla("org_1", inputBase);
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ components: null }));
    expect(urlPublicaDeFotoMock).not.toHaveBeenCalled();
  });

  it("header NONE explícito: guarda components tal cual, sin validar ningún asset", async () => {
    insertReturningQueue.push([{ id: "template_fake1", status: "draft" }]);
    const { crearBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    await crearBorradorDePlantilla("org_1", { ...inputBase, components: { header: { type: "NONE" }, footer: null } });
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ components: { header: { type: "NONE" }, footer: null } })
    );
    expect(urlPublicaDeFotoMock).not.toHaveBeenCalled();
  });

  it("header IMAGE con asset válido de la MISMA organización: crea el borrador con components guardado", async () => {
    selectQueue.push([assetValido()]); // resolverAssetDeHeaderImagen
    insertReturningQueue.push([{ id: "template_fake1", status: "draft" }]);
    const { crearBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_1" }, footer: null };
    await crearBorradorDePlantilla("org_1", { ...inputBase, components });
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ components }));
    expect(graphRequest).not.toHaveBeenCalled();
    expect(ycloudSendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("header IMAGE con asset INEXISTENTE (o de otra organización — scoped no lo encuentra): rechaza, cero INSERT", async () => {
    selectQueue.push([]); // scoped no encuentra el asset
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_ajeno" }, footer: null };
    const err = await crearBorradorDePlantilla("org_1", { ...inputBase, components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.code).toBe("invalid");
    expect(err.message).toMatch(/no existe en esta organización/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("header IMAGE con mime no soportado (webp): rechaza, cero INSERT", async () => {
    selectQueue.push([assetValido({ mimeType: "image/webp" })]);
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_1" }, footer: null };
    const err = await crearBorradorDePlantilla("org_1", { ...inputBase, components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.message).toMatch(/JPG o PNG/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("header IMAGE con archivo > 5MB: rechaza, cero INSERT", async () => {
    selectQueue.push([assetValido({ tamano: 6_000_000 })]);
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_1" }, footer: null };
    const err = await crearBorradorDePlantilla("org_1", { ...inputBase, components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.message).toMatch(/5 MB/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("header IMAGE sin URL pública disponible (PUBLIC_MEDIA_BASE_URL no configurada): rechaza, cero INSERT", async () => {
    selectQueue.push([assetValido()]);
    urlPublicaResult = null;
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_1" }, footer: null };
    const err = await crearBorradorDePlantilla("org_1", { ...inputBase, components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.message).toMatch(/URL pública/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("footer inválido (>60 caracteres): rechaza, cero INSERT, cero select de mediaAsset", async () => {
    const { crearBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "NONE" as const }, footer: { text: "x".repeat(61) } };
    const err = await crearBorradorDePlantilla("org_1", { ...inputBase, components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(urlPublicaDeFotoMock).not.toHaveBeenCalled();
  });
});

describe("editarBorradorDePlantilla + header IMAGE", () => {
  function filaDraft(overrides: Fila = {}): Fila {
    return {
      id: "template_x",
      organizationId: "org_1",
      name: "promo_imagen",
      language: "es",
      category: "MARKETING",
      body: "Aprovecha la oferta",
      status: "draft",
      components: null,
      ...overrides,
    };
  }

  it("agrega un header IMAGE a una plantilla que antes no tenía components", async () => {
    selectQueue.push([filaDraft()]); // cargarTemplateScoped
    selectQueue.push([assetValido()]); // resolverAssetDeHeaderImagen
    updateReturningQueue.push([filaDraft()]);
    const { editarBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_1" }, footer: null };
    await editarBorradorDePlantilla("org_1", "template_x", { components });
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ components }));
  });

  it("`components` no enviado (undefined): conserva el header/footer que ya tenía la fila", async () => {
    const yaExiste = { header: { type: "IMAGE" as const, mediaAssetId: "asset_previo" }, footer: null };
    selectQueue.push([filaDraft({ components: yaExiste })]);
    selectQueue.push([assetValido()]); // sigue validando el asset ya guardado
    updateReturningQueue.push([filaDraft({ components: yaExiste })]);
    const { editarBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    await editarBorradorDePlantilla("org_1", "template_x", { name: "promo_imagen_2" });
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ components: yaExiste }));
  });

  it("`components: null` explícito: quita el header/footer existente, sin validar ningún asset", async () => {
    const yaExiste = { header: { type: "IMAGE" as const, mediaAssetId: "asset_previo" }, footer: null };
    selectQueue.push([filaDraft({ components: yaExiste })]);
    updateReturningQueue.push([filaDraft({ components: null })]);
    const { editarBorradorDePlantilla } = await import("@/server/whatsapp/templates");

    await editarBorradorDePlantilla("org_1", "template_x", { components: null });
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ components: null }));
    expect(urlPublicaDeFotoMock).not.toHaveBeenCalled();
  });

  it("cross-tenant: asset de otra organización (scoped no lo encuentra) → rechaza, cero UPDATE", async () => {
    selectQueue.push([filaDraft()]);
    selectQueue.push([]); // scoped no encuentra el asset en esta organización
    const { editarBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_de_otra_org" }, footer: null };
    const err = await editarBorradorDePlantilla("org_1", "template_x", { components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("plantilla ya no está en draft (approved): rechaza antes de tocar components/assets", async () => {
    selectQueue.push([filaDraft({ status: "approved" })]);
    const { editarBorradorDePlantilla, TemplateError } = await import("@/server/whatsapp/templates");

    const components = { header: { type: "IMAGE" as const, mediaAssetId: "asset_1" }, footer: null };
    const err = await editarBorradorDePlantilla("org_1", "template_x", { components }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(urlPublicaDeFotoMock).not.toHaveBeenCalled();
  });
});
