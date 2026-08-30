import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md: confirma que el
 * dato de la ficha llega de verdad al prompt que ve el modelo — no solo que
 * las funciones puras devuelvan el texto correcto en aislado.
 *
 * Mismo patrón de mocks que pipeline-appointments-dispatch.test.ts (sin BD
 * real). Solo se inspecciona el mensaje "system" de la primera llamada a
 * chatJson; la acción del modelo es un `reply` simple porque no hace falta
 * llegar a agendar nada para esta prueba.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoParaPrompt = vi.fn();
vi.mock("@/server/appointments/queries", () => ({
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  listStaff: vi.fn().mockResolvedValue([{ id: "st_hilary", name: "Hilary", archivedAt: null }]),
  resolverEspecialistaMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn(),
  disponibilidadRealMultiple: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
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

const CONVERSATION = {
  id: "cv_lashes",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};
const HISTORY = [
  { id: "msg_1", direction: "in", text: "Hola, quiero agendar", createdAt: new Date() },
];
const SERVICIO = {
  id: "svc_1",
  name: "Retoque Volumen 4D Tecnológico",
  category: null,
  priceCents: 9000000,
  durationMin: 90,
  staffNames: ["Hilary"],
};

function fichaCitas(pagoAntesDeLaCita?: boolean) {
  return JSON.stringify({
    nombre: "Lashes Valen",
    vertical: "citas",
    queVende: "cejas y pestañas",
    tono: "cercano",
    horario: { abre: "9:30 AM", cierra: "21:30", dias: [1, 2, 3, 4, 5, 6] },
    pago: { formas: "NEQUI", datosDeCuenta: "NEQUI-3185940645", compruebaUnaPersona: true },
    cierre: { requisitos: [], pagoAntesDeLaCita },
  });
}

function profileCon(ficha: string | null) {
  return {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    appointmentsEnabled: true,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: "09:30 AM",
    hoursClose: "21:30",
    hoursDays: "1,2,3,4,5,6",
    ficha,
  };
}

function queueTurnoBase(ficha: string | null) {
  selectQueue.push([CONVERSATION], [profileCon(ficha)], HISTORY, [], [], []);
}

describe("runAgentTurn: el prompt de citas sigue el dato de la ficha, no lo infiere", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoParaPrompt.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("sin declarar el interruptor (el caso real de Lashes Valen), el prompt prohíbe mencionar el pago", async () => {
    queueTurnoBase(fichaCitas(undefined));
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "¡Hola! ¿Qué servicio te gustaría agendar?" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(1);
    const systemPrompt = chatJson.mock.calls[0]![1][0].content as string;
    expect(systemPrompt).toContain("PAGO AL CONFIRMAR UNA CITA");
    expect(systemPrompt).toContain("NO pide pago por adelantado");
    expect(systemPrompt).not.toContain("NEQUI-3185940645");
  });

  it("con el interruptor encendido, el prompt exige mencionar el pago y trae los datos reales", async () => {
    queueTurnoBase(fichaCitas(true));
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "¡Hola! ¿Qué servicio te gustaría agendar?" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_lashes");

    const systemPrompt = chatJson.mock.calls[0]![1][0].content as string;
    expect(systemPrompt).toContain("SÍ pide el pago por adelantado");
    expect(systemPrompt).toContain("NEQUI-3185940645");
  });
});
