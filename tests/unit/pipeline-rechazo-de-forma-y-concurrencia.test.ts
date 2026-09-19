import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T030-A (auditoría de Feature 003, 16-sep-2026) — el mismo aviso al modelo
 * que ya existe para un rechazo de NEGOCIO (Fase 8J, Compuerta 2/3:
 * `pipeline-propuesta-rechazada.test.ts`) faltaba en dos casos donde
 * `guardarEstadoPropuesto` también descarta el lote sin persistir nada:
 *
 * 1. Compuerta 1 (Zod rechaza la FORMA del array completo — un `tipo` que no
 *    existe en la unión, como el "cancelar" retirado en T007).
 * 2. Conflicto de versión (`guardarEstado` pierde la carrera de escritura
 *    porque otra ejecución viva de la misma conversación ya guardó después).
 *
 * En ambos, antes de este fix, la función devolvía `null` sin `rechazo`, así
 * que el chequeo de `pipeline.ts` (`estadoRecienGuardado?.rechazo`) no
 * disparaba el reintento — el cliente recibía el texto que el modelo ya
 * había escrito ANTES de saber que el backend descartó su propuesta.
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

const PAVE = {
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
    ficha: JSON.stringify({ cierre: { requisitos: [] } }),
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
  leerEstadoConVersionMock.mockReset().mockResolvedValue(null);
  guardarEstadoMock.mockReset().mockResolvedValue({ ok: true });
});

describe("Compuerta 1 (forma inválida): también avisa al modelo antes de responder", () => {
  it("un tipo de operación que no existe en la unión (p.ej. 'cancelar', retirado en T007) dispara el reintento, no sale el texto original", async () => {
    queueTurnoBase("cancela todo mi pedido");
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "reply",
          // El modelo YA da por hecho el cancelado, antes de que el backend
          // dijera nada — esto es exactamente lo que no debe salir así.
          text: "¡Listo, cancelé todo tu pedido!",
          operaciones: [{ tipo: "cancelar" }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "No puedo cancelar así — escribe 0 para empezar de cero." },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    // Nunca se guardó nada: Compuerta 1 rechazó el array completo.
    expect(guardarEstadoMock).not.toHaveBeenCalled();
    // El mecanismo de reintento (Fase 8J) SÍ se disparó para este caso, igual
    // que ya lo hace para un rechazo de Compuerta 2/3.
    expect(chatJson).toHaveBeenCalledTimes(2);
    // Y lo que sale es la respuesta corregida, no la que daba el cancelado
    // por hecho.
    expect(action?.action).toBe("reply");
    expect((action as { text: string }).text).not.toContain("cancelé");
  });
});

describe("Conflicto de versión: también avisa al modelo antes de responder", () => {
  it("si guardarEstado pierde la carrera, el modelo se entera y no repite lo que había propuesto como si hubiera quedado guardado", async () => {
    queueTurnoBase("quiero un pavé de chocolate y confirmo");
    leerEstadoConVersionMock.mockResolvedValue({
      estado: { schema_version: 5, items: [], datos: {}, paso: "sin pedido", confirmado: false },
      version: 3,
    });
    // Simula que OTRA ejecución viva ya escribió una versión más nueva
    // mientras este turno seguía en curso.
    guardarEstadoMock.mockResolvedValue({ ok: false });
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "reply",
          text: "¡Listo, agregué el pavé y quedó confirmado!",
          operaciones: [
            { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 },
            { tipo: "confirmar" },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "Dame un segundo, ¿me repites qué quieres pedir?" },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    // Perder la carrera sigue sin fabricar un guardado que no ocurrió.
    expect(guardarEstadoMock).toHaveBeenCalledTimes(1);
    // Pero ahora SÍ se le avisa al modelo antes de responder.
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
    expect((action as { text: string }).text).not.toContain("confirmado");
  });
});
