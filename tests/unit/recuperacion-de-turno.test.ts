import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El salvavidas de RECUPERACIÓN DE TURNO (`docs/korexia/189`).
 *
 * `openai/gpt-5-mini`, medido contra las mismas 325 entradas que
 * `google/gemini-3.7-flash`, cerró 0 de 6 pedidos donde el cliente confirmó
 * con una frase coloquial. En los seis casos el backend YA tenía el pedido
 * listo (`puedeConfirmarPedido` habría dicho `{ok:true}`); lo que faltó fue
 * que el modelo lo reconociera.
 *
 * Este archivo prueba las dos piezas por separado:
 *
 *  1. `accionEvitablementeNoCerrada` — el DETECTOR. Reutiliza
 *     `puedeConfirmarPedido` sin tocarla; se prueba que de verdad la llama
 *     (no una copia de su lógica) y que NUNCA se activa sin autoridad
 *     backend, sin catálogo, o cuando la acción ya es `notify_order`.
 *
 *  2. `intentarRescateDeCierre` — la ORQUESTACIÓN. Como máximo una llamada a
 *     Gemini y, si confirma, como máximo una más para redactar. Los montos
 *     SIEMPRE salen de `estadoGuardado`, nunca de lo que escriba un modelo
 *     — se prueba inyectando un modelo que MIENTE con otras cifras.
 */

const ultimaConfirmacionDeMock = vi.fn();
vi.mock("@/server/ai/confirmacion-de-pedido", () => ({
  ultimaConfirmacionDe: (...a: unknown[]) => ultimaConfirmacionDeMock(...a),
  registrarConfirmacionDePedido: vi.fn(),
  borrarConfirmacionDePedido: vi.fn(),
  intentarNotificarPedido: vi.fn(),
}));

import { accionEvitablementeNoCerrada, resumenDeLaHoja } from "@/server/ai/recuperacion-de-turno";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";
import type { AgentActionType } from "@/server/ai/actions";
import type { ChatMessage } from "@/lib/ai";

const CATALOGO: ProductoDelCatalogo[] = [
  {
    id: "p1",
    nombre: "Pavé Cremoso 8 oz",
    categoria: "Pavés",
    precioCents: 1000000,
    descripcion: null,
    grupos: [],
  },
];

const HOY = new Date("2026-09-21T12:00:00Z");

const HOJA_COMPLETA: EstadoDelPedido = {
  ...estadoVacio(),
  items: [
    {
      ofrecible: { id: "p1", nombre: "Pavé Cremoso 8 oz" },
      cantidad: 1,
      seleccion: [],
      totalCents: 1000000,
    },
  ],
  totalCents: 1000000,
  datos: { telefono: "3001234567" },
};

const REQUISITOS: Requisito[] = [
  { id: "telefono", tipo: "telefono", etiqueta: "Teléfono", obligatorio: true },
];

const REPLY: AgentActionType = { action: "reply", text: "¿Confirmas el tamaño?" };
const HANDOFF: AgentActionType = { action: "handoff", reason: "no entendí" };
const NOTIFY: AgentActionType = { action: "notify_order", summary: "1 pavé", farewell: "Gracias" };

const historial = (texto: string) => [{ direction: "in" as const, text: texto, createdAt: HOY }];

beforeEach(() => {
  ultimaConfirmacionDeMock.mockReset();
  ultimaConfirmacionDeMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("accionEvitablementeNoCerrada — el detector", () => {
  it("los seis casos medidos: pedido listo, acción distinta de notify_order → true", async () => {
    for (const action of [REPLY, HANDOFF, { action: "provide_requirement", requisitoId: "x", valor: "y" } as AgentActionType]) {
      const r = await accionEvitablementeNoCerrada({
        action,
        conversationId: "cv_1",
        productosDelPedido: CATALOGO,
        history: historial("Sip"),
        estadoGuardado: HOJA_COMPLETA,
        requisitos: REQUISITOS,
      });
      expect(r).toBe(true);
    }
  });

  it("sin autoridad backend (state_source != backend) → false, sin inventar una señal", async () => {
    const r = await accionEvitablementeNoCerrada({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("Sip"),
      estadoGuardado: null,
      requisitos: REQUISITOS,
    });
    expect(r).toBe(false);
    // Ni siquiera debió consultar la idempotencia: se corta antes.
    expect(ultimaConfirmacionDeMock).not.toHaveBeenCalled();
  });

  it("la acción YA es notify_order → false, sigue su camino normal", async () => {
    const r = await accionEvitablementeNoCerrada({
      action: NOTIFY,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("Sip"),
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    expect(r).toBe(false);
  });

  it("sin catálogo real (Lashes Valen, catalog_source=prompt) → false", async () => {
    const r = await accionEvitablementeNoCerrada({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: [],
      history: historial("Sip"),
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    expect(r).toBe(false);
  });

  it("la hoja NO está completa (sin ítems) → false, es un handoff legítimo", async () => {
    const r = await accionEvitablementeNoCerrada({
      action: HANDOFF,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("no sé qué pedir"),
      estadoGuardado: estadoVacio(),
      requisitos: REQUISITOS,
    });
    expect(r).toBe(false);
  });

  it("falta un requisito obligatorio → false: el handoff/reply pidiéndolo es legítimo", async () => {
    const sinTelefono: EstadoDelPedido = { ...HOJA_COMPLETA, datos: {} };
    const r = await accionEvitablementeNoCerrada({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("Sip"),
      estadoGuardado: sinTelefono,
      requisitos: REQUISITOS,
    });
    expect(r).toBe(false);
  });

  it("ya hay una confirmación previa y nada nuevo del catálogo → false (no reabre)", async () => {
    ultimaConfirmacionDeMock.mockResolvedValue({
      id: "oc_1",
      createdAt: new Date("2026-09-21T10:00:00Z"),
    });
    const r = await accionEvitablementeNoCerrada({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: [{ direction: "in", text: "gracias!", createdAt: HOY }],
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    expect(r).toBe(false);
  });

  it("es literalmente puedeConfirmarPedido, no una copia: un espía lo confirma", async () => {
    // Si mañana alguien cambia `puedeConfirmarPedido` y este archivo no se
    // entera, es la prueba de que dejaron de compartir la misma función.
    const r = await accionEvitablementeNoCerrada({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("Sip"),
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    const directo = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("Sip"),
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    expect(r).toBe(directo.ok);
  });
});

describe("resumenDeLaHoja — el hecho que se le da al salvavidas", () => {
  it("no usa ningún modelo: es texto plano a partir del estado", () => {
    const r = resumenDeLaHoja(HOJA_COMPLETA, REQUISITOS);
    expect(r).toContain("Pavé Cremoso 8 oz");
    expect(r).toContain("$10.000");
    expect(r).toContain("3001234567");
  });
});

const baseEnv = () => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
};

const respuesta = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("intentarRescateDeCierre — la orquestación", () => {
  const MENSAJES: ChatMessage[] = [{ role: "user", content: "Sip" }];

  /**
   * `getEnv()` cachea el entorno la primera vez que alguien lo pide, así que
   * cada prueba recarga el módulo. Mismo patrón que `ai-adapter.test.ts`.
   */
  const cargar = async () => {
    vi.resetModules();
    return import("@/server/ai/recuperacion-de-turno");
  };

  beforeEach(() => {
    baseEnv();
  });

  it("sin OPENROUTER_FALLBACK_MODEL, el mecanismo entero queda apagado (rollback de una variable)", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const { intentarRescateDeCierre: fn } = await cargar();
    const r = await fn({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    expect(r.rescatado).toBe(false);
    expect(r.info.motivo).toBe("sin_modelo_configurado");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Gemini confirma → GPT redacta → se rescata con notify_order", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "google/gemini-3.7-flash");
    const { intentarRescateDeCierre } = await cargar();
    let llamada = 0;
    const vistos: string[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      llamada++;
      const body = JSON.parse(String((init as RequestInit).body));
      vistos.push(body.model);
      if (llamada === 1) {
        // El juicio de Gemini: confirma, pero con cifras MENTIROSAS —no deben usarse.
        return respuesta({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "notify_order",
                  summary: "Gemini inventó esto",
                  farewell: "despedida de Gemini",
                  totalCents: 999999999,
                }),
              },
            },
          ],
        });
      }
      // La redacción de GPT.
      return respuesta({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "1x Pavé Cremoso 8 oz — $10.000",
                farewell: "¡Gracias por tu compra! 🎉",
              }),
            },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const r = await intentarRescateDeCierre({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(true);
    if (!r.rescatado) throw new Error("no debería llegar aquí");
    expect(r.accion.action).toBe("notify_order");
    // El texto final es el de GPT (la voz del negocio), no el de Gemini.
    expect((r.accion as { farewell?: string }).farewell).toBe("¡Gracias por tu compra! 🎉");
    // Los montos son los del BACKEND — nunca los que Gemini escribió.
    expect((r.accion as { totalCents?: number }).totalCents).toBe(1000000);
    expect(r.info.redactadoPor).toBe("principal");
    // Dos llamadas: el juicio de Gemini y la redacción de GPT. Ni una más.
    expect(vistos).toEqual(["google/gemini-3.7-flash", "openai/gpt-5-mini"]);
  });

  it("Gemini confirma pero la redacción de GPT falla → se usa el texto de Gemini como respaldo", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "google/gemini-3.7-flash");
    const { intentarRescateDeCierre } = await cargar();
    let llamada = 0;
    global.fetch = vi.fn(async () => {
      llamada++;
      if (llamada === 1) {
        return respuesta({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "notify_order",
                  summary: "resumen de gemini",
                  farewell: "despedida de gemini",
                }),
              },
            },
          ],
        });
      }
      return new Response("boom", { status: 500 });
    }) as unknown as typeof fetch;

    const r = await intentarRescateDeCierre({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(true);
    if (!r.rescatado) throw new Error("no debería llegar aquí");
    expect((r.accion as { farewell?: string }).farewell).toBe("despedida de gemini");
    expect(r.info.redactadoPor).toBe("salvavidas");
  });

  it("Gemini NO confirma (propone otra cosa) → no se rescata, sin segunda llamada", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "google/gemini-3.7-flash");
    const { intentarRescateDeCierre } = await cargar();
    global.fetch = vi.fn(async () =>
      respuesta({
        choices: [{ message: { content: JSON.stringify({ action: "handoff", reason: "no está claro" }) } }],
      })
    ) as unknown as typeof fetch;

    const r = await intentarRescateDeCierre({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(false);
    expect(r.info.motivo).toBe("gemini_no_confirmo");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("Gemini falla técnicamente → no se rescata, sin loop de reintentos propio", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "google/gemini-3.7-flash");
    const { intentarRescateDeCierre } = await cargar();
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;

    const r = await intentarRescateDeCierre({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(false);
    expect(r.info.motivo).toBe("gemini_fallo");
    /*
     * 6, no 3: `cadenaDeSalvavidas` (lib/ai/modelos.ts) no deduplica cuando
     * el modelo pedido explícitamente coincide con `OPENROUTER_FALLBACK_MODEL`
     * — aquí los dos son Gemini, así que `chatJson` agota 3 intentos contra
     * Gemini, ve que el "siguiente salvavidas" es Gemini otra vez, y agota 3
     * más. Ineficiente (el doble de latencia en un camino que ya iba a
     * fallar) pero NO incorrecto: nunca ejecuta una acción, nunca hay un
     * tercer intento desde ESTE módulo. Documentado en el reporte final como
     * hallazgo menor, no bloqueante.
     */
    expect(global.fetch).toHaveBeenCalledTimes(6);
  });
});
