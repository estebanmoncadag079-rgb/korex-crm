import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F1 — que la capa de intención la use el pipeline de verdad.
 *
 * `src/server/orders/intencion.ts` se escribió el 15-ago-2026, con sus pruebas
 * en verde, y hasta el 24-sep **no lo importaba nadie más que su propio test**.
 * Código muerto con cobertura del 100%: lo peor de los dos mundos, porque la
 * suite decía "esto funciona" mientras en producción seguía pasando el caso
 * que vino a resolver (MALIA, conv cv_zgm286k69bz1hmprf87a):
 *
 *     17:15:42  CLIENTE  Y que costo tiene el domicilio?
 *     17:15:58  BOT      Perfecto 😊 ¿Qué quieres y cuántos?
 *
 * Por eso estas pruebas NO llaman a `leerIntencion`: llaman a `runAgentTurn` y
 * miran el prompt que de verdad recibió el modelo. Un test que importara el
 * módulo directamente volvería a pasar aunque el pipeline lo desconectara —
 * que es exactamente como llegamos hasta aquí.
 *
 * Mismo patrón de mocks que `pipeline-operaciones-integracion.test.ts`.
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
  catalogoParaPrompt: vi.fn().mockResolvedValue([]),
  proximasFechasConCupoMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn().mockResolvedValue([]),
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

let estadoActual: unknown = null;
let versionActual = 0;
const leerEstadoConVersionMock = vi.fn(async () =>
  estadoActual ? { estado: estadoActual, version: versionActual } : null
);
vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    guardarEstado: vi.fn(async () => ({ ok: true })),
    leerEstadoConVersion: () => leerEstadoConVersionMock(),
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
    // Lo usa `borrarEstado`, en la rama del reinicio determinista.
    delete: () => ({ where: () => Promise.resolve([]) }),
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

function conversacion() {
  return {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil(extra: Record<string, unknown> = {}) {
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
    ficha: null,
    ...extra,
  };
}

function queueTurnoBase(texto: string, extraPerfil: Record<string, unknown> = {}) {
  selectQueue.push(
    [conversacion()],
    [perfil(extraPerfil)],
    [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }],
    [],
    [],
    [],
    []
  );
}

/** El prompt tal cual lo recibió el modelo en su PRIMERA llamada del turno. */
function promptDelModelo(): string {
  const mensajes = chatJson.mock.calls[0]![1] as { role: string; content: string }[];
  return mensajes.map((m) => m.content).join("\n---\n");
}

async function turno(texto: string, extraPerfil: Record<string, unknown> = {}) {
  queueTurnoBase(texto, extraPerfil);
  // Persistente y no `…Once`: algún guardarraíl (p. ej. el de cierre sin
  // total) puede pedirle al modelo un segundo intento, y el turno se caería
  // por una razón que no tiene nada que ver con lo que aquí se mide. El
  // prompt que se inspecciona es siempre el de la PRIMERA llamada.
  chatJson.mockResolvedValue({
    ok: true,
    raw: "{}",
    data: { action: "reply", text: "Claro que sí 😊" },
  });
  const { runAgentTurn } = await import("@/server/ai/pipeline");
  await runAgentTurn("cv_1");
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([PAVE]);
  catalogoDeMock.mockReset().mockResolvedValue([PAVE]);
  leerEstadoConVersionMock.mockClear();
  selectQueue.length = 0;
  estadoActual = null;
  versionActual = 0;
});

describe("el pipeline usa la capa de intención (F1)", () => {
  /*
   * El bloque cuesta tokens en CADA turno de CADA cliente de la flota. Que
   * aparezca solo cuando hay algo que priorizar no es una optimización: un
   * prompt que grita 🛑 en todos los turnos deja de significar nada.
   */
  it("un turno normal no lleva el bloque: no se mete ruido en el prompt", async () => {
    await turno("quiero un pavé de chocolate");

    expect(promptDelModelo()).not.toContain("PLAN DEL TURNO");
  });

  it("un saludo suelto tampoco lo lleva", async () => {
    await turno("hola buenas");

    expect(promptDelModelo()).not.toContain("PLAN DEL TURNO");
  });

  /*
   * El reinicio ya lo resolvió `matchesReinicio` de forma determinista, antes
   * de llamar al modelo. Pedirle además al modelo que colabore en algo que el
   * servidor ya decidió solo abre la puerta a que un turno confuso arrastre un
   * pedido ya cancelado.
   */
  it("el reinicio no se le delega al modelo", async () => {
    await turno("0");

    expect(promptDelModelo()).not.toContain("PLAN DEL TURNO");
  });

  /*
   * En citas el bug existe igual, pero `continuarEnElMismoMensaje` se calcula
   * con `estadoGuardado.items`, que allí no existe: saldría siempre `false` y
   * el bloque afirmaría "no hay nada en curso" en mitad de una reserva. Una
   * mentira del servidor es peor que el silencio de hoy. Queda fuera de este
   * lote, a propósito y probado.
   */
  it("en un negocio de citas no se inyecta, porque no hay con qué calcular la otra mitad", async () => {
    await turno("cuanto vale el servicio?", { appointmentsEnabled: true, catalogSource: "prompt" });

    expect(promptDelModelo()).not.toContain("PLAN DEL TURNO");
  });
});

/**
 * Un pedido ya CONFIRMADO es terminal: el plan del turno no debe inyectarse.
 * Un "¿cuánto demora?" tras confirmar dispara `consulta_entrega`, pero el turno
 * lo gobierna el manejo de "ya fue confirmado", no la cadencia — pedirle al
 * modelo que "continúe" un pedido cerrado es justo lo que se evita en citas y
 * en el reinicio. Salió al correr la suite completa.
 */
describe("un pedido confirmado no recibe plan del turno", () => {
  it("tras confirmar, '¿cuánto demora?' no inyecta el bloque", async () => {
    const { estadoVacio } = await import("@/server/orders/estado");
    estadoActual = {
      ...estadoVacio(),
      items: [
        {
          ofrecible: { id: "p1", nombre: "Pavé chocolate" },
          cantidad: 1,
          seleccion: [],
          gruposDeclinados: [],
        },
      ],
      paso: "confirmado",
      confirmado: true,
    };
    versionActual = 5;

    await turno("¿cuánto demora?");

    expect(promptDelModelo()).not.toContain("PLAN DEL TURNO");
  });
});
