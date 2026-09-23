import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson, extractJson } from "@/lib/ai";

describe("extractJson (extracción robusta)", () => {
  it("JSON limpio", () => {
    expect(extractJson('{"action":"none"}')).toEqual({ action: "none" });
  });

  it("bloque ```json con texto alrededor", () => {
    const raw = 'Claro, aquí está:\n```json\n{"action":"reply","text":"hola"}\n```\nEspero que sirva.';
    expect(extractJson(raw)).toEqual({ action: "reply", text: "hola" });
  });

  it("JSON incrustado en prosa (primer { al último })", () => {
    const raw = 'La acción que tomaré es {"action":"handoff","reason":"cliente"} por lo dicho.';
    expect(extractJson(raw)).toEqual({ action: "handoff", reason: "cliente" });
  });

  it("sin JSON → null", () => {
    expect(extractJson("no tengo nada que decir")).toBeNull();
  });
});

describe("chatJson (reintentos y errores tipados)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function providerResponse(content: string) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("salida inválida al primer intento → reintenta con STRICT y triunfa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("no soy json"))
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // el reintento agrega la instrucción STRICT
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(JSON.stringify(secondBody.messages)).toContain("STRICT");
  });

  it("proveedor caído (500 persistente) → error tipado, jamás excepción", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("boom", { status: 500 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3); // agotó los 3 intentos
  });

  it("salida que nunca cumple el esquema → invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(providerResponse('{"action":"otra_cosa"}'))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_output");
  });

  it("sin token → not_configured sin tocar la red", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Los salvavidas (9-sep-2026).
 *
 * El modelo de respaldo existió, se quitó dos veces (31-jul y 13-ago) con este
 * criterio: si el modelo no resuelve la conversación, lo que necesita ese
 * cliente es una PERSONA, no otro modelo. **El dueño se retractó** y pidió
 * reponerlo con dos escalones, para medir si ayudan antes de cambiar el modelo
 * de diario.
 *
 * El retiro de agosto salió mal por algo operativo, no de diseño: se quitó el
 * código pero la variable quedó puesta en el servidor, y Sonnet siguió
 * atendiendo conversaciones reales durante SEMANAS mientras la documentación
 * decía que el respaldo no existía. Nadie lo vio porque nada lo registraba.
 * Por eso la última prueba de este bloque —que el modelo que respondió sea el
 * que sale reportado— es la que de verdad importa.
 */
describe("cadena de salvavidas", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "principal");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "salvavidas-1");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL_2", "salvavidas-2");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /**
   * `getEnv()` cachea el entorno la primera vez que alguien lo pide, y en este
   * archivo el bloque de arriba ya lo dejó cacheado sin salvavidas. Recargar el
   * módulo por prueba es lo que hace que las variables de este bloque cuenten
   * — el mismo motivo por el que el comparador de modelos corre un proceso por
   * modelo en vez de cambiarlos en caliente.
   */
  const cargarChatJson = async () => {
    vi.resetModules();
    return (await import("@/lib/ai")).chatJson;
  };

  const ok = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"action":"reply","text":"ok"}' } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const caido = () => new Response("boom", { status: 500 });
  const modelosLlamados = (m: { mock: { calls: unknown[][] } }) =>
    m.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body).model);

  it("si el principal responde, NINGÚN salvavidas se gasta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);

    const chatJsonFresco = await cargarChatJson();
    const r = await chatJsonFresco(schema, [{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(true);
    expect(modelosLlamados(fetchMock)).toEqual(["principal"]);
  });

  it("principal agotado → entra el primer salvavidas, y ahí para", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(caido())
      .mockResolvedValueOnce(caido())
      .mockResolvedValueOnce(caido())
      .mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);

    const chatJsonFresco = await cargarChatJson();
    const r = await chatJsonFresco(schema, [{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(true);
    // Tres intentos del principal + uno del salvavidas. El segundo NO se toca.
    expect(modelosLlamados(fetchMock)).toEqual([
      "principal",
      "principal",
      "principal",
      "salvavidas-1",
    ]);
  });

  it("los dos primeros agotados → entra el segundo salvavidas", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) =>
      Promise.resolve(JSON.parse(init.body).model === "salvavidas-2" ? ok() : caido())
    );
    vi.stubGlobal("fetch", fetchMock);

    const chatJsonFresco = await cargarChatJson();
    const r = await chatJsonFresco(schema, [{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(true);
    expect(modelosLlamados(fetchMock).filter((m, i, a) => a.indexOf(m) === i)).toEqual([
      "principal",
      "salvavidas-1",
      "salvavidas-2",
    ]);
  });

  it("cadena entera agotada → error tipado, y el rescate sigue siendo HUMANO", async () => {
    // Es la propiedad que no se puede perder: agotados los modelos, el turno
    // devuelve un error que `runAgentTurn` convierte en derivación a una
    // persona. Los salvavidas se meten ANTES de eso, nunca en su lugar.
    const fetchMock = vi.fn().mockResolvedValue(caido());
    vi.stubGlobal("fetch", fetchMock);

    const chatJsonFresco = await cargarChatJson();
    const r = await chatJsonFresco(schema, [{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(9); // 3 modelos × 3 intentos
  });

  it("sin salvavidas configurados, se comporta como antes: un solo modelo", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL_2", "");
    const fetchMock = vi.fn().mockResolvedValue(caido());
    vi.stubGlobal("fetch", fetchMock);

    const chatJsonFresco = await cargarChatJson();
    const r = await chatJsonFresco(schema, [{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("LO QUE COSTÓ SEMANAS DE INVISIBILIDAD: se reporta el modelo que de verdad contestó", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) =>
      Promise.resolve(JSON.parse(init.body).model === "salvavidas-1" ? ok() : caido())
    );
    vi.stubGlobal("fetch", fetchMock);

    const chatJsonFresco = await cargarChatJson();
    const r = await chatJsonFresco(schema, [{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(true);
    // No "principal", que es el configurado: el que respondió.
    expect(r.usage?.model).toBe("salvavidas-1");
  });
});

/**
 * `finish_reason` viajaba en la respuesta del proveedor y se tiraba a la
 * basura (22-sep-2026). Es el único dato que distingue "el modelo terminó de
 * hablar" de "lo cortaron a mitad", y sin él una respuesta truncada llega al
 * turno indistinguible de una completa: parsea, valida y sale.
 *
 * Quien lo usa es `integridad-de-salida.ts`; aquí solo se comprueba que llegue
 * y que su ausencia no rompa nada — la mayoría de la cadena son modelos y
 * proveedores que puede que no lo manden.
 */
describe("chatJson: el finish_reason del proveedor llega hasta el turno", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function conFinishReason(content: string, finishReason?: string) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("una respuesta cortada por longitud llega marcada como tal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(conFinishReason('{"action":"reply","text":"ok"}', "length"))
    );
    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finishReason).toBe("length");
  });

  it("una respuesta normal llega con su 'stop'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(conFinishReason('{"action":"reply","text":"ok"}', "stop"))
    );
    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    if (result.ok) expect(result.finishReason).toBe("stop");
  });

  it("un proveedor que no lo manda no rompe el turno", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(conFinishReason('{"action":"reply","text":"ok"}'))
    );
    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text).toBe("ok");
      expect(result.finishReason ?? null).toBeNull();
    }
  });
});
