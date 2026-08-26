import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de `consultar_producto` / `consultar_medio_pago`
 * (docs/korexia/142): el mismo patrón de `consult_availability`, clonado
 * para el vertical de pedidos. Nace del incidente real de Lis
 * (25-ago-2026, "¿Tienen torta de chocolate?") y del caso Nequi
 * (24-ago-2026): antes de esto, el modelo decidía estos hechos leyendo
 * prosa; ahora se los pide al servidor y los recibe verificados, en el
 * mismo turno.
 *
 * Mismo patrón de mocks que pipeline-niega-disponibilidad.test.ts.
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

function perfil(organizationId: string, pagoFormas: string) {
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
    catalogSource: "tabla",
    paymentSource: "ficha",
    ficha: JSON.stringify({ pago: { formas: pagoFormas } }),
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function producto(id: string, nombre: string, precioCents: number | null) {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

/** Encola las 7 lecturas que hace `runAgentTurn` antes de llegar a la lógica de acciones. */
function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

describe("runAgentTurn: consultar_producto / consultar_medio_pago (docs/korexia/142)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("producto encontrado: no escala, confirma con el precio real y no lo pone en duda", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Transferencia bancaria"), historial("¿Tienen torta de chocolate?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1500000)]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "torta de chocolate" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Claro que sí! Tenemos Porción Chocolate a $15.000." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(catalogoDePedidosMock).toHaveBeenCalledWith("org_1");
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/Porción Chocolate/);

    // El [SISTEMA] que vio el modelo confirmó el hecho real, sin ambigüedad.
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/Encontré "Porción Chocolate"/);
  });

  it("producto no encontrado: no inventa que lo tienen", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Transferencia bancaria"), historial("¿Tienen torta red velvet?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1500000)]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "torta red velvet" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "Por ahora no manejamos ese sabor, pero puedo confirmarte con el equipo.",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No encontré "torta red velvet"/);
    expect(action?.action).toBe("reply");
  });

  it("múltiples coincidencias: pregunta cuál en vez de asumir uno", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Transferencia bancaria"), historial("quiero el especial"));
    catalogoDePedidosMock.mockResolvedValue([
      producto("x", "Combo Familiar Grande", 3000000),
      producto("y", "Combo Grande Familiar", 3200000),
    ]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "grande familiar combo ya" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¿Cuál de los dos combos te sirve: el Grande o el Familiar?" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/varios productos/);
  });

  it("método de pago permitido (Nequi ~ transferencia): lo confirma con seguridad", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Transferencia bancaria"), historial("¿Aceptan Nequi?"));
    catalogoDePedidosMock.mockResolvedValue([]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_medio_pago", metodo: "Nequi" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí! Con Nequi puedes pagar sin problema." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/SÍ está entre las formas de pago/);
  });

  it("método de pago NO permitido: lo rechaza contradiciendo el guardarraíl y lo corrige", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Solo efectivo"), historial("¿Aceptan tarjeta de crédito?"));
    catalogoDePedidosMock.mockResolvedValue([]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_medio_pago", metodo: "tarjeta de crédito" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "No manejamos tarjeta de crédito, solo efectivo. ¿Te sirve así?",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/NO está entre las formas de pago/);
  });

  it("aislamiento multi-tenant: la consulta de una organización nunca ve el catálogo de otra", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Transferencia bancaria"), historial("¿Tienen combo especial fresa?"));
    catalogoDePedidosMock.mockImplementation(async (orgId: string) => {
      if (orgId === "org_1") return [producto("p1", "Porción Chocolate", 1500000)];
      if (orgId === "org_2") return [producto("p2", "Combo Especial Fresa", 2000000)];
      return [];
    });

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "combo especial fresa" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Por ahora no manejamos ese producto." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    // Se consultó SOLO con el organizationId de esta conversación (org_1) —
    // nunca con org_2, aunque el catálogo de org_2 sí tenga ese producto.
    expect(catalogoDePedidosMock).toHaveBeenCalledWith("org_1");
    expect(catalogoDePedidosMock).not.toHaveBeenCalledWith("org_2");
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No encontré "combo especial fresa"/);
  });

  it("consultó, el sistema confirmó que SÍ existe, pero el modelo igual dijo que no: se corrige solo", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", "Transferencia bancaria"), historial("¿Tienen torta de chocolate?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1500000)]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "torta de chocolate" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Ay, disculpa, no tenemos porción chocolate en este momento." },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí, claro! Tenemos Porción Chocolate a $15.000." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(3);
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/Porción Chocolate/);

    const terceraLlamada = chatJson.mock.calls[2]![1] as { role: string; content: string }[];
    const correccion = terceraLlamada.find((m) => m.content.includes("ALTO."));
    expect(correccion?.content).toMatch(/SÍ existe el producto/);
  });
});
