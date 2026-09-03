import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9P, sección 11 — `congelarTemplateSnapshot()` (motor.ts) incluye
 * `components` en el snapshot congelado. Inmutabilidad frente a ediciones
 * posteriores del template vivo se verifica a nivel `templates.ts` (en
 * `header-imagen-aprobacion-envio.test.ts`); aquí solo se confirma que el
 * snapshot SE CONGELA con el header correcto.
 *
 * `procesarUnEnvioDeCampana()` propagando `templateSnapshot.components` al
 * proveedor vive en `header-imagen-worker-envio.test.ts` — archivo aparte
 * porque ese test necesita MOCKEAR `@/server/campaigns/motor`, lo que
 * chocaría con la versión REAL que este archivo necesita importar.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

const selectQueue: Fila[][] = [];
const updateSetSpy = vi.fn();

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
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
  selectQueue.length = 0;
  updateSetSpy.mockReset();
});

const campanaBase = { id: "cmp_1", organizationId: "org_1", templateId: "tpl_1", status: "draft" };

describe("congelarTemplateSnapshot: incluye header IMAGE (motor.ts)", () => {
  it("plantilla aprobada CON header IMAGE: el snapshot congelado incluye components tal cual", async () => {
    const componentsConImagen = { header: { type: "IMAGE", mediaAssetId: "asset_1" }, footer: { text: "Korex.IA" } };
    selectQueue.push([campanaBase]); // leerCampana
    selectQueue.push([
      {
        id: "tpl_1",
        name: "promo_imagen",
        language: "es",
        category: "MARKETING",
        body: "Aprovecha {{1}}",
        status: "approved",
        components: componentsConImagen,
      },
    ]);
    const { congelarTemplateSnapshot } = await import("@/server/campaigns/motor");

    await congelarTemplateSnapshot("org_1", "cmp_1");
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        templateSnapshot: expect.objectContaining({ components: componentsConImagen }),
      })
    );
  });

  it("plantilla aprobada SIN components: el snapshot congela components=undefined — regresión, sin romper campañas existentes", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([
      { id: "tpl_1", name: "seguimiento", language: "es", category: "MARKETING", body: "Hola {{1}}", status: "approved", components: null },
    ]);
    const { congelarTemplateSnapshot } = await import("@/server/campaigns/motor");

    await congelarTemplateSnapshot("org_1", "cmp_1");
    const setArg = updateSetSpy.mock.calls[0]![0] as { templateSnapshot: Record<string, unknown> };
    expect(setArg.templateSnapshot.components).toBeUndefined();
  });
});
