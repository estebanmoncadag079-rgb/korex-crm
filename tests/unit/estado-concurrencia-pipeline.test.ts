import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Programa de mejora integral, Prioridad 3 — `conversation_state` no tenía
 * NINGUNA protección de concurrencia (a diferencia de `agent_job`, que ya
 * tiene el token `generation` desde la Fase 10Q): dos ejecuciones vivas de
 * `runAgentTurn` para la MISMA conversación (posible tras un rescate de
 * huérfanos que reasigna un turno que en realidad seguía vivo, ver
 * `HUERFANO_TRAS_MS` en `cola.ts`) podían escribir la una encima de la otra
 * sin que nada lo detectara.
 *
 * Este test verifica el CABLEADO en `pipeline.ts`: que el turno lee la
 * versión al empezar (`leerEstadoConVersion`) y la pasa como
 * `versionEsperada` al guardar (`guardarEstado`), y que si esa escritura
 * pierde la carrera (`{ok:false}`, simulado aquí — la semántica real de
 * Postgres se prueba en tests/integration/estado-concurrencia.test.ts, no
 * ejecutado en esta sesión por falta de TEST_DATABASE_URL), el turno NO se
 * cae y NO finge que su propuesta quedó guardada.
 *
 * Mismo patrón de mocks que pipeline-confirmado-sin-cierre.test.ts.
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
      values: () => {
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([{}]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
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
    ficha: JSON.stringify({
      menu: { opciones: [{ id: "ver_menu", etiqueta: "Ver menú" }] },
      cierre: { requisitos: [] },
    }),
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

describe("conversation_state: token de concurrencia (Prioridad 3)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    catalogoDeMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    selectQueue.length = 0;
    leerEstadoConVersionMock.mockReset();
    guardarEstadoMock.mockReset();
  });

  it("lee la versión al empezar el turno y la pasa a guardarEstado como versionEsperada", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("Quiero una Porción Chocolate"));
    leerEstadoConVersionMock.mockResolvedValue({
      estado: { schema_version: 5, items: [], datos: {}, paso: "sin pedido", confirmado: false },
      version: 7,
    });
    guardarEstadoMock.mockResolvedValue({ ok: true });
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¿Algo más?",
        // Feature 003: `operaciones: []` significa "nada cambia" y ya no
        // llama a `guardarEstado` (optimización correcta: no hay nada que
        // escribir). Este test verifica el cableado de concurrencia
        // (`versionEsperada`), así que necesita una operación real que sí
        // dispare la escritura — `confirmar` no depende del catálogo.
        operaciones: [{ tipo: "confirmar" }],
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(leerEstadoConVersionMock).toHaveBeenCalledWith("cv_1", "org_1");
    expect(guardarEstadoMock).toHaveBeenCalledWith(
      expect.objectContaining({ versionEsperada: 7 })
    );
  });

  it("BUG REAL corregido: si guardarEstado pierde la carrera ({ok:false}), el turno sigue normal — no se cae, no fabrica un guardado que no ocurrió", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("Quiero una Porción Chocolate"));
    leerEstadoConVersionMock.mockResolvedValue({
      estado: { schema_version: 5, items: [], datos: {}, paso: "sin pedido", confirmado: false },
      version: 3,
    });
    // Simula que OTRA ejecución viva ya escribió una versión más nueva
    // mientras este turno seguía en curso: la escritura se descarta.
    guardarEstadoMock.mockResolvedValue({ ok: false });
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Genial! ¿Necesitas algo más?",
        operaciones: [
          { tipo: "agregar_item", ofrecible: "Porción Chocolate", opciones: [], cantidad: 1 },
          { tipo: "confirmar" },
        ],
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // El turno responde con normalidad al cliente pese a perder la carrera
    // de escritura del estado — eso nunca debe convertirse en una excepción
    // ni en un turno perdido.
    expect(action?.action).toBe("reply");
    // Como la propia guardarEstado ya reportó {ok:false}, la corrección de
    // "confirmado sin cierre" NO debe intentar escribir por encima: no hay
    // nada nuestro que corregir, la fila es de la otra ejecución. Una sola
    // llamada, no dos.
    expect(guardarEstadoMock).toHaveBeenCalledTimes(1);
  });
});
