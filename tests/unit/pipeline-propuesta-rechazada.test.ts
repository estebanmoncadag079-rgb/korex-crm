import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8J — el carrito que el backend RECHAZA deja de ser invisible para el
 * modelo, contra el PIPELINE completo (la redacción de la corrección se
 * prueba aparte, en `propuesta-rechazada.test.ts`).
 *
 * Incidente real (MALIA, 8-sep-2026, conv cv_2xfh67lig9a07xzief96): la
 * clienta pidió un "pavé de oblea"; "Oblea" no es una opción de ese producto.
 * El backend rechazó el carrito cinco veces y cada rechazo se descartaba en
 * silencio, así que el modelo siguió armando un pedido imposible hasta que
 * el guardarraíl financiero lo frenó al cerrar — derivación y pedido perdido.
 *
 * Mismo scaffold de mocks que `subtotal-backend.test.ts`, con el catálogo
 * REAL de validación (`aplicarOperaciones`/`orders/operaciones.ts` sin
 * mockear, feature 003 T007/T013/T014): el rechazo lo produce de verdad el
 * backend, no un mock que lo simule.
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
  notifyTeam: vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "prueba" }),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

const leerEstadoConVersionMock = vi.fn();
const guardarEstadoMock = vi.fn();
vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    leerEstadoConVersion: (...a: unknown[]) => leerEstadoConVersionMock(...a),
    guardarEstado: (...a: unknown[]) => guardarEstadoMock(...a),
  };
});

const selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
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
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

/** El catálogo REAL de MALIA, con el grupo de sabores donde "Oblea" no existe. */
const PAVE_8OZ = {
  id: "p1",
  nombre: "Pavé Cremoso 8 oz",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [
    {
      id: "g1",
      nombre: "Sabor",
      minSelect: 1,
      maxSelect: 1,
      permiteRepeticion: false,
      opciones: [
        { id: "o1", nombre: "Maracuyá", precioDeltaCents: 0 },
        { id: "o2", nombre: "Fresas con crema", precioDeltaCents: 0 },
      ],
    },
  ],
};

function conversacion(id = "cv_1") {
  return {
    id,
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil() {
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
    ficha: JSON.stringify({ cierre: { requisitos: [] } }),
  };
}

function queueTurnoBase() {
  selectQueue.push(
    [conversacion()],
    [perfil()],
    [{ id: "msg_1", direction: "in", text: "quiero el pavé de oblea de 8 oz", createdAt: new Date() }],
    [],
    [],
    [],
    []
  );
}

/** Lo que el modelo propuso: un sabor que NO existe en el catálogo real. */
const PROPUESTA_INVALIDA = {
  action: "reply",
  text: "¡Listo! Te anoto el Pavé Cremoso 8 oz de Oblea 🍮",
  operaciones: [
    {
      tipo: "agregar_item",
      ofrecible: "Pavé Cremoso 8 oz",
      cantidad: 1,
      opciones: [{ grupo: "Sabor", opcion: "Oblea" }],
    },
  ],
};

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([PAVE_8OZ]);
  catalogoDeMock.mockReset().mockResolvedValue([PAVE_8OZ]);
  selectQueue.length = 0;
  leerEstadoConVersionMock.mockReset().mockResolvedValue(null);
  guardarEstadoMock.mockReset().mockResolvedValue({ ok: true });
});

describe("Fase 8J: el rechazo del carrito llega al modelo antes de responderle al cliente", () => {
  it("BUG REAL: opción inexistente -> se le avisa al modelo y se usa SU respuesta corregida", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: PROPUESTA_INVALIDA, raw: JSON.stringify(PROPUESTA_INVALIDA) })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "De 8 oz manejamos Maracuyá y Fresas con crema. ¿Cuál prefieres?",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    // Hubo una segunda llamada: la corrección.
    expect(chatJson).toHaveBeenCalledTimes(2);
    const correccion = (chatJson.mock.calls[1]![1] as { content: string }[]).at(-1)!.content;
    expect(correccion).toContain("no está entre las opciones de Pavé Cremoso 8 oz");
    expect(correccion).toMatch(/Maracuy|Fresas con crema/);

    // Y lo que sale es la respuesta corregida, no la que inventaba el sabor.
    expect(action?.action).toBe("reply");
    expect((action as { text: string }).text).toMatch(/Maracuyá y Fresas con crema/);
  });

  it("una propuesta VÁLIDA no gasta ninguna llamada de más", async () => {
    queueTurnoBase();
    const valida = {
      action: "reply",
      text: "¡Listo! Pavé Cremoso 8 oz de Maracuyá 🍮",
      operaciones: [
        {
          tipo: "agregar_item",
          ofrecible: "Pavé Cremoso 8 oz",
          cantidad: 1,
          opciones: [{ grupo: "Sabor", opcion: "Maracuyá" }],
        },
      ],
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: valida, raw: JSON.stringify(valida) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect((action as { text: string }).text).toContain("Maracuyá");
  });

  it("si el reintento falla en el proveedor, el turno sigue como antes: NUNCA deriva por esto", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: PROPUESTA_INVALIDA, raw: JSON.stringify(PROPUESTA_INVALIDA) })
      .mockResolvedValueOnce({ ok: false, error: "provider_error", detail: "timeout" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("reply");
    expect(action?.action).not.toBe("handoff");
  });
});

/**
 * FASE 4 — el reintento recupera el ESTADO, no solo el texto.
 *
 * Antes, cuando el backend rechazaba la propuesta, el reintento recuperaba el
 * reply que el modelo redactaba, pero NO volvía a persistir las operaciones —
 * así que un pedido corregido en el segundo intento quedaba sin guardarse
 * (`conversation_state` vacío). Regla de consistencia: una respuesta textual no
 * sustituye una mutación de estado.
 */
const OPERACION_VALIDA = {
  action: "reply",
  text: "¡Listo! Pavé Cremoso 8 oz de Maracuyá 🍮",
  operaciones: [
    { tipo: "agregar_item", ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, opciones: [{ grupo: "Sabor", opcion: "Maracuyá" }] },
  ],
};

describe("FASE 4: el reintento persiste la corrección estructurada", () => {
  it("reintento con operación VÁLIDA → el pedido se persiste (no solo el texto)", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: PROPUESTA_INVALIDA, raw: JSON.stringify(PROPUESTA_INVALIDA) })
      .mockResolvedValueOnce({ ok: true, data: OPERACION_VALIDA, raw: JSON.stringify(OPERACION_VALIDA) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(guardarEstadoMock).toHaveBeenCalledTimes(1);
    const estado = guardarEstadoMock.mock.calls[0]![0].estado as { items: { ofrecible: { nombre: string } }[] };
    expect(estado.items).toHaveLength(1);
    expect(estado.items[0]!.ofrecible.nombre).toMatch(/Pavé Cremoso 8 oz/);
  });

  it("reintento OTRA VEZ inválido → NO persiste, estado anterior conservado, sin tercer intento", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: PROPUESTA_INVALIDA, raw: JSON.stringify(PROPUESTA_INVALIDA) })
      .mockResolvedValueOnce({ ok: true, data: PROPUESTA_INVALIDA, raw: JSON.stringify(PROPUESTA_INVALIDA) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2); // un solo reintento, no tres
    expect(guardarEstadoMock).not.toHaveBeenCalled();
  });

  it("reintento SOLO texto → no se marca el estado como cambiado", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: PROPUESTA_INVALIDA, raw: JSON.stringify(PROPUESTA_INVALIDA) })
      .mockResolvedValueOnce({ ok: true, data: { action: "reply", text: "De 8 oz manejamos Maracuyá y Fresas con crema. ¿Cuál prefieres?" }, raw: "{}" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(guardarEstadoMock).not.toHaveBeenCalled();
  });

  it("no duplica: una propuesta VÁLIDA a la primera guarda UNA sola vez y sin reintento", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValueOnce({ ok: true, data: OPERACION_VALIDA, raw: JSON.stringify(OPERACION_VALIDA) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(guardarEstadoMock).toHaveBeenCalledTimes(1);
  });
});
