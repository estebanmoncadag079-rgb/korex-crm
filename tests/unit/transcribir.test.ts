import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { transcribirAudio } from "@/server/ai/transcribir";

/**
 * Las notas de voz eran invisibles para el agente: el historial que recibe
 * filtra por texto, así que respondía un saludo genérico a quien acababa de
 * explicar su pedido hablando.
 *
 * Lo que se prueba aquí es que transcribir NUNCA rompa la entrada de mensajes.
 * Perder la transcripción es molesto; perder el mensaje sería mucho peor —el
 * cliente escribió y nadie se enteraría—, así que cada fallo devuelve null con
 * su motivo y el mensaje sigue su camino.
 */
describe("transcripción de notas de voz", () => {
  const fetchOriginal = global.fetch;
  beforeEach(() => {
    // getEnv() valida el entorno entero, no solo lo de IA.
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "test-token");
    vi.stubEnv("OPENROUTER_MODEL", "google/gemini-2.5-flash");
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rechaza un origen que no está en la lista blanca, sin descargar nada", async () => {
    const espia = vi.fn();
    global.fetch = espia as unknown as typeof fetch;

    const r = await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://atacante.net/audio.ogg",
    });

    expect(r.texto).toBeNull();
    expect(r.motivo).toBe("origen");
    // Lo importante: ni siquiera se intentó la descarga.
    expect(espia).not.toHaveBeenCalled();
  });

  it("rechaza un dominio que solo imita al permitido", async () => {
    const r = await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com.atacante.net/audio.ogg",
    });
    expect(r.motivo).toBe("origen");
  });

  it("si la descarga falla, devuelve null y no revienta", async () => {
    global.fetch = vi.fn(async () =>
      new Response(null, { status: 404 })
    ) as unknown as typeof fetch;

    const r = await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/1",
    });
    expect(r.texto).toBeNull();
    expect(r.motivo).toBe("descarga");
  });

  it("descarta un audio demasiado grande antes de mandarlo al modelo", async () => {
    global.fetch = vi.fn(async () =>
      new Response(new ArrayBuffer(8), {
        status: 200,
        headers: { "content-length": String(50 * 1024 * 1024) },
      })
    ) as unknown as typeof fetch;

    const r = await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/1",
    });
    expect(r.motivo).toBe("grande");
  });

  it("si el proveedor falla, devuelve null en vez de lanzar", async () => {
    let llamada = 0;
    global.fetch = vi.fn(async () => {
      llamada++;
      // 1ª: descarga del audio · 2ª: el modelo, que se cae.
      return llamada === 1
        ? new Response(new ArrayBuffer(1024), { status: 200 })
        : new Response("boom", { status: 500 });
    }) as unknown as typeof fetch;

    const r = await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/1",
    });
    expect(r.texto).toBeNull();
    expect(r.motivo).toBe("proveedor");
  });
});
