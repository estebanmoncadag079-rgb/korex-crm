import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de docs/korexia/109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md: el
 * guardarraíl de afirmar/negar sin verificar (pipeline.ts, junto a
 * `consultas`) reacciona igual ante una negación categórica que ante una
 * afirmación — y, sobre todo, NO reacciona ante una negación de una hora
 * puntual que el cliente propuso, el caso real que casi se rompe con un
 * primer diseño más simple.
 *
 * Mismo patrón de mocks que pipeline-especialista-verificada.test.ts.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const resolverEspecialistaMultiple = vi.fn();
const proximasFechasConCupoMultiple = vi.fn();
const catalogoParaPrompt = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  proximasFechasConCupoMultiple: (...a: unknown[]) => proximasFechasConCupoMultiple(...a),
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
const PROFILE = {
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
};
const HISTORY = [
  { id: "msg_1", direction: "in", text: "a las 10 am", createdAt: new Date() },
];
const SERVICIO = {
  id: "svc_1",
  name: "Retoque Natural o Pestañina",
  category: null,
  priceCents: 7500000,
  durationMin: 75,
  staffNames: ["Valentina"],
};

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

describe("runAgentTurn: niega disponibilidad sin verificar (mitad simétrica del guardarraíl 9)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    proximasFechasConCupoMultiple.mockReset();
    catalogoParaPrompt.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("negación categórica ('ya no tengo horarios') sin consultar: rehace el turno y acepta la respuesta ya verificada", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_valentina" });
    proximasFechasConCupoMultiple.mockResolvedValue([
      { fecha: "20/08/2026", horarios: ["12:00", "12:30"] },
    ]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Hermosa, para mañana ya no tengo horarios disponibles. 😔" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consult_availability", servicios: ["retoque natural o pestañina"] },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "¡Claro que sí! Valentina sí tiene disponibilidad, a las 12:00 o 12:30 p.m. ¿Cuál te sirve?",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(3);
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/12:00/);

    const avisoDerivacion = inserted.find((i) =>
      String((i.values as { text?: string }).text ?? "").includes("Te comunico con una persona")
    );
    expect(avisoDerivacion).toBeUndefined();
  });

  it("negación de una HORA PUNTUAL propuesta por el cliente: no activa nada, sale tal cual", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "reply",
        text: "Para hoy, la cita a las 6:30 PM no está disponible. ¿Te gustaría ver otras opciones?",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    // Una sola llamada: el guardarraíl no se disparó, no hubo reintento.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");
    expect(resolverEspecialistaMultiple).not.toHaveBeenCalled();
  });
});
