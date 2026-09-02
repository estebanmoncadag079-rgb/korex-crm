import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 5C: `retry`/`timeoutMs` parametrizables en `ycloudSendTemplate` —
 * el motor de campañas necesita que UNA ejecución del worker dispare
 * EXACTAMENTE una llamada HTTP real, nunca las hasta tres ocultas que
 * `sendDirectly` hace por defecto (ver auditoría Fase 5A/5B).
 *
 * `tests/unit/ycloud-reintento-envio.test.ts` ya cubre (y sigue pasando sin
 * cambios) el comportamiento POR DEFECTO — este archivo cubre solo lo nuevo:
 * `retry: false` y `timeoutMs`.
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    YCLOUD_API_KEY: "test-key",
    YCLOUD_BASE_URL: "https://ycloud.test",
  }),
}));

function respuesta(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("ycloudSendTemplate: retry:false — una sola llamada real", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function enviar(retry: boolean, timeoutMs?: number) {
    const { ycloudSendTemplate } = await import("@/lib/ycloud/client");
    const promesa = ycloudSendTemplate({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      name: "seguimiento",
      language: "es",
      bodyParams: [],
      retry,
      timeoutMs,
    });
    promesa.catch(() => {});
    await vi.runAllTimersAsync();
    return promesa;
  }

  it("retry:false ante un 500 (pasajero según la política por defecto): UN solo POST, sin reintento", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(500, { message: "server error" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar(false)).rejects.toThrow(/server error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retry:false ante un 429 (pasajero según la política por defecto): UN solo POST, sin reintento", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(429, { message: "rate limited" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar(false)).rejects.toThrow(/rate limited/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retry:false ante un fallo de red: UN solo intento también", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar(false)).rejects.toThrow(/ECONNRESET/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retry:true explícito conserva el comportamiento de siempre (hasta 3 intentos)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(503, { message: "no disponible" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar(true)).rejects.toThrow(/no disponible/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sin pasar retry (undefined): idéntico al comportamiento histórico, no cambia por omisión", async () => {
    const { ycloudSendTemplate } = await import("@/lib/ycloud/client");
    const fetchMock = vi.fn().mockResolvedValue(respuesta(500, { message: "server error" }));
    vi.stubGlobal("fetch", fetchMock);

    const promesa = ycloudSendTemplate({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      name: "seguimiento",
      language: "es",
      bodyParams: [],
      // retry deliberadamente ausente
    });
    promesa.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promesa).rejects.toThrow(/server error/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("ycloudSendTemplate: timeoutMs con AbortController", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Un fetch que nunca resuelve por sí solo — solo corta si su `signal` aborta. */
  function fetchQueNuncaResponde() {
    return vi.fn((_url: string, options?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
  }

  it("timeoutMs vencido corta la espera — sin él, la misma llamada no tiene límite", async () => {
    const fetchMock = fetchQueNuncaResponde();
    vi.stubGlobal("fetch", fetchMock);

    const { ycloudSendTemplate } = await import("@/lib/ycloud/client");
    const promesa = ycloudSendTemplate({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      name: "seguimiento",
      language: "es",
      bodyParams: [],
      retry: false,
      timeoutMs: 5000,
    });
    promesa.catch(() => {});
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promesa).rejects.toThrow(/aborted/i);
    // El fetch se llamó con una señal real — quien la escucha es este mismo mock.
    expect(fetchMock.mock.calls[0]![1]).toHaveProperty("signal");
  });
});
