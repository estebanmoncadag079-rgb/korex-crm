import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recuperación de salidas parcialmente válidas del LLM (docs/korexia/144).
 *
 * Nace de un hallazgo de la prueba controlada con Lis: "Hola, buenas
 * noches" escaló a una persona el 71% de las veces porque el modelo elegía
 * bien `send_menu` pero omitía `reply` de forma intermitente, y el camino
 * de la Fase 2 (`chatJsonConEstado`, que valida `AgentAction` DESPUÉS de
 * que `chatJson` ya dio la llamada por buena contra un esquema laxo) no
 * tenía ninguna red de reintentos para eso — a diferencia del camino sin
 * Fase 2, que sí reintenta hasta 3 veces dentro de `chatJson`.
 *
 * Mismo patrón de mocks que pipeline-forzar-consulta-factual.test.ts, con
 * `stateSource: "backend"` (como Lis) para ejercitar `chatJsonConEstado`.
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

/** Perfil con Fase 2 encendida (`state_source='backend'`), como Lis. */
function perfilConEstado(organizationId: string) {
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
    paymentSource: "prompt",
    stateSource: "backend",
    consultasVerificadasEnabled: false,
    ficha: JSON.stringify({ menu: { opciones: [{ id: "ver_menu", etiqueta: "Ver menú" }] } }),
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

/** El objeto que responde el mock de chatJson en el camino CON estado. */
function respuestaConEstado(accion: Record<string, unknown>) {
  return {
    ok: true,
    raw: "{}",
    data: {
      ...accion,
      estado: {
        items: [],
        datos: {},
        paso: "sin pedido",
        confirmado: false,
      },
    },
  };
}

describe("recuperación de salidas parcialmente válidas del LLM (docs/korexia/144)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    catalogoDeMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("CASO 1 — send_menu con reply: ejecuta normal, una sola llamada", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("Hola, buenas noches"));
    chatJson.mockResolvedValueOnce(
      respuestaConEstado({ action: "send_menu", tipo: "intenciones", reply: "¡Hola! ¿En qué te ayudo?" })
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("send_menu");
  });

  it("CASO 2 — send_menu SIN reply: ya no rechaza la acción, no hay reintento, no hay handoff", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("Hola, buenas noches"));
    // Exactamente el caso real observado: `send_menu` sin `reply`.
    chatJson.mockResolvedValueOnce(
      respuestaConEstado({ action: "send_menu", tipo: "intenciones" })
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Una sola llamada: la acción es válida desde el primer intento, no hace
    // falta ningún reintento — el fallback vive en el ejecutor del menú.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("send_menu");
    const handoffLlamado = inserted.some((i) =>
      String((i.values as { text?: string }).text ?? "").includes("Te comunico con una persona")
    );
    expect(handoffLlamado).toBe(false);
  });

  it("CASO 4/2-NIVEL2 — reply sin text (campo central, no recuperable con normalización): reintenta UNA vez y se recupera", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("¿Qué me recomiendas?"));
    // Primera llamada (con estado): "reply" sin "text" — inválida de verdad,
    // no es un campo auxiliar como `send_menu.reply`.
    chatJson
      .mockResolvedValueOnce(respuestaConEstado({ action: "reply" }))
      // El reintento de `chatJsonConEstado` llama a `chatJson(AgentAction, ...)`
      // sin jsonSchema, y el modelo corrige.
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "Te recomiendo el Mini Box." },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toBe("Te recomiendo el Mini Box.");
  });

  it("CASO 5 — la regeneración falla también: respeta el límite (una sola vez) y no hace loop, cae a handoff", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("¿Qué me recomiendas?"));
    chatJson
      .mockResolvedValueOnce(respuestaConEstado({ action: "reply" }))
      // El reintento también falla (y agota sus propios 3 sub-intentos
      // internos de `chatJson`, ya cubiertos por ai-adapter.test.ts — aquí
      // solo importa que `chatJsonConEstado` no reintente una segunda vez).
      .mockResolvedValue({
        ok: false,
        error: "invalid_output",
        detail: "no cumple el esquema: text Required",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Exactamente 2 llamadas visibles desde aquí: la de estado + el ÚNICO
    // reintento acotado. `chatJsonConEstado` no vuelve a intentar una tercera vez.
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("handoff");
    expect((action as { reason?: string })?.reason).toBe("error");
  });

  it("CASO 6 — error real del proveedor (not_configured no aplica aquí): sigue el manejo de error existente", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("Hola"));
    chatJson.mockResolvedValueOnce({
      ok: false,
      error: "provider_error",
      detail: "proveedor respondió 500: fallo interno",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Un error real del proveedor (no una salida parcial) no pasa por
    // `chatJsonConEstado` en absoluto: `bruto.ok` ya es false desde `chatJson`.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("handoff");
    expect((action as { reason?: string })?.reason).toBe("error");
  });

  it("CASO 3 — acción desconocida: mantiene el comportamiento seguro (rechaza, reintenta, eventual handoff)", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("hola"));
    chatJson
      .mockResolvedValueOnce(respuestaConEstado({ action: "enviar_promocion", codigo: "PROMO10" }))
      .mockResolvedValue({
        ok: false,
        error: "invalid_output",
        detail: "no cumple el esquema: action Invalid discriminator value",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("handoff");
  });

  it("CASO 7 — regresión de productos: la consulta que pide el modelo funciona con Fase 2 encendida", async () => {
    const conv = conversacion("org_1");
    const perfil = { ...perfilConEstado("org_1"), consultasVerificadasEnabled: true };
    queueTurnoBase(conv, perfil, historial("¿Tienen torta de chocolate?"));
    // Doc 198: la consulta la pide el MODELO (el backend ya no adivina la
    // pregunta); el catálogo estructurado responde igual con el estado encendido.
    chatJson
      .mockResolvedValueOnce(respuestaConEstado({ action: "consultar_producto", consulta: "torta de chocolate" }))
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí! Tenemos Porción Chocolate a $12.500." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    const primeraLlamada = chatJson.mock.calls[0]![1] as { role: string; content: string }[];
    expect(primeraLlamada.some((m) => m.content.includes("Encontré"))).toBe(false);
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/Encontré "Porción Chocolate"/);
    expect(action?.action).toBe("reply");
  });
});
