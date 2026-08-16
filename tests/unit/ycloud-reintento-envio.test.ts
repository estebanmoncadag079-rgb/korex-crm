import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reintento de envíos con fallo pasajero (5-ago-2026).
 *
 * Antes, un hipo de red dejaba perdida la respuesta que el agente ya había
 * generado y pagado. Se reintenta lo que puede salir bien la próxima (red
 * caída, 5xx, 429) y NO lo que va a fallar igual (4xx: número inválido, clave
 * mala) — reintentar un permanente solo retrasa el aviso al equipo.
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

describe("ycloudSendText: reintentos", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function enviar() {
    const { ycloudSendText } = await import("@/lib/ycloud/client");
    const promesa = ycloudSendText({
      from: "573158339990",
      to: { kind: "phone", value: "573165345762" },
      text: "hola",
    });
    /*
     * Un observador temprano del rechazo.
     *
     * Sin esto la promesa pasa por `runAllTimersAsync` SIN dueño: para cuando el
     * test hace `await expect(...).rejects`, Node ya la contó como "unhandled
     * rejection". Las cuatro pruebas pasaban igual, pero **vitest salía con
     * código 1** y dejaba el gate en rojo por dos errores que no eran de nadie.
     *
     * El `.catch` solo marca la promesa como observada; el rechazo se sigue
     * propagando al test por el `return`.
     */
    promesa.catch(() => {});
    // Las esperas entre reintentos no deben alargar la prueba.
    await vi.runAllTimersAsync();
    return promesa;
  }

  it("un 500 pasajero se reintenta y el segundo intento entrega", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(500, { message: "server error" }))
      .mockResolvedValueOnce(respuesta(200, { wamid: "wamid.OK" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar()).resolves.toBe("wamid.OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un fallo de red se reintenta igual", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(respuesta(200, { wamid: "wamid.OK" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar()).resolves.toBe("wamid.OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un 400 NO se reintenta: va a fallar igual", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuesta(400, { message: "Invalid E.164 phone number" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar()).rejects.toThrow(/Invalid E.164/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("si todos los intentos fallan, lanza el último error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(503, { message: "no disponible" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enviar()).rejects.toThrow(/no disponible/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 intento + 2 reintentos
  });
});
