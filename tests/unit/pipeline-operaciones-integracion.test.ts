import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T016 (feature 003-backend-como-autoridad) — test de integración con el
 * pipeline mockeado, la última tarea de la Fase 3 (US2). Dos garantías que
 * no tenían prueba de punta a punta hasta ahora:
 *
 * 1. Un turno que SOLO cambia un dato (`fijar_dato`) no toca los ítems ya
 *    guardados — la ventaja central de operaciones sobre "reescribe el
 *    estado completo cada turno" (`spec.md`, US2 criterio #2).
 * 2. Una operación que nombra un producto inexistente rechaza en la
 *    Compuerta 2 (resuelve contra datos reales), no en la Compuerta 1 (Zod,
 *    que solo mira la forma: `tipo` válido, campos del tipo correcto). Un
 *    `agregar_item` con `ofrecible` inventado tiene forma perfectamente
 *    válida — el rechazo tiene que venir de más adelante.
 *
 * Mismo patrón de mocks y de estado simulado entre turnos que
 * `pipeline-confirmado-sin-cierre.test.ts` (`estadoActual`/
 * `leerEstadoConVersionMock` como si fuera la fila real de
 * `conversation_state`, para poder encadenar dos `runAgentTurn` y observar
 * qué sobrevive de un turno a otro).
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
  listStaff: vi.fn().mockResolvedValue([]),
  estaEntreLosOfrecidos: () => Promise.resolve({ ok: true }),
  registrarOfrecidos: () => Promise.resolve(),
  limpiarOfrecidos: () => Promise.resolve(),
}));

vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "prueba" }),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

/** El "estado guardado" simulado — como si fuera la fila de conversation_state. */
let estadoActual: unknown = null;
let versionActual = 0;
const guardarEstadoCalls: { estado: Record<string, unknown> }[] = [];
const guardarEstadoMock = vi.fn(async (entrada: { estado: Record<string, unknown> }) => {
  guardarEstadoCalls.push(entrada);
  estadoActual = entrada.estado;
  versionActual += 1;
  return { ok: true };
});
const leerEstadoConVersionMock = vi.fn(async () =>
  estadoActual ? { estado: estadoActual, version: versionActual } : null
);

vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    guardarEstado: (...a: Parameters<typeof guardarEstadoMock>) => guardarEstadoMock(...a),
    leerEstadoConVersion: (...a: Parameters<typeof leerEstadoConVersionMock>) =>
      leerEstadoConVersionMock(...a),
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
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const PAVE: { id: string; nombre: string; categoria: null; precioCents: number; descripcion: null; grupos: unknown[] } = {
  id: "p1",
  nombre: "Pavé chocolate",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
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
    ficha: JSON.stringify({ cierre: { requisitos: [{ id: "direccion", tipo: "direccion", etiqueta: "tu dirección", obligatorio: true }] } }),
  };
}

function queueTurnoBase(texto: string) {
  selectQueue.push(
    [conversacion()],
    [perfil()],
    [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }],
    [],
    [],
    [],
    []
  );
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([PAVE]);
  catalogoDeMock.mockReset().mockResolvedValue([PAVE]);
  selectQueue.length = 0;
  guardarEstadoCalls.length = 0;
  guardarEstadoMock.mockClear();
  leerEstadoConVersionMock.mockClear();
  estadoActual = null;
  versionActual = 0;
});

describe("T016 — integración: un turno que solo cambia un dato no toca los ítems", () => {
  it("turno 1 agrega un ítem; turno 2 solo fija la dirección — el ítem del turno 1 sigue intacto", async () => {
    const { runAgentTurn } = await import("@/server/ai/pipeline");

    // Turno 1: agrega un pavé.
    queueTurnoBase("quiero un pavé de chocolate");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo! ¿Algo más?",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(1);
    const items1 = guardarEstadoCalls[0]!.estado.items as unknown[];
    expect(items1).toHaveLength(1);

    // Turno 2: SOLO fija la dirección — ninguna operación toca items.
    queueTurnoBase("mi dirección es Cra 1 # 2-3");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "Anotado, ¿algo más?",
        operaciones: [{ tipo: "fijar_dato", requisitoId: "direccion", valor: "Cra 1 # 2-3" }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(2);
    const estadoTras2 = guardarEstadoCalls[1]!.estado as { items: unknown[]; datos: Record<string, string> };
    // El ítem del turno 1 sigue exactamente igual — ninguna Operacion del
    // turno 2 lo mencionó, así que aplicarOperaciones nunca lo tocó.
    expect(estadoTras2.items).toEqual(items1);
    expect(estadoTras2.datos.direccion).toBe("Cra 1 # 2-3");
  });

  it("Compuerta 2, no Compuerta 1: un `agregar_item` bien formado pero con un producto que no existe rechaza al resolver, no al parsear", async () => {
    queueTurnoBase("quiero una torta voladora");
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "reply",
          text: "¡Claro! Te anoto la torta voladora 🎂",
          // Forma perfectamente válida para Zod/Compuerta 1: `tipo` es uno de
          // los permitidos, `ofrecible`/`opciones`/`cantidad` tienen el tipo
          // correcto. El rechazo SOLO puede venir de resolver el nombre
          // contra el catálogo real (Compuerta 2) — nunca existió una "torta
          // voladora" en `PAVE`.
          operaciones: [{ tipo: "agregar_item", ofrecible: "Torta voladora", opciones: [], cantidad: 1 }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "No tenemos torta voladora, ¿quieres un Pavé chocolate?" },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    // Nunca se llegó a guardar nada: el lote entero (una sola operación)
    // falló su Compuerta 2, y `guardarEstado` no se llama en absoluto.
    expect(guardarEstadoMock).not.toHaveBeenCalled();
    // El mecanismo de reintento (T015) sí se disparó con el motivo real.
    expect(chatJson).toHaveBeenCalledTimes(2);
    const correccion = (chatJson.mock.calls[1]![1] as { content: string }[]).at(-1)!.content;
    expect(correccion).toContain("Torta voladora");
  });
});
