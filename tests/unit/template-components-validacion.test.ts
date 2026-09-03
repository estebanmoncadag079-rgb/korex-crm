import { describe, expect, it, vi } from "vitest";

/**
 * Fase 9P — módulos 100% puros (sin DB, sin red): `validateComponents()`
 * (`template-validation.ts`), `mapTemplateToYCloudPayload()`
 * (`ycloud-templates.ts`, extendido para HEADER/FOOTER) y el payload que
 * arma `ycloudSendTemplate()` (`lib/ycloud/client.ts`) para el envío real de
 * una plantilla con HEADER IMAGE. Casos A-K de la sección 18 del prompt.
 */

import { validateComponents, type TemplateComponents } from "@/server/whatsapp/template-validation";
import { mapTemplateToYCloudPayload } from "@/server/whatsapp/ycloud-templates";

describe("validateComponents (puro, sin DB)", () => {
  it("A: sin components (undefined) → válido", () => {
    expect(validateComponents(undefined)).toBeNull();
  });

  it("A.2: components null → válido", () => {
    expect(validateComponents(null)).toBeNull();
  });

  it("B: header NONE, sin footer → válido", () => {
    const c: TemplateComponents = { header: { type: "NONE" }, footer: null };
    expect(validateComponents(c)).toBeNull();
  });

  it("C: header IMAGE con mediaAssetId no vacío → válido (la existencia real se valida en templates.ts)", () => {
    const c: TemplateComponents = { header: { type: "IMAGE", mediaAssetId: "asset_1" }, footer: null };
    expect(validateComponents(c)).toBeNull();
  });

  it("D: header IMAGE con mediaAssetId vacío → inválido", () => {
    const c: TemplateComponents = { header: { type: "IMAGE", mediaAssetId: "" }, footer: null };
    expect(validateComponents(c)).toMatch(/seleccionar un asset/);
  });

  it("D.2: header IMAGE con mediaAssetId solo espacios → inválido", () => {
    const c: TemplateComponents = { header: { type: "IMAGE", mediaAssetId: "   " }, footer: null };
    expect(validateComponents(c)).toMatch(/seleccionar un asset/);
  });

  it("E: header TEXT vacío → inválido", () => {
    const c: TemplateComponents = { header: { type: "TEXT", text: "" }, footer: null };
    expect(validateComponents(c)).toMatch(/no puede estar vacío/);
  });

  it("F: header TEXT de más de 60 caracteres → inválido", () => {
    const c: TemplateComponents = { header: { type: "TEXT", text: "x".repeat(61) }, footer: null };
    expect(validateComponents(c)).toMatch(/60 caracteres/);
  });

  it("F.2: header TEXT de exactamente 60 caracteres → válido", () => {
    const c: TemplateComponents = { header: { type: "TEXT", text: "x".repeat(60) }, footer: null };
    expect(validateComponents(c)).toBeNull();
  });

  it("G: tipo de header desconocido → inválido", () => {
    const c = { header: { type: "VIDEO" }, footer: null } as unknown as TemplateComponents;
    expect(validateComponents(c)).toMatch(/desconocido/);
  });

  it("H: footer con texto vacío (objeto presente pero sin contenido) → inválido", () => {
    const c: TemplateComponents = { header: { type: "NONE" }, footer: { text: "" } };
    expect(validateComponents(c)).toMatch(/footer no puede estar vacío/);
  });

  it("I: footer de más de 60 caracteres → inválido", () => {
    const c: TemplateComponents = { header: { type: "NONE" }, footer: { text: "x".repeat(61) } };
    expect(validateComponents(c)).toMatch(/60 caracteres/);
  });

  it("J: footer válido, sin header → válido", () => {
    const c: TemplateComponents = { header: { type: "NONE" }, footer: { text: "Korex.IA" } };
    expect(validateComponents(c)).toBeNull();
  });

  it("K: header IMAGE + footer, ambos válidos → válido", () => {
    const c: TemplateComponents = {
      header: { type: "IMAGE", mediaAssetId: "asset_1" },
      footer: { text: "Korex.IA" },
    };
    expect(validateComponents(c)).toBeNull();
  });
});

describe("mapTemplateToYCloudPayload: HEADER/FOOTER (Fase 9P)", () => {
  const BASE = { wabaId: "waba_1", name: "confirmacion", language: "es", category: "UTILITY", body: "Hola, gracias" };

  it("header IMAGE: agrega componente HEADER format=IMAGE con example.header_url, ANTES del BODY", () => {
    const payload = mapTemplateToYCloudPayload({
      ...BASE,
      header: { type: "IMAGE", url: "https://cdn.korex.ia/media/foto1.jpg" },
    });
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components[0]).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_url: ["https://cdn.korex.ia/media/foto1.jpg"] },
    });
    expect(components[1]!.type).toBe("BODY");
  });

  it("header TEXT: agrega componente HEADER format=TEXT con el texto tal cual", () => {
    const payload = mapTemplateToYCloudPayload({ ...BASE, header: { type: "TEXT", text: "Oferta especial" } });
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components[0]).toEqual({ type: "HEADER", format: "TEXT", text: "Oferta especial" });
  });

  it("footer: agrega componente FOOTER DESPUÉS del BODY", () => {
    const payload = mapTemplateToYCloudPayload({ ...BASE, footer: "Korex.IA" });
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components[components.length - 1]).toEqual({ type: "FOOTER", text: "Korex.IA" });
    expect(components[0]!.type).toBe("BODY");
  });

  it("header IMAGE + footer: orden HEADER → BODY → FOOTER", () => {
    const payload = mapTemplateToYCloudPayload({
      ...BASE,
      header: { type: "IMAGE", url: "https://cdn.korex.ia/media/foto1.jpg" },
      footer: "Korex.IA",
    });
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components.map((c) => c.type)).toEqual(["HEADER", "BODY", "FOOTER"]);
  });

  it("sin header ni footer: comportamiento histórico intacto — solo BODY (regresión)", () => {
    const payload = mapTemplateToYCloudPayload(BASE);
    const components = payload.components as Array<Record<string, unknown>>;
    expect(components).toHaveLength(1);
    expect(components[0]!.type).toBe("BODY");
  });

  it("plantilla existente sin components (korex_prueba_template_001, Fase 9Q): mismo payload de siempre, sin header/footer", () => {
    const payload = mapTemplateToYCloudPayload({ ...BASE, header: undefined, footer: undefined });
    expect(payload).toEqual({
      wabaId: "waba_1",
      name: "confirmacion",
      language: "es",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hola, gracias" }],
    });
  });
});

describe("ycloudSendTemplate: payload de ENVÍO con headerImageUrl (Fase 9P, sección 13/14 — CRITICAL)", () => {
  vi.mock("@/lib/env", () => ({
    getEnv: () => ({ YCLOUD_API_KEY: "test-key", YCLOUD_BASE_URL: "https://ycloud.test" }),
  }));

  function respuestaOk() {
    return { ok: true, status: 200, json: () => Promise.resolve({ id: "wamid.ok" }) } as Response;
  }

  it("con headerImageUrl: el payload incluye el componente header IMAGE, además del body — nunca lo reemplaza", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaOk());
    vi.stubGlobal("fetch", fetchMock);
    const { ycloudSendTemplate } = await import("@/lib/ycloud/client");

    await ycloudSendTemplate({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      name: "confirmacion",
      language: "es",
      bodyParams: ["María"],
      headerImageUrl: "https://cdn.korex.ia/media/foto1.jpg",
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(opts.body as string);
    expect(payload.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.korex.ia/media/foto1.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "María" }] },
    ]);
    // Nunca dos componentes de header, nunca un segundo POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("sin headerImageUrl: el payload NO incluye componente header — regresión, comportamiento histórico intacto", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaOk());
    vi.stubGlobal("fetch", fetchMock);
    const { ycloudSendTemplate } = await import("@/lib/ycloud/client");

    await ycloudSendTemplate({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      name: "confirmacion",
      language: "es",
      bodyParams: ["María"],
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(opts.body as string);
    expect(payload.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "María" }] },
    ]);
    vi.unstubAllGlobals();
  });

  it("headerImageUrl sin bodyParams (body sin variable): solo el componente header, sin componente body vacío", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaOk());
    vi.stubGlobal("fetch", fetchMock);
    const { ycloudSendTemplate } = await import("@/lib/ycloud/client");

    await ycloudSendTemplate({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      name: "promocion",
      language: "es",
      bodyParams: [],
      headerImageUrl: "https://cdn.korex.ia/media/foto1.jpg",
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(opts.body as string);
    expect(payload.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.korex.ia/media/foto1.jpg" } }] },
    ]);
    vi.unstubAllGlobals();
  });
});
