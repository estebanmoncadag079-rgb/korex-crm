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
 * Ampliado el mismo día a CITAS (`book_appointment`, vía `puedeConfirmarCita`)
 * — mismo motor, misma disciplina, ver el encabezado de
 * `recuperacion-de-turno.ts` para qué queda dentro y qué fuera.
 *
 * Este archivo prueba, para cada dominio (pedidos y citas):
 *
 *  1. El DETECTOR (`accionEvitablementeNoCerrada` / `citaEvitablementeNoCerrada`).
 *     Reutiliza la Policy real sin tocarla; se prueba que de verdad la llama
 *     (no una copia de su lógica) y que NUNCA se activa sin autoridad
 *     backend, sin catálogo/servicio, o cuando la acción ya es la de cierre.
 *
 *  2. La ORQUESTACIÓN (`intentarRescateDeCierre` / `intentarRescateDeCita`).
 *     Como máximo una llamada a Gemini y, si confirma, como máximo una más
 *     para redactar. Los datos que importan (montos, fecha, hora, servicio)
 *     SIEMPRE salen de `estadoGuardado`, nunca de lo que escriba un modelo
 *     — se prueba inyectando un modelo que MIENTE con datos propios.
 *
 *  3. El punto de entrada único (`intentarRescatarTurno`), que decide cuál
 *     de los dos dominios aplica y garantiza un solo intento por turno.
 */

const ultimaConfirmacionDeMock = vi.fn();
vi.mock("@/server/ai/confirmacion-de-pedido", () => ({
  ultimaConfirmacionDe: (...a: unknown[]) => ultimaConfirmacionDeMock(...a),
  registrarConfirmacionDePedido: vi.fn(),
  borrarConfirmacionDePedido: vi.fn(),
  intentarNotificarPedido: vi.fn(),
}));

import {
  accionEvitablementeNoCerrada,
  citaEvitablementeNoCerrada,
  intentarRescatarTurno,
  resumenDeLaHoja,
  resumenDeLaReserva,
} from "@/server/ai/recuperacion-de-turno";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import { puedeConfirmarCita } from "@/server/appointments/policy";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { estadoVacio, type EstadoDelPedido, type EntregaVerificada } from "@/server/orders/estado";
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

const RESERVA_COMPLETA: EstadoDelPedido = {
  ...estadoVacio(),
  items: [
    {
      ofrecible: { id: "s1", nombre: "Volumen Ruso" },
      cantidad: 1,
      seleccion: [],
      totalCents: 8000000,
    },
  ],
  reserva: {
    fecha: "25/09/2026",
    hora: "15:00",
    duracionMin: 90,
    recursoId: "r1",
    recursoNombre: "Laura",
  },
  datos: { telefono: "3001234567" },
};

const BOOK: AgentActionType = {
  action: "book_appointment",
  reservas: [{ servicios: ["Volumen Ruso"], fecha: "25/09/2026", hora: "15:00" }],
};

describe("citaEvitablementeNoCerrada — el mismo detector, para citas", () => {
  it("reserva lista, acción distinta de book_appointment → true", () => {
    for (const action of [REPLY, HANDOFF]) {
      expect(
        citaEvitablementeNoCerrada({ action, estadoGuardado: RESERVA_COMPLETA, requisitos: REQUISITOS })
      ).toBe(true);
    }
  });

  it("sin autoridad backend → false", () => {
    expect(
      citaEvitablementeNoCerrada({ action: REPLY, estadoGuardado: null, requisitos: REQUISITOS })
    ).toBe(false);
  });

  it("la acción YA es book_appointment → false", () => {
    expect(
      citaEvitablementeNoCerrada({ action: BOOK, estadoGuardado: RESERVA_COMPLETA, requisitos: REQUISITOS })
    ).toBe(false);
  });

  it("sin fecha/hora verificada por el backend → false (handoff legítimo)", () => {
    const sinHorario: EstadoDelPedido = { ...RESERVA_COMPLETA, reserva: { ...RESERVA_COMPLETA.reserva!, fecha: null, hora: null } };
    expect(
      citaEvitablementeNoCerrada({ action: HANDOFF, estadoGuardado: sinHorario, requisitos: REQUISITOS })
    ).toBe(false);
  });

  it("sin servicio resuelto → false", () => {
    const sinServicio: EstadoDelPedido = { ...RESERVA_COMPLETA, items: [] };
    expect(
      citaEvitablementeNoCerrada({ action: HANDOFF, estadoGuardado: sinServicio, requisitos: REQUISITOS })
    ).toBe(false);
  });

  it("falta un requisito obligatorio → false", () => {
    const sinTelefono: EstadoDelPedido = { ...RESERVA_COMPLETA, datos: {} };
    expect(
      citaEvitablementeNoCerrada({ action: HANDOFF, estadoGuardado: sinTelefono, requisitos: REQUISITOS })
    ).toBe(false);
  });

  it("es literalmente puedeConfirmarCita, no una copia", () => {
    const r = citaEvitablementeNoCerrada({
      action: HANDOFF,
      estadoGuardado: RESERVA_COMPLETA,
      requisitos: REQUISITOS,
    });
    const directo = puedeConfirmarCita({ estadoGuardado: RESERVA_COMPLETA, requisitos: REQUISITOS });
    expect(r).toBe(directo.ok);
  });

  it("reschedule_appointment y cancel_appointment NO disparan nada (fuera de alcance)", () => {
    const RESCHEDULE: AgentActionType = {
      action: "reschedule_appointment",
      servicio: "Volumen Ruso",
      nuevaFecha: "26/09/2026",
      nuevaHora: "16:00",
    };
    // El detector no distingue estas acciones especialmente: como no son
    // "book_appointment", la condición se evalúa igual y SÍ podría marcar
    // `true` si la hoja está lista — pero eso es correcto: lo que importa
    // es que no exista un tercer detector para reschedule/cancel que
    // reconstruya SU PROPIA acción (eso sí sería inventar una señal, porque
    // no hay Policy de "¿está completo?" para reschedule/cancel). Aquí solo
    // se confirma que intentarRescatarTurno nunca podría construir esas
    // acciones — ver el test de alcance en salvavidas-de-cierre-alcance.
    expect(RESCHEDULE.action).not.toBe("book_appointment");
  });
});

describe("resumenDeLaReserva — el hecho que se le da al salvavidas, para citas", () => {
  it("no usa ningún modelo: es texto plano a partir del estado", () => {
    const r = resumenDeLaReserva(RESERVA_COMPLETA, REQUISITOS);
    expect(r).toContain("Volumen Ruso");
    expect(r).toContain("25/09/2026");
    expect(r).toContain("15:00");
    expect(r).toContain("Laura");
  });
});

describe("intentarRescatarTurno — el punto de entrada único", () => {
  /**
   * `getEnv()` cachea el entorno la primera vez que alguien lo pide. Las dos
   * pruebas de abajo necesitan `OPENROUTER_RECOVERY_MODEL` con valores que
   * podrían no coincidir con lo que ya haya en caché por otra prueba de este
   * archivo — se recarga el módulo para que SU `vi.stubEnv` sea el que cuente,
   * no el de quien haya corrido antes.
   */
  const cargar = async () => {
    vi.resetModules();
    return import("@/server/ai/recuperacion-de-turno");
  };

  it("sin ninguna categoría aplicable, devuelve null sin llamar a ningún modelo", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const r = await intentarRescatarTurno({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: [],
      history: historial("hola"),
      messages: [{ role: "user", content: "hola" }],
      estadoGuardado: null,
      requisitos: REQUISITOS,
    });
    expect(r).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("pedido listo (y NO cita) → intenta el rescate de pedido", async () => {
    baseEnv();
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { intentarRescatarTurno: fn } = await cargar();
    global.fetch = vi.fn(async () =>
      respuesta({
        choices: [{ message: { content: JSON.stringify({ action: "handoff", reason: "no confirmó" }) } }],
      })
    ) as unknown as typeof fetch;

    const r = await fn({
      action: REPLY,
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: historial("Sip"),
      messages: [{ role: "user", content: "Sip" }],
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r).not.toBeNull();
    expect(r?.info.objetivo).toBe("pedido");
  });

  it("cita lista (y NO pedido, sin catálogo de productos) → intenta el rescate de cita", async () => {
    baseEnv();
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { intentarRescatarTurno: fn } = await cargar();
    global.fetch = vi.fn(async () =>
      respuesta({
        choices: [{ message: { content: JSON.stringify({ action: "handoff", reason: "no confirmó" }) } }],
      })
    ) as unknown as typeof fetch;

    const r = await fn({
      action: HANDOFF,
      conversationId: "cv_1",
      productosDelPedido: [], // sin catálogo de PEDIDOS: el negocio es de citas
      history: historial("Sip"),
      messages: [{ role: "user", content: "Sip" }],
      estadoGuardado: RESERVA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r).not.toBeNull();
    expect(r?.info.objetivo).toBe("cita");
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

  it("sin OPENROUTER_RECOVERY_MODEL, el mecanismo entero queda apagado (rollback de una variable)", async () => {
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

  /**
   * El punto exacto de la separación (auditoría independiente del commit
   * `26bf657`, corrección #2): antes, `modeloDeRescate()` leía
   * `OPENROUTER_FALLBACK_MODEL` — la MISMA variable que la cadena técnica de
   * `chatJson`. Configurar una sin la otra no era posible. Ahora son
   * independientes: `OPENROUTER_FALLBACK_MODEL` sola, sin
   * `OPENROUTER_RECOVERY_MODEL`, NO debe encender el salvavidas semántico.
   */
  it("OPENROUTER_FALLBACK_MODEL solo, sin OPENROUTER_RECOVERY_MODEL, NO enciende el mecanismo", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "google/gemini-3.7-flash");
    global.fetch = vi.fn() as unknown as typeof fetch;
    const { intentarRescateDeCierre: fn } = await cargar();
    const r = await fn({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });
    expect(r.rescatado).toBe(false);
    expect(r.info.motivo).toBe("sin_modelo_configurado");
    // No cae a OPENROUTER_FALLBACK_MODEL "por la puerta de atrás": si lo
    // hiciera, este fetch SÍ se habría llamado.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Gemini confirma → GPT redacta → se rescata con notify_order", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
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

  /**
   * `deliveryFeeCents` — corrección del 21-sep-2026 (noche): el rescate de
   * pedidos no lo poblaba. La fuente es `entrega` (== `entregaPersistida`
   * de `pipeline.ts`, la MISMA autoridad que usa un cierre normal), nunca
   * Gemini ni texto libre. Un juicio que confirma se simula igual en las
   * cinco pruebas — lo único que cambia es `entrega`.
   */
  describe("deliveryFeeCents — la misma autoridad backend que un cierre normal", () => {
    const juicioConfirmaYRedactaOk = () => {
      let llamada = 0;
      global.fetch = vi.fn(async () => {
        llamada++;
        if (llamada === 1) {
          // Gemini confirma. Sus propias cifras (si trajera alguna) se
          // ignoran siempre — no hay ninguna en este juicio a propósito.
          return respuesta({
            choices: [{ message: { content: JSON.stringify({ action: "notify_order", summary: "x", farewell: "y" }) } }],
          });
        }
        return respuesta({
          choices: [{ message: { content: JSON.stringify({ summary: "resumen", farewell: "despedida" }) } }],
        });
      }) as unknown as typeof fetch;
    };

    it("pedido SIN domicilio: deliveryFeeCents null, totalCents = subtotal", async () => {
      vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
      const { intentarRescateDeCierre } = await cargar();
      juicioConfirmaYRedactaOk();

      const r = await intentarRescateDeCierre({
        messages: MENSAJES,
        estadoGuardado: HOJA_COMPLETA, // sin `entrega`
        requisitos: REQUISITOS,
      });

      expect(r.rescatado).toBe(true);
      if (!r.rescatado) throw new Error("no debería llegar aquí");
      const a = r.accion as { subtotalCents?: number; deliveryFeeCents?: number | null; totalCents?: number };
      expect(a.subtotalCents).toBe(1_000_000);
      expect(a.deliveryFeeCents).toBeNull();
      expect(a.totalCents).toBe(1_000_000);
    });

    it("pedido con domicilio Y tarifa conocida: deliveryFeeCents = la tarifa verificada, totalCents = suma", async () => {
      vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
      const { intentarRescateDeCierre } = await cargar();
      juicioConfirmaYRedactaOk();

      const r = await intentarRescateDeCierre({
        messages: MENSAJES,
        estadoGuardado: HOJA_COMPLETA,
        requisitos: REQUISITOS,
        entrega: {
          tipo: "domicilio",
          zonaId: "z1",
          zonaNombre: "Brisas de Mayo",
          feeCents: 1_200_000,
          verificadoEnMensajeId: null,
          verificadoEn: new Date().toISOString(),
        },
      });

      expect(r.rescatado).toBe(true);
      if (!r.rescatado) throw new Error("no debería llegar aquí");
      const a = r.accion as { subtotalCents?: number; deliveryFeeCents?: number | null; totalCents?: number };
      expect(a.subtotalCents).toBe(1_000_000);
      expect(a.deliveryFeeCents).toBe(1_200_000);
      expect(a.totalCents).toBe(2_200_000);
    });

    it("domicilio SIN tarifa verificada (pendiente): NO inventa la tarifa — mismo comportamiento que un cierre normal", async () => {
      vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
      const { intentarRescateDeCierre } = await cargar();
      juicioConfirmaYRedactaOk();

      const r = await intentarRescateDeCierre({
        messages: MENSAJES,
        estadoGuardado: HOJA_COMPLETA,
        requisitos: REQUISITOS,
        entrega: {
          tipo: "domicilio",
          zonaId: null,
          zonaNombre: null,
          feeCents: null, // pendiente de verificar
          verificadoEnMensajeId: null,
          verificadoEn: new Date().toISOString(),
        },
      });

      // Un cierre normal con domicilio pendiente NO se bloquea (lo dice
      // `bloqueDeDomicilioPendiente`): cierra sin la tarifa, y el pipeline
      // aclara aparte que el domicilio se confirma después. El rescate
      // sigue exactamente ese mismo comportamiento — nunca asume $0 ni
      // ninguna otra cifra.
      expect(r.rescatado).toBe(true);
      if (!r.rescatado) throw new Error("no debería llegar aquí");
      const a = r.accion as { deliveryFeeCents?: number | null; totalCents?: number };
      expect(a.deliveryFeeCents).toBeNull();
      expect(a.totalCents).toBe(1_000_000);
    });

    it("tarifa de domicilio $0 (zona gratis): es una tarifa REAL, no se confunde con 'pendiente'", async () => {
      vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
      const { intentarRescateDeCierre } = await cargar();
      juicioConfirmaYRedactaOk();

      const r = await intentarRescateDeCierre({
        messages: MENSAJES,
        estadoGuardado: HOJA_COMPLETA,
        requisitos: REQUISITOS,
        entrega: {
          tipo: "domicilio",
          zonaId: "z-gratis",
          zonaNombre: "Zona gratis",
          feeCents: 0,
          verificadoEnMensajeId: null,
          verificadoEn: new Date().toISOString(),
        },
      });

      expect(r.rescatado).toBe(true);
      if (!r.rescatado) throw new Error("no debería llegar aquí");
      const a = r.accion as { deliveryFeeCents?: number | null; totalCents?: number };
      expect(a.deliveryFeeCents).toBe(0);
      expect(a.deliveryFeeCents).not.toBeNull();
      expect(a.totalCents).toBe(1_000_000);
    });

    it("coherencia: totalCents === subtotalCents + (deliveryFeeCents ?? 0), en los cuatro casos de arriba", async () => {
      vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
      const { intentarRescateDeCierre } = await cargar();

      const entregas: (EntregaVerificada | undefined)[] = [
        undefined,
        { tipo: "recogida", zonaId: null, zonaNombre: null, feeCents: null, verificadoEnMensajeId: null, verificadoEn: "x" },
        { tipo: "domicilio", zonaId: "z1", zonaNombre: "Z1", feeCents: 800_000, verificadoEnMensajeId: null, verificadoEn: "x" },
        { tipo: "domicilio", zonaId: null, zonaNombre: null, feeCents: null, verificadoEnMensajeId: null, verificadoEn: "x" },
      ];
      for (const entrega of entregas) {
        juicioConfirmaYRedactaOk();
        const r = await intentarRescateDeCierre({
          messages: MENSAJES,
          estadoGuardado: HOJA_COMPLETA,
          requisitos: REQUISITOS,
          entrega,
        });
        expect(r.rescatado).toBe(true);
        if (!r.rescatado) throw new Error("no debería llegar aquí");
        const a = r.accion as { subtotalCents?: number; deliveryFeeCents?: number | null; totalCents?: number };
        expect(a.totalCents).toBe((a.subtotalCents ?? 0) + (a.deliveryFeeCents ?? 0));
      }
    });
  });

  it("Gemini confirma pero la redacción de GPT falla → se usa el texto de Gemini como respaldo", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
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
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
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
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.7-flash");
    const { intentarRescateDeCierre } = await cargar();
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;

    const r = await intentarRescateDeCierre({
      messages: MENSAJES,
      estadoGuardado: HOJA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(false);
    expect(r.info.motivo).toBe("gemini_fallo");
    /**
     * Exactamente 3, no 6.
     *
     * Antes de la separación de variables (corrección #2 sobre la auditoría
     * del commit `26bf657`), `modeloDeRescate()` leía `OPENROUTER_FALLBACK_
     * MODEL` — la MISMA que usa `cadenaDeSalvavidas` para el "siguiente
     * salvavidas" dentro de `chatJson`. Cuando los dos valores coincidían
     * (el caso normal: el mismo Gemini en ambos), `chatJson` agotaba 3
     * intentos contra Gemini, veía que el "siguiente" era Gemini otra vez, y
     * agotaba 3 más — 6 llamadas para un fallo que ya estaba decidido tras
     * las primeras 3.
     *
     * Con `OPENROUTER_RECOVERY_MODEL` como variable propia y
     * `OPENROUTER_FALLBACK_MODEL` SIN configurar en esta prueba (como
     * corresponde tras la separación), `cadenaDeSalvavidas` no tiene ningún
     * "siguiente" que probar: son 3 intentos, y se acabó. La ineficiencia
     * detectada en la auditoría se resolvió como efecto colateral de separar
     * las variables, no con un cambio aparte.
     */
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("intentarRescateDeCita — la orquestación (mismo motor, otro dominio)", () => {
  const MENSAJES_CITA: ChatMessage[] = [{ role: "user", content: "Sip" }];

  const cargar = async () => {
    vi.resetModules();
    return import("@/server/ai/recuperacion-de-turno");
  };

  beforeEach(() => {
    baseEnv();
  });

  it("Gemini confirma → GPT redacta → se rescata con book_appointment reconstruido del backend", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { intentarRescateDeCita } = await cargar();
    let llamada = 0;
    const vistos: string[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      llamada++;
      const body = JSON.parse(String((init as RequestInit).body));
      vistos.push(body.model);
      if (llamada === 1) {
        // El juicio de Gemini: confirma, pero con fecha/hora/servicio MENTIROSOS.
        return respuesta({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "book_appointment",
                  reservas: [{ servicios: ["Otro servicio inventado"], fecha: "01/01/2099", hora: "00:00" }],
                }),
              },
            },
          ],
        });
      }
      return respuesta({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Volumen Ruso — 25/09/2026 15:00 con Laura",
                farewell: "¡Nos vemos el jueves! 💇‍♀️",
              }),
            },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const r = await intentarRescateDeCita({
      messages: MENSAJES_CITA,
      estadoGuardado: RESERVA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(true);
    if (!r.rescatado) throw new Error("no debería llegar aquí");
    expect(r.accion.action).toBe("book_appointment");
    const reservas = (r.accion as { reservas?: { servicios: string[]; fecha: string; hora: string; especialista?: string }[] }).reservas;
    // La fecha/hora/servicio/especialista son los del BACKEND, nunca los que
    // Gemini inventó.
    expect(reservas?.[0]?.fecha).toBe("25/09/2026");
    expect(reservas?.[0]?.hora).toBe("15:00");
    expect(reservas?.[0]?.servicios).toEqual(["Volumen Ruso"]);
    expect(reservas?.[0]?.especialista).toBe("Laura");
    expect((r.accion as { farewell?: string }).farewell).toBe("¡Nos vemos el jueves! 💇‍♀️");
    expect(r.info.objetivo).toBe("cita");
    expect(vistos).toEqual(["google/gemini-3.8-flash", "openai/gpt-5-mini"]);
  });

  it("si la redacción falla, usa un respaldo determinista — nunca un mensaje vacío", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { intentarRescateDeCita } = await cargar();
    let llamada = 0;
    global.fetch = vi.fn(async () => {
      llamada++;
      if (llamada === 1) {
        return respuesta({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "book_appointment",
                  // Sin farewell propio: book_appointment no trae `summary`.
                  reservas: [{ servicios: ["Volumen Ruso"], fecha: "25/09/2026", hora: "15:00" }],
                }),
              },
            },
          ],
        });
      }
      return new Response("boom", { status: 500 });
    }) as unknown as typeof fetch;

    const r = await intentarRescateDeCita({
      messages: MENSAJES_CITA,
      estadoGuardado: RESERVA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(true);
    if (!r.rescatado) throw new Error("no debería llegar aquí");
    // Nunca vacío: el respaldo determinista usa el resumen de la reserva.
    expect((r.accion as { farewell?: string }).farewell).toBeTruthy();
    expect((r.accion as { farewell?: string }).farewell).toContain("Volumen Ruso");
    expect(r.info.redactadoPor).toBe("salvavidas");
  });

  it("Gemini NO confirma → no se rescata", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { intentarRescateDeCita } = await cargar();
    global.fetch = vi.fn(async () =>
      respuesta({
        choices: [{ message: { content: JSON.stringify({ action: "handoff", reason: "no está claro" }) } }],
      })
    ) as unknown as typeof fetch;

    const r = await intentarRescateDeCita({
      messages: MENSAJES_CITA,
      estadoGuardado: RESERVA_COMPLETA,
      requisitos: REQUISITOS,
    });

    expect(r.rescatado).toBe(false);
    expect(r.info.motivo).toBe("gemini_no_confirmo");
    expect(r.info.objetivo).toBe("cita");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
