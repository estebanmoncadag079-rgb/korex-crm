/**
 * El guardarraíl que habría cazado el incidente del 21-sep-2026.
 *
 * ## Qué pasó
 *
 * El dueño abrió el panel de producción para poner `openai/gpt-5-mini` como
 * modelo conversacional y bajar el gasto de IA. Con el código de entonces,
 * `OPENROUTER_MODEL` mandaba también sobre la transcripción de audio — y ese
 * modelo **no acepta audio**: su registro en el proveedor declara
 * `entrada: text, image, file`, sin `audio`.
 *
 * Guardar ese cambio habría dejado sin entender los **805 audios al mes**
 * (27 al día) que hoy pasan por transcripción en cinco negocios:
 * Camilabrandcol 294, Lashes Valen 229, MALIA 196, Lis 82, La Churra 4.
 *
 * Son 420 que mandan los clientes y 385 que manda el NEGOCIO desde su
 * celular — `mediaATexto` se llama en las dos direcciones (`ingest.ts:319` y
 * `:673`), y los del negocio importan igual: si Lis resuelve por nota de voz
 * "el domicilio son 8.000" y devuelve el turno, el agente tiene que saberlo.
 *
 * Y sin ningún error visible en el CRM: el bot simplemente no respondería a
 * lo que le acaban de decir hablando.
 *
 * Se detectó mirando la pantalla del panel antes de guardar. Nada en el
 * código lo impedía.
 *
 * ## Qué se fija aquí
 *
 * Dos cosas distintas, y las dos hacen falta:
 *
 *  1. **Comportamiento**: con los dos modelos configurados, el audio sale al
 *     que oye y la conversación al que conversa. Se comprueba mirando el
 *     cuerpo que de verdad se le manda al proveedor.
 *  2. **Estructura**: ningún archivo de medios vuelve a leer
 *     `OPENROUTER_MODEL` por su cuenta. Sin esto, alguien puede "arreglar"
 *     un día un caso raro volviendo a la variable de siempre y el
 *     comportamiento se rompería solo cuando la configuración difiera.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONVERSA = "openai/gpt-5-mini";
const OYE = "google/gemini-3.7-flash";

const baseEnv = () => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  vi.stubEnv("OPENROUTER_MODEL", CONVERSA);
  vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", OYE);
};

/** `getEnv()` cachea, así que cada prueba recarga los módulos. */
const cargarTranscribir = async () => {
  vi.resetModules();
  return import("@/server/ai/transcribir");
};

/**
 * Responde primero la descarga del medio y después la llamada al modelo,
 * devolviendo el modelo que se pidió en esa segunda llamada.
 */
function proveedorQueDevuelveElModeloPedido(respuesta: string) {
  const visto: { modelo?: string } = {};
  let llamada = 0;
  global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    llamada++;
    if (llamada === 1) return new Response(new ArrayBuffer(8), { status: 200 });
    visto.modelo = JSON.parse(String(init?.body)).model;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: respuesta } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;
  return visto;
}

beforeEach(() => {
  vi.restoreAllMocks();
  baseEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el audio va al modelo que OYE, no al que conversa", () => {
  it("una nota de voz se manda al modelo de transcripción", async () => {
    const visto = proveedorQueDevuelveElModeloPedido("quiero dos pavés");
    const { transcribirAudio } = await cargarTranscribir();

    const r = await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/1",
      mimeType: "audio/ogg; codecs=opus",
    });

    expect(r.texto).toBe("quiero dos pavés");
    expect(visto.modelo).toBe(OYE);
    // Lo que de verdad importa: NO fue al sordo.
    expect(visto.modelo).not.toBe(CONVERSA);
  });

  it("una imagen también: describir un comprobante es percepción, no diálogo", async () => {
    const visto = proveedorQueDevuelveElModeloPedido("[COMPROBANTE] Nequi · $22.000");
    const { describirImagen } = await cargarTranscribir();

    await describirImagen({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/1",
      mimeType: "image/jpeg",
    });

    expect(visto.modelo).toBe(OYE);
  });

  it("leer una carta para el catálogo, igual", async () => {
    let modelo: string | undefined;
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      modelo = JSON.parse(String(init?.body)).model;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"nombre":"Pavé","precio":18000}]' } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { extraerCatalogoDeTexto } = await import("@/server/ai/generador/extraer-catalogo");
    const r = await extraerCatalogoDeTexto("Pavé 18000");

    expect(r.ok).toBe(true);
    expect(modelo).toBe(OYE);
  });

  it("y la conversación sigue yendo al que conversa", async () => {
    const llamados: string[] = [];
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      llamados.push(JSON.parse(String(init?.body)).model);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"action":"reply","text":"ok"}' } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { chatJson } = await import("@/lib/ai");
    const { z } = await import("zod");
    const r = await chatJson(z.object({ action: z.string(), text: z.string() }), [
      { role: "user", content: "hola" },
    ]);

    expect(r.ok).toBe(true);
    expect(llamados).toEqual([CONVERSA]);
  });
});

describe("cuando solo hay un modelo, nada cambia respecto a antes", () => {
  it("sin la variable de transcripción, el audio usa el conversacional", async () => {
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const visto = proveedorQueDevuelveElModeloPedido("hola");
    const { transcribirAudio } = await cargarTranscribir();

    await transcribirAudio({
      organizationId: "org_x",
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/1",
      mimeType: "audio/ogg",
    });

    // Exactamente el comportamiento del código viejo: cero regresión para
    // quien no configure la variable nueva.
    expect(visto.modelo).toBe(CONVERSA);
  });
});

describe("estructura: nadie vuelve a atar los medios a la variable de conversación", () => {
  /**
   * El comportamiento de arriba solo se rompe cuando los dos modelos
   * difieren. Si alguien reintroduce `env.OPENROUTER_MODEL` en un archivo de
   * medios, las pruebas de comportamiento seguirían en verde en cualquier
   * entorno donde ambas variables valgan lo mismo — que es el entorno de
   * desarrollo de todo el mundo. Por eso hace falta mirar el código.
   */
  const ARCHIVOS_DE_MEDIOS = [
    "src/server/ai/transcribir.ts",
    "src/server/ai/generador/extraer-catalogo.ts",
  ];

  for (const archivo of ARCHIVOS_DE_MEDIOS) {
    it(`${archivo} no lee OPENROUTER_MODEL`, () => {
      const fuente = readFileSync(archivo, "utf8");
      // Se busca el ACCESO a la variable, no la palabra: los comentarios que
      // explican por qué ya no se usa deben poder nombrarla.
      const accesos = fuente.match(/env\s*\.\s*OPENROUTER_MODEL/g) ?? [];
      expect(accesos).toEqual([]);
    });

    it(`${archivo} pide su modelo al repartidor de papeles`, () => {
      const fuente = readFileSync(archivo, "utf8");
      expect(fuente).toContain("modeloQueLeeMedios");
    });
  }

  it("el turno del agente nunca ve un audio: la transcripción ocurre al INGERIR", () => {
    /**
     * Es lo que hace que la separación funcione. El audio se transcribe una
     * vez, al recibirlo, y lo que se guarda en el mensaje es texto; a partir
     * de ahí el pipeline no distingue una nota de voz de algo tecleado.
     *
     * Si alguien moviera la transcripción al turno —para "ahorrar" cuando el
     * cliente no escribe, por ejemplo— el modelo conversacional recibiría
     * audio, y con un conversacional sordo eso es exactamente el incidente,
     * por otra puerta.
     */
    const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");
    expect(pipeline).not.toMatch(/transcribirAudio|describirImagen/);

    const ingest = readFileSync("src/server/inbox/ingest.ts", "utf8");
    expect(ingest).toContain("transcribirAudio");
  });

  it("el repartidor es el ÚNICO que lee las variables de modelo", () => {
    // Si esto falla, hay un segundo sitio donde se decide qué modelo va en
    // qué papel, y los dos pueden discrepar.
    const resolver = readFileSync("src/lib/ai/modelos.ts", "utf8");
    expect(resolver).toContain("OPENROUTER_TRANSCRIPTION_MODEL");
    expect(resolver).toContain("OPENROUTER_MODEL");

    const adaptador = readFileSync("src/lib/ai/index.ts", "utf8");
    expect(adaptador.match(/env\s*\.\s*OPENROUTER_MODEL/g) ?? []).toEqual([]);
    expect(adaptador.match(/env\s*\.\s*OPENROUTER_FALLBACK_MODEL/g) ?? []).toEqual([]);
  });
});
