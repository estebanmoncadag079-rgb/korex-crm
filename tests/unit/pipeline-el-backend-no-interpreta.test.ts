import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El backend NO interpreta al cliente (doc 198, decisión del dueño 25-sep-2026).
 *
 * Hasta hoy, antes de la primera llamada al modelo, el backend corría detectores
 * de palabras clave sobre el mensaje del cliente y le inyectaba su conclusión
 * como HECHO ("[SISTEMA] … Esto ya está verificado"), o un "PLAN DEL TURNO".
 * Adivinaban mal, y el modelo obedecía porque venía del backend:
 *
 * - Lis, 25-sep 13:42: "hoy tienes de qué sabores" → buscó el producto «de que
 *   sabores» → "No digas que sí lo tienen" → derivó a una persona.
 * - MALIA/Sofía, 25-sep 17:35: "¿te puedo pagar en efectivo cuando llegue el
 *   domicilio?" → "SÍ está entre las formas de pago. Confírmalo con seguridad"
 *   → aprobó efectivo contra entrega (la ficha: "solo recogiendo en planta").
 *
 * Regla: la PRIMERA llamada al modelo nunca lleva una conclusión del backend
 * sobre qué preguntó el cliente. Si el modelo necesita un dato, lo pide
 * (consultar_producto / consultar_medio_pago) y el backend responde desde datos.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoDePedidosMock = vi.fn();
const catalogoDeMock = vi.fn();
vi.mock("@/server/catalog/queries", () => ({
  catalogoDePedidos: (...a: unknown[]) => catalogoDePedidosMock(...a),
  catalogoDe: (...a: unknown[]) => catalogoDeMock(...a),
}));

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: vi.fn(),
  catalogoParaPrompt: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn(),
  disponibilidadRealMultiple: vi.fn(),
  estaEntreLosOfrecidos: () => Promise.resolve({ ok: true }),
  registrarOfrecidos: () => Promise.resolve(),
  limpiarOfrecidos: () => Promise.resolve(),
}));

vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" }),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

const selectQueue: unknown[][] = [];
const inserted: { table: unknown; values: Record<string, unknown> }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

function conversacion(organizationId: string, id = "cv_1") {
  return {
    id,
    organizationId,
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil(
  organizationId: string,
  opts: { consultasVerificadasEnabled: boolean; catalogSource?: string; ficha?: string }
) {
  return {
    id: `agp_${organizationId}`,
    organizationId,
    enabled: true,
    appointmentsEnabled: false,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: "09:00 AM",
    hoursClose: "21:00",
    hoursDays: "1,2,3,4,5,6",
    catalogSource: opts.catalogSource ?? "tabla",
    paymentSource: opts.ficha ? "ficha" : "prompt",
    consultasVerificadasEnabled: opts.consultasVerificadasEnabled,
    ficha: opts.ficha ?? null,
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function producto(id: string, nombre: string, precioCents: number | null) {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

function mensajesDeLaLlamada(indice: number): { role: string; content: string }[] {
  return chatJson.mock.calls[indice]![1] as { role: string; content: string }[];
}


const FICHA_MALIA = JSON.stringify({ pago: { formas: "Transferencia y efectivo pero solo recogiendo en planta, para los domicilios solo recibimos transferencia", datosDeCuenta: "AHORROS 123" } });

const MENSAJES_REALES = [
  "Holaa, hoy tienes de qué sabores",
  "¿Tienen disponible torta de chocolate?",
  "¿Cuánto vale el pavé de 16 oz?",
  "¿qué sabores tienen disponibles?",
  "Entonces te puedo pagar en efectivo cuando llegue el domicilio?",
  "Es pago contra entrega verdad ?",
  "¿Puedo pagar por Nequi?",
  "Y que costo tiene el domicilio?",
];

describe("el backend no interpreta al cliente antes del modelo (doc 198)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  for (const texto of MENSAJES_REALES) {
    it(`"${texto}" → la primera llamada no lleva ningún hecho ni plan inyectado por el backend`, async () => {
      const conv = conversacion("org_1");
      queueTurnoBase(
        conv,
        perfil("org_1", { consultasVerificadasEnabled: true, ficha: FICHA_MALIA }),
        historial(texto)
      );
      catalogoDePedidosMock.mockResolvedValue([producto("p1", "Pavé Cremoso 16 oz", 1800000)]);
      chatJson.mockResolvedValueOnce({ ok: true, data: { action: "reply", text: "¡Claro! 💗" }, raw: "{}" });

      const { runAgentTurn } = await import("@/server/ai/pipeline");
      await runAgentTurn(conv.id);

      const primera = mensajesDeLaLlamada(0);
      const inyectados = primera.filter(
        (m) => m.role === "user" && /\[SISTEMA\]|PLAN DEL TURNO|Esto ya está verificado/.test(m.content)
      );
      expect(inyectados.map((m) => m.content.slice(0, 120))).toEqual([]);
    });
  }

  it("cuando el MODELO pide el producto, el backend responde desde el catálogo estructurado", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", { consultasVerificadasEnabled: true }), historial("¿Tienen torta de chocolate?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    chatJson
      .mockResolvedValueOnce({ ok: true, data: { action: "consultar_producto", consulta: "torta de chocolate" }, raw: "{}" })
      .mockResolvedValueOnce({ ok: true, data: { action: "reply", text: "¡Sí! Porción Chocolate a $12.500 💗" }, raw: "{}" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const info = mensajesDeLaLlamada(1).find((m) => m.content.includes("[SISTEMA]"));
    expect(info?.content).toMatch(/Encontré "Porción Chocolate"/);
  });

  it("cuando el MODELO pregunta por un pago, recibe la política literal, sin veredicto (caso Sofía)", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true, ficha: FICHA_MALIA }),
      historial("Entonces te puedo pagar en efectivo cuando llegue el domicilio?")
    );
    catalogoDePedidosMock.mockResolvedValue([]);
    chatJson
      .mockResolvedValueOnce({ ok: true, data: { action: "consultar_medio_pago", metodo: "efectivo contra entrega" }, raw: "{}" })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Para domicilios es solo transferencia; el efectivo es al recoger en planta 💗" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    const info = mensajesDeLaLlamada(1).find((m) => m.content.includes("[SISTEMA]"));
    expect(info?.content).toContain("solo recogiendo en planta");
    expect(info?.content).not.toMatch(/SÍ está entre|con seguridad/);
    // Y nada lo obliga a cambiar una respuesta correcta: no hay más llamadas.
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
  });
});

/*
 * Para probar un cambio de conducta con el modelo real ANTES de regenerar los
 * prompts en producción: el banco de escenarios puede pasar el prompt generado
 * en memoria. Solo en conversaciones de prueba: en una real se ignora.
 */
describe("instruccionesDePrueba: prompt en memoria, solo en conversaciones de prueba", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    selectQueue.length = 0;
  });

  async function turnoCon(isTest: boolean) {
    const conv = { ...conversacion("org_1"), isTest };
    const p = { ...perfil("org_1", { consultasVerificadasEnabled: false }), instructions: "PROMPT GUARDADO" };
    queueTurnoBase(conv, p, historial("hola"));
    catalogoDePedidosMock.mockResolvedValue([]);
    chatJson.mockResolvedValueOnce({ ok: true, data: { action: "reply", text: "¡Hola! 💗" }, raw: "{}" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id, { instruccionesDePrueba: "PROMPT EN MEMORIA" });
    return mensajesDeLaLlamada(0).map((m) => m.content).join("\n");
  }

  it("en una conversación de prueba usa el prompt en memoria", async () => {
    const prompt = await turnoCon(true);
    expect(prompt).toContain("PROMPT EN MEMORIA");
    expect(prompt).not.toContain("PROMPT GUARDADO");
  });

  it("en una conversación REAL lo ignora: manda el prompt guardado", async () => {
    const prompt = await turnoCon(false);
    expect(prompt).toContain("PROMPT GUARDADO");
    expect(prompt).not.toContain("PROMPT EN MEMORIA");
  });
});
