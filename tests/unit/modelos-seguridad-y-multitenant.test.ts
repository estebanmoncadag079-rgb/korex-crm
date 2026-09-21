/**
 * Lo que el reparto de modelos NO puede romper: los secretos y el
 * aislamiento entre negocios.
 *
 * No son comprobaciones teóricas. Al separar el modelo que conversa del que
 * lee medios se tocaron cuatro archivos que hablan con el proveedor, y en
 * tres de ellos hay una credencial a un `fetch` de distancia.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ARCHIVOS_QUE_LLAMAN_AL_PROVEEDOR = [
  "src/lib/ai/index.ts",
  "src/lib/ai/modelos.ts",
  "src/server/ai/transcribir.ts",
  "src/server/ai/generador/extraer-catalogo.ts",
];

describe("la credencial no se escapa", () => {
  for (const archivo of ARCHIVOS_QUE_LLAMAN_AL_PROVEEDOR) {
    it(`${archivo} no mete el token en ningún log`, () => {
      const fuente = readFileSync(archivo, "utf8");
      // Cada console.* del archivo, con su contenido hasta el cierre.
      const logs = fuente.match(/console\.(log|warn|info|error)\([\s\S]*?\);/g) ?? [];
      for (const log of logs) {
        expect(log).not.toContain("OPENROUTER_API_TOKEN");
        expect(log).not.toContain("Authorization");
        expect(log).not.toMatch(/Bearer/);
      }
    });
  }

  it("el token solo viaja en la cabecera Authorization, nunca en el cuerpo ni la URL", () => {
    for (const archivo of ARCHIVOS_QUE_LLAMAN_AL_PROVEEDOR) {
      const fuente = readFileSync(archivo, "utf8");
      /*
       * Se cuentan los ACCESOS al valor (`env.OPENROUTER_API_TOKEN`), no las
       * veces que aparece el nombre. Nombrarlo en un mensaje de error —"Sin
       * OPENROUTER_API_TOKEN configurado"— es correcto y además es lo que
       * permite diagnosticar; lo que no puede pasar es que el VALOR acabe en
       * otro sitio que no sea la cabecera.
       */
      const accesos = fuente.match(/env\s*\.\s*OPENROUTER_API_TOKEN/g) ?? [];
      if (accesos.length === 0) continue;
      const enCabecera = fuente.match(/Authorization: `Bearer \$\{env\.OPENROUTER_API_TOKEN\}`/g) ?? [];
      expect(enCabecera.length).toBe(accesos.length);
    }
  });

  it("el repartidor de modelos no toca la credencial siquiera", () => {
    const fuente = readFileSync("src/lib/ai/modelos.ts", "utf8");
    expect(fuente).not.toContain("OPENROUTER_API_TOKEN");
  });
});

describe("la elección de modelo es genérica, no por cliente", () => {
  /**
   * `REGLAS-DE-ARQUITECTURA.md`: nada específico de un cliente en el núcleo.
   * Un `if (organizationId === "org_...")` para darle otro modelo a un
   * negocio sería exactamente eso, y además haría imposible razonar sobre
   * qué modelo atendió qué.
   */
  it("ningún archivo de modelos decide según la organización", () => {
    for (const archivo of [...ARCHIVOS_QUE_LLAMAN_AL_PROVEEDOR]) {
      const fuente = readFileSync(archivo, "utf8");
      expect(fuente).not.toMatch(/organizationId\s*===\s*["'`]org_/);
      expect(fuente).not.toMatch(/["'`]org_[a-z0-9]{8}/i);
    }
  });

  it("el repartidor no recibe la organización: no puede discriminar", () => {
    const fuente = readFileSync("src/lib/ai/modelos.ts", "utf8");
    // Ninguna de las funciones de papel acepta parámetros de negocio.
    expect(fuente).toMatch(/export function modeloQueConversa\(\)/);
    expect(fuente).toMatch(/export function modeloQueLeeMedios\(\)/);
    expect(fuente).toMatch(/export function modeloQueJuzga\(\)/);
    expect(fuente).not.toContain("organizationId");
  });
});

describe("el gasto queda atribuido al negocio que lo generó", () => {
  const baseEnv = () => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "google/gemini-3.7-flash");
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    baseEnv();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("leer una carta anota el consumo con la organización y el modelo reales", async () => {
    const anotado: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/server/usage", () => ({
      registrarUsoIa: async (org: string, usage: unknown, ref: string) => {
        anotado.push({ org, usage, ref });
      },
    }));
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '[{"nombre":"Pavé","precio":18000}]' } }],
            usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0004 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    ) as unknown as typeof fetch;

    const { extraerCatalogoDeTexto } = await import("@/server/ai/generador/extraer-catalogo");
    await extraerCatalogoDeTexto("Pavé 18000", "org_de_quien_paga");

    // Antes del 21-sep-2026 esto no se anotaba: el gasto del catálogo era
    // invisible en usage_event.
    expect(anotado).toHaveLength(1);
    const a = anotado[0] as { org: string; usage: { model: string; costUsd: number }; ref: string };
    expect(a.org).toBe("org_de_quien_paga");
    expect(a.usage.model).toBe("google/gemini-3.7-flash");
    expect(a.usage.costUsd).toBe(0.0004);
    expect(a.ref).toBe("catalogo:texto");
    vi.doUnmock("@/server/usage");
  });

  it("sin organización no se anota a nadie, en vez de anotarlo a cualquiera", async () => {
    const anotado: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/server/usage", () => ({
      registrarUsoIa: async (...args: unknown[]) => {
        anotado.push(args);
      },
    }));
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "[]" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    ) as unknown as typeof fetch;

    const { extraerCatalogoDeTexto } = await import("@/server/ai/generador/extraer-catalogo");
    await extraerCatalogoDeTexto("Pavé 18000");

    expect(anotado).toHaveLength(0);
    vi.doUnmock("@/server/usage");
  });
});
