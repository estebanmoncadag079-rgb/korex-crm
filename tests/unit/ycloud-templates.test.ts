import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Fase 9D: adaptador server-side de GESTIÓN de plantillas contra YCloud
 * (`crearTemplateYCloud`/`obtenerTemplateYCloud`/`listarTemplatesYCloud`).
 * Todo mockeado — CERO llamadas HTTP reales, cero red.
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    YCLOUD_API_KEY: "test-key",
    YCLOUD_BASE_URL: "https://ycloud.test",
  }),
}));

import {
  crearTemplateYCloud,
  obtenerTemplateYCloud,
  listarTemplatesYCloud,
  mapTemplateToYCloudPayload,
  mapYCloudTemplateToKorex,
} from "@/server/whatsapp/ycloud-templates";

function respuesta(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function respuestaCreacionOk(overrides: Record<string, unknown> = {}) {
  return respuesta(200, {
    officialTemplateId: "tpl_abc123",
    wabaId: "waba_1",
    name: "confirmacion",
    language: "es",
    category: "UTILITY",
    status: "PENDING",
    createTime: "2026-09-01T00:00:00Z",
    updateTime: "2026-09-01T00:00:00Z",
    components: [],
    ...overrides,
  });
}

const INPUT_BASE = {
  apiKey: "clave-secreta-super-privada",
  wabaId: "waba_1",
  name: "confirmacion",
  language: "es",
  category: "UTILITY",
  body: "Hola, gracias por tu compra",
};

describe("crearTemplateYCloud", () => {
  // A: éxito simple, sin variable
  it("A: 200 con officialTemplateId → SUCCESS con los campos mapeados", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaCreacionOk());
    vi.stubGlobal("fetch", fetchMock);

    const r = await crearTemplateYCloud(INPUT_BASE);

    expect(r.kind).toBe("SUCCESS");
    if (r.kind === "SUCCESS") {
      expect(r.providerTemplateId).toBe("tpl_abc123");
      expect(r.providerName).toBe("confirmacion");
      expect(r.providerLanguage).toBe("es");
      expect(r.providerCategory).toBe("UTILITY");
      expect(r.providerStatus).toBe("PENDING");
    }
    vi.unstubAllGlobals();
  });

  // B: body sin variable → payload sin `example`
  it("B: body sin {{1}} → el payload no incluye example.body_text", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaCreacionOk());
    vi.stubGlobal("fetch", fetchMock);

    await crearTemplateYCloud(INPUT_BASE);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(opts.body as string);
    expect(payload.components[0].example).toBeUndefined();
    vi.unstubAllGlobals();
  });

  // C: {{1}} sin variableExample → EXPLICIT_FAILURE validation, CERO fetch
  it("C: {{1}} en el body sin variableExample → EXPLICIT_FAILURE validation sin llamar a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await crearTemplateYCloud({ ...INPUT_BASE, body: "Hola {{1}}, gracias" });

    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("validation");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // D: {{1}} con variableExample → payload con example.body_text [[valor]]
  it("D: {{1}} con variableExample → payload incluye example.body_text como array de arrays", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaCreacionOk());
    vi.stubGlobal("fetch", fetchMock);

    await crearTemplateYCloud({
      ...INPUT_BASE,
      body: "Hola {{1}}, gracias",
      variableExample: "Juan",
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(opts.body as string);
    expect(payload.components[0].example.body_text).toEqual([["Juan"]]);
    vi.unstubAllGlobals();
  });

  // E/F: 401/403 → authentication
  it("E: 401 → EXPLICIT_FAILURE authentication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(401, { message: "no autorizado" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("authentication");
    vi.unstubAllGlobals();
  });

  it("F: 403 → EXPLICIT_FAILURE authentication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(403, { message: "prohibido" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("authentication");
    vi.unstubAllGlobals();
  });

  // G: 404 → not_found
  it("G: 404 → EXPLICIT_FAILURE not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(404, { message: "no existe el waba" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("not_found");
    vi.unstubAllGlobals();
  });

  // H: 409 → conflict
  it("H: 409 (nombre ya existe en YCloud) → EXPLICIT_FAILURE conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(409, { message: "ya existe" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("conflict");
    vi.unstubAllGlobals();
  });

  // I: 429 → rate_limited
  it("I: 429 → EXPLICIT_FAILURE rate_limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(429, { message: "demasiadas solicitudes" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("rate_limited");
    vi.unstubAllGlobals();
  });

  // J: 400 genérico → validation
  it("J: 400 con mensaje de contenido inválido → EXPLICIT_FAILURE validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(respuesta(400, { message: "Param components[0] is not valid" }))
    );
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") {
      expect(r.code).toBe("validation");
      expect(r.error).toMatch(/not valid/);
    }
    vi.unstubAllGlobals();
  });

  // K: 500 → AMBIGUOUS (pudo haber creado del lado del proveedor)
  it("K: 500 → AMBIGUOUS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(500, { message: "error interno" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  // L: fallo de red → AMBIGUOUS, nunca EXPLICIT_FAILURE
  it("L: fetch rechaza por red (ECONNRESET) → AMBIGUOUS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  // M: timeout (AbortError) → AMBIGUOUS
  it("M: fetch rechaza por AbortError (timeout) → AMBIGUOUS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"))
    );
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  // N: 2xx sin officialTemplateId → AMBIGUOUS (respuesta con forma inesperada)
  it("N: 200 sin officialTemplateId en el body → AMBIGUOUS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, { name: "confirmacion" })));
    const r = await crearTemplateYCloud(INPUT_BASE);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  // Especial: anti-doble-creación — timeout/network nunca dispara un segundo intento
  it("ESPECIAL — timeout/network: fetchCalls === 1, nunca 2 (sin retry automático)", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await crearTemplateYCloud(INPUT_BASE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  // Especial: payload exacto capturado del fetch mock
  it("ESPECIAL — el body enviado a fetch es exactamente el payload mapeado", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaCreacionOk());
    vi.stubGlobal("fetch", fetchMock);

    await crearTemplateYCloud({
      ...INPUT_BASE,
      body: "Hola {{1}}, tu pedido está listo",
      variableExample: "María",
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(opts.body as string);
    expect(payload).toEqual({
      wabaId: "waba_1",
      name: "confirmacion",
      language: "es",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Hola {{1}}, tu pedido está listo",
          example: { body_text: [["María"]] },
        },
      ],
    });
    vi.unstubAllGlobals();
  });

  // Especial: la API key nunca viaja en Authorization, solo en X-API-Key, y nunca aparece en el error
  it("ESPECIAL — la API key va en X-API-Key, nunca en Authorization ni en el error devuelto", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuesta(401, { message: "no autorizado" }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await crearTemplateYCloud(INPUT_BASE);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(INPUT_BASE.apiKey);
    expect(headers["Authorization"]).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain(INPUT_BASE.apiKey);
    vi.unstubAllGlobals();
  });
});

describe("crearTemplateYCloud: validación local de variables (Fase 9F)", () => {
  // Antes solo se rechazaba "{{1}} sin variableExample"; {{2}} sola, {{3}},
  // o 2+ variables pasaban sin validar localmente (Hallazgo #2 de la
  // auditoría 9E). Ahora validateBodyVariables() las rechaza ANTES de
  // llamar a fetch — providerCalls === 0 en todos los casos inválidos.
  const CASOS_INVALIDOS: Array<{ nombre: string; body: string }> = [
    { nombre: "{{2}} sin {{1}}", body: "Hola {{2}}, gracias" },
    { nombre: "{{3}}", body: "Hola {{3}}, gracias" },
    { nombre: "{{1}} + {{2}}", body: "Hola {{1}}, tu código es {{2}}" },
    { nombre: "más de una variable ({{1}} repetida)", body: "Hola {{1}}, {{1}} de nuevo" },
  ];

  it.each(CASOS_INVALIDOS)(
    "$nombre: rechazo local, EXPLICIT_FAILURE validation, cero llamadas a fetch",
    async ({ body }) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const r = await crearTemplateYCloud({ ...INPUT_BASE, body, variableExample: "x" });

      expect(r.kind).toBe("EXPLICIT_FAILURE");
      if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("validation");
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  );

  it("0 variables: pasa la validación local y sí llega a fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaCreacionOk());
    vi.stubGlobal("fetch", fetchMock);

    const r = await crearTemplateYCloud({ ...INPUT_BASE, body: "Hola, gracias" });

    expect(r.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("{{1}} válido con variableExample: pasa la validación local y llega a fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaCreacionOk());
    vi.stubGlobal("fetch", fetchMock);

    const r = await crearTemplateYCloud({ ...INPUT_BASE, body: "Hola {{1}}", variableExample: "Juan" });

    expect(r.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("obtenerTemplateYCloud", () => {
  // O: éxito
  it("O: 200 con una plantilla → SUCCESS con el estado crudo preservado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        respuesta(200, {
          officialTemplateId: "tpl_1",
          name: "confirmacion",
          language: "es",
          category: "UTILITY",
          status: "APPROVED",
        })
      )
    );
    const r = await obtenerTemplateYCloud({ apiKey: "k", wabaId: "waba_1", name: "confirmacion", language: "es" });
    expect(r.kind).toBe("SUCCESS");
    if (r.kind === "SUCCESS") expect(r.template.providerStatus).toBe("APPROVED");
    vi.unstubAllGlobals();
  });

  // P: 404 → NOT_FOUND (no EXPLICIT_FAILURE — es un caso esperado, no un error)
  it("P: 404 → NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(404, { message: "no existe" })));
    const r = await obtenerTemplateYCloud({ apiKey: "k", wabaId: "waba_1", name: "x", language: "es" });
    expect(r.kind).toBe("NOT_FOUND");
    vi.unstubAllGlobals();
  });

  it("Q: 500 → AMBIGUOUS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(500, { message: "error interno" })));
    const r = await obtenerTemplateYCloud({ apiKey: "k", wabaId: "waba_1", name: "x", language: "es" });
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });
});

describe("obtenerTemplateYCloud: bloqueador principal — 2xx malformado nunca es SUCCESS (Fase 9F)", () => {
  const ARGS = { apiKey: "k", wabaId: "waba_1", name: "confirmacion", language: "es" };

  it("A: 200 con estructura completa → SUCCESS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        respuesta(200, {
          officialTemplateId: "tpl_1",
          name: "confirmacion",
          language: "es",
          category: "UTILITY",
          status: "APPROVED",
        })
      )
    );
    const r = await obtenerTemplateYCloud(ARGS);
    expect(r.kind).toBe("SUCCESS");
    vi.unstubAllGlobals();
  });

  it("B: 200 con {} → AMBIGUOUS, nunca SUCCESS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, {})));
    const r = await obtenerTemplateYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  it("C: 200 con null → AMBIGUOUS, nunca SUCCESS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, null)));
    const r = await obtenerTemplateYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  it("D: 200 sin officialTemplateId → AMBIGUOUS, nunca SUCCESS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(respuesta(200, { name: "confirmacion", language: "es" }))
    );
    const r = await obtenerTemplateYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  it("E: 200 con officialTemplateId vacío (string vacío) → AMBIGUOUS, nunca SUCCESS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        respuesta(200, { officialTemplateId: "", name: "confirmacion", language: "es" })
      )
    );
    const r = await obtenerTemplateYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  it("F: 200 con estructura incompleta (falta name/language) → AMBIGUOUS, nunca SUCCESS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, { officialTemplateId: "tpl_1" })));
    const r = await obtenerTemplateYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });
});

describe("listarTemplatesYCloud", () => {
  it("R: 200 con data[] → SUCCESS con la lista mapeada, preservando cada status crudo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        respuesta(200, {
          data: [
            { officialTemplateId: "tpl_1", name: "a", language: "es", category: "UTILITY", status: "PENDING" },
            { officialTemplateId: "tpl_2", name: "b", language: "es", category: "MARKETING", status: "REJECTED" },
          ],
        })
      )
    );
    const r = await listarTemplatesYCloud({ apiKey: "k", wabaId: "waba_1" });
    expect(r.kind).toBe("SUCCESS");
    if (r.kind === "SUCCESS") {
      expect(r.templates).toHaveLength(2);
      expect(r.templates[0]!.providerStatus).toBe("PENDING");
      expect(r.templates[1]!.providerStatus).toBe("REJECTED");
    }
    vi.unstubAllGlobals();
  });

  it("S: 401 → EXPLICIT_FAILURE authentication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(401, { message: "no autorizado" })));
    const r = await listarTemplatesYCloud({ apiKey: "k", wabaId: "waba_1" });
    expect(r.kind).toBe("EXPLICIT_FAILURE");
    if (r.kind === "EXPLICIT_FAILURE") expect(r.code).toBe("authentication");
    vi.unstubAllGlobals();
  });
});

describe("listarTemplatesYCloud: 2xx malformado nunca es 'lista vacía' silenciosa (Fase 9F)", () => {
  const ARGS = { apiKey: "k", wabaId: "waba_1" };

  it("lista válida vacía (data: []) → SUCCESS templates=[], NO es un error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, { data: [] })));
    const r = await listarTemplatesYCloud(ARGS);
    expect(r.kind).toBe("SUCCESS");
    if (r.kind === "SUCCESS") expect(r.templates).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("200 con {} (sin la clave data) → AMBIGUOUS, no 'sin plantillas'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, {})));
    const r = await listarTemplatesYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  it("200 con null → AMBIGUOUS, no 'sin plantillas'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, null)));
    const r = await listarTemplatesYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });

  it("200 con data que no es un array → AMBIGUOUS, no 'sin plantillas'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, { data: "no-es-una-lista" })));
    const r = await listarTemplatesYCloud(ARGS);
    expect(r.kind).toBe("AMBIGUOUS");
    vi.unstubAllGlobals();
  });
});

describe("mapYCloudTemplateToKorex: preserva el status crudo sin traducirlo", () => {
  it.each(["PENDING", "APPROVED", "REJECTED"])("conserva providerStatus=%s tal cual, sin traducir", (status) => {
    const mapeado = mapYCloudTemplateToKorex({
      officialTemplateId: "tpl_x",
      name: "n",
      language: "es",
      category: "UTILITY",
      status,
    });
    expect(mapeado.providerStatus).toBe(status);
  });
});

describe("mapTemplateToYCloudPayload (función pura)", () => {
  it("nunca incluye organizationId ni ningún campo interno de Korex", () => {
    const payload = mapTemplateToYCloudPayload({
      wabaId: "waba_1",
      name: "n",
      language: "es",
      category: "UTILITY",
      body: "Hola",
    });
    expect(payload).not.toHaveProperty("organizationId");
    expect(payload).not.toHaveProperty("id");
  });
});

describe("acoplamiento de imports (Fase 9F, corrige el Hallazgo #1 de la auditoría 9E)", () => {
  const codigo = readFileSync(join(process.cwd(), "src/server/whatsapp/ycloud-templates.ts"), "utf8");

  it("ya no importa nada de @/server/whatsapp/templates (el módulo que arrastra @/lib/db, ycloud/client.ts de envío, etc.)", () => {
    expect(codigo).not.toMatch(/from\s+["']@\/server\/whatsapp\/templates["']/);
  });

  it("importa countVariables/validateBodyVariables del módulo puro @/server/whatsapp/template-validation", () => {
    expect(codigo).toMatch(/from\s+["']@\/server\/whatsapp\/template-validation["']/);
  });

  it("sigue sin importar @/lib/db, credentials, ni ningún cliente HTTP de envío", () => {
    expect(codigo).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(codigo).not.toMatch(/from\s+["']@\/lib\/ycloud\/client["']/);
    expect(codigo).not.toMatch(/from\s+["']@\/server\/whatsapp\/credentials["']/);
  });
});
