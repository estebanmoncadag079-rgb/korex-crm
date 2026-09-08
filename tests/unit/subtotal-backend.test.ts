import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 11-C — dinero calculado por backend, contra el PIPELINE completo
 * (no solo la función pura, ya probada en `inconsistencia-financiera.test.ts`).
 * Prueba el cableado real: `conversation_state.estado.totalCents` (ya
 * calculado por `normalizarPedido` contra el catálogo real) llega hasta
 * `inconsistenciaFinancieraDePedido` como `subtotalReal`, y decide si
 * `notify_order` sale tal cual o se corrige/deriva.
 *
 * Mismo patrón de mocks que `estado-concurrencia-pipeline.test.ts`
 * (`leerEstadoConVersion`/`guardarEstado` mockeadas para poder fijar el
 * `totalCents` del carrito sin tener que simular `normalizarPedido` entero
 * contra un catálogo falso vía `db.select()`).
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

const notifyTeam = vi.fn();
const contactPhoneOf = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
  contactPhoneOf: (...a: unknown[]) => contactPhoneOf(...a),
}));

const leerEstadoConVersionMock = vi.fn();
const guardarEstadoMock = vi.fn();
vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    leerEstadoConVersion: (...a: Parameters<typeof leerEstadoConVersionMock>) =>
      leerEstadoConVersionMock(...a),
    guardarEstado: (...a: Parameters<typeof guardarEstadoMock>) => guardarEstadoMock(...a),
  };
});

const selectQueue: unknown[][] = [];

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
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
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
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

function conversacion(id = "cv_1") {
  return {
    id,
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true, // Laboratorio: notifyTeam se simula, sin efecto real de WhatsApp
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfilConEstado(overrides: Record<string, unknown> = {}) {
  return {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    appointmentsEnabled: false,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: "08:00",
    hoursClose: "23:00",
    hoursDays: "1,2,3,4,5,6,7",
    catalogSource: "tabla",
    paymentSource: "prompt",
    stateSource: "backend",
    deliverySource: "prompt",
    ficha: JSON.stringify({
      menu: { opciones: [{ id: "ver_menu", etiqueta: "Ver menú" }] },
      cierre: { requisitos: [] },
    }),
    ...overrides,
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function producto(id: string, nombre: string, precioCents: number) {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

const ITEM_RESUELTO = {
  ofrecible: { id: "p1", nombre: "Porción Chocolate" },
  cantidad: 2,
  seleccion: [],
  totalCents: 2500000, // 2 x $12.500 — el precio REAL del catálogo
};

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
  catalogoDeMock.mockReset().mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
  notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "corrida del Laboratorio" });
  contactPhoneOf.mockReset().mockResolvedValue(null);
  selectQueue.length = 0;
  leerEstadoConVersionMock.mockReset();
  guardarEstadoMock.mockReset().mockResolvedValue({ ok: true });
});

describe("Fase 11-C: el backend calcula el subtotal — pipeline completo, tenant con state_source='backend'", () => {
  it("10/1/2: subtotal PROPUESTO coincide con el carrito real (2 Porción Chocolate x $12.500) -> notify_order sale sin fricción", async () => {
    const conv = conversacion();
    queueTurnoBase(conv, perfilConEstado(), [
      ...historial("Confirmo 2 porciones de chocolate"),
      { id: "msg_0", direction: "out", text: "💰 Total: $25.000. ¿Confirmas?", createdAt: new Date() },
    ]);
    leerEstadoConVersionMock.mockResolvedValue({
      estado: {
        schema_version: 5,
        items: [ITEM_RESUELTO],
        datos: {},
        paso: "confirmado",
        confirmado: true,
        totalCents: 2500000, // el backend YA calculó $25.000
      },
      version: 1,
    });
    const cierreCorrecto = {
      action: "notify_order",
      summary: "2 Porción Chocolate — Total: $25.000",
      subtotalCents: 2500000,
      totalCents: 2500000,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierreCorrecto, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(action?.action).toBe("notify_order");
  });

  it("5/6/CRITICAL: el LLM propone un subtotal INCORRECTO ($20.000 en vez de los $25.000 reales) -> se rechaza, nunca sale así", async () => {
    const conv = conversacion();
    queueTurnoBase(conv, perfilConEstado(), [
      ...historial("Confirmo 2 porciones de chocolate"),
      { id: "msg_0", direction: "out", text: "💰 Total: $20.000. ¿Confirmas?", createdAt: new Date() },
    ]);
    leerEstadoConVersionMock.mockResolvedValue({
      estado: {
        schema_version: 5,
        items: [ITEM_RESUELTO],
        datos: {},
        paso: "confirmado",
        confirmado: true,
        totalCents: 2500000, // el backend sabe que son $25.000
      },
      version: 1,
    });
    const cierreEquivocado = {
      action: "notify_order",
      summary: "2 Porción Chocolate — Total: $20.000",
      subtotalCents: 2000000, // el modelo se equivocó
      totalCents: 2000000,
    };
    // Insiste con el mismo número equivocado tras la corrección.
    chatJson
      .mockResolvedValueOnce({ ok: true, data: cierreEquivocado, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: cierreEquivocado, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Nunca sale como notify_order con el subtotal equivocado: se deriva a
    // una persona en vez de dejarlo pasar. `notifyTeam` SÍ se llama para
    // avisar de la derivación (aviso genérico de handoff) — lo que nunca
    // debe pasar es que el subtotal equivocado ($20.000) llegue en ese aviso.
    expect(action?.action).toBe("handoff");
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining("$20.000") })
    );
  });

  it("9/legacy: SIN carrito estructurado resuelto (state_source='backend' pero el turno todavía no tiene un `estadoGuardado` con totalCents) -> ningún chequeo nuevo se activa", async () => {
    const conv = conversacion();
    queueTurnoBase(conv, perfilConEstado(), [
      ...historial("Confirmo mi pedido"),
      { id: "msg_0", direction: "out", text: "💰 Total: $9.999. ¿Confirmas?", createdAt: new Date() },
    ]);
    // Sin fila guardada todavía: `estadoGuardado` queda `null` en el turno.
    leerEstadoConVersionMock.mockResolvedValue(null);
    const cierre = {
      action: "notify_order",
      summary: "Pedido confirmado — Total: $9.999", // cifra libre, sin carrito que la contradiga
      subtotalCents: 999900,
      totalCents: 999900,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Comportamiento de siempre (Fase 10N-J): solo se exige que la
    // aritmética interna cuadre, nada estructurado que verificar contra el
    // catálogo porque el backend todavía no tiene un carrito resuelto.
    expect(action?.action).toBe("notify_order");
  });
});
