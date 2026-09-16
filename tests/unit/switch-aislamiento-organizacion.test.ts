import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T026 (feature 003-backend-como-autoridad) — el switch (`state_source`) es
 * por organización, nunca global. Esta prueba corre DOS organizaciones
 * distintas en el MISMO proceso — una con `state_source='backend'` (el motor
 * de operaciones nuevo) y otra con `'prompt'` (el camino de siempre,
 * intacto) — y confirma que apagar/encender una no toca a la otra: cada
 * `runAgentTurn` lee el perfil de SU PROPIA organización, sin estado
 * compartido a nivel de módulo entre invocaciones.
 *
 * Decisión explícita (16-sep-2026, Esteban): no se altera ningún flag
 * productivo real para probar esto — La Churra/Lis/MALIA ya tienen
 * `state_source='backend'` en producción, y no tiene sentido apagar y
 * volver a encenderlo solo para reproducir T026 literal. Esta prueba
 * demuestra la propiedad de aislamiento con organizaciones de prueba,
 * complementando la evidencia empírica ya recogida en T025 (4 organizaciones
 * reales distintas, corridas en la misma sesión, sin ninguna contaminación
 * observada entre ellas).
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
    leerEstadoConVersion: (...a: Parameters<typeof leerEstadoConVersionMock>) =>
      leerEstadoConVersionMock(...a),
    guardarEstado: (...a: Parameters<typeof guardarEstadoMock>) => guardarEstadoMock(...a),
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

function conversacion(id: string, organizationId: string) {
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

function perfil(organizationId: string, stateSource: "backend" | "prompt") {
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
    hoursOpen: "08:00",
    hoursClose: "23:00",
    hoursDays: "1,2,3,4,5,6,7",
    catalogSource: stateSource === "backend" ? "tabla" : "prompt",
    paymentSource: "prompt",
    stateSource,
    deliverySource: "prompt",
    ficha: JSON.stringify({ cierre: { requisitos: [] } }),
  };
}

function producto(id: string, nombre: string, precioCents: number) {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

function queueTurno(conv: ReturnType<typeof conversacion>, prof: ReturnType<typeof perfil>, texto: string) {
  selectQueue.push(
    [conv],
    [prof],
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
  catalogoDePedidosMock.mockReset().mockResolvedValue([producto("p1", "Pavé chocolate", 1000000)]);
  catalogoDeMock.mockReset().mockResolvedValue([producto("p1", "Pavé chocolate", 1000000)]);
  selectQueue.length = 0;
  guardarEstadoMock.mockReset().mockResolvedValue({ ok: true });
  leerEstadoConVersionMock.mockReset().mockResolvedValue(null);
});

describe("T026 — el switch state_source es por organización, no global", () => {
  it("org A (backend) usa el motor de operaciones; org B (prompt) sigue con el camino de siempre — en el mismo proceso, sin contaminarse", async () => {
    const { runAgentTurn } = await import("@/server/ai/pipeline");

    // Org A: state_source='backend' — pide "operaciones", lee/guarda estado.
    const convA = conversacion("cv_a", "org_a_backend");
    queueTurno(convA, perfil("org_a_backend", "backend"), "hola, quiero un pavé");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: { action: "reply", text: "¡Listo!", operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }] },
    });
    await runAgentTurn("cv_a");

    // El esquema pedido a org A exige "operaciones" (el contrato nuevo).
    const schemaOrgA = chatJson.mock.calls[0]![2] as { jsonSchema: { json_schema: { schema: { required: string[] } } } };
    expect(schemaOrgA.jsonSchema.json_schema.schema.required).toContain("operaciones");
    expect(leerEstadoConVersionMock).toHaveBeenCalledWith("cv_a", "org_a_backend");
    expect(guardarEstadoMock).toHaveBeenCalledTimes(1);
    expect(guardarEstadoMock.mock.calls[0]![0]).toMatchObject({ organizationId: "org_a_backend" });

    // Org B: state_source='prompt' — NUNCA pide "operaciones", nunca toca
    // leerEstadoConVersion/guardarEstado. Misma sesión de test, mismo
    // proceso, sin ningún flag global de por medio.
    const convB = conversacion("cv_b", "org_b_prompt");
    queueTurno(convB, perfil("org_b_prompt", "prompt"), "hola, quiero un pavé");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: { action: "reply", text: "¡Hola! ¿Qué te gustaría pedir?" },
    });
    await runAgentTurn("cv_b");

    // La llamada de org B no lleva jsonSchema con "operaciones" (de hecho no
    // lleva jsonSchema en absoluto: `chatJson(AgentAction, messages)` sin
    // tercer argumento, el camino de siempre).
    const argsOrgB = chatJson.mock.calls[1]!;
    expect(argsOrgB[2]).toBeUndefined();
    // Sigue en 1: org B no le agregó ninguna llamada a leerEstadoConVersion.
    expect(leerEstadoConVersionMock).toHaveBeenCalledTimes(1);
    // Sigue en 1: org B no le agregó ningún guardado de estado tampoco.
    expect(guardarEstadoMock).toHaveBeenCalledTimes(1);

    // Y org A no quedó afectada por haber corrido org B después: su única
    // llamada a guardarEstado sigue siendo la suya, con SU organizationId.
    expect(guardarEstadoMock.mock.calls[0]![0]).toMatchObject({ organizationId: "org_a_backend" });
  });
});
