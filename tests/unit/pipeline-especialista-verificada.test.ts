import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría 19-ago-2026 (docs/korexia/106-ESPECIALISTA-VERIFICADA-TRAS-CONSULTAR.md).
 *
 * El guardarraíl "especialista sin verificar" (anuncio-de-cierre.ts +
 * pipeline.ts:780-833) da UNA oportunidad de corregir cuando el modelo
 * confirma una especialista sin haber llamado a `consult_availability`. Si
 * el reintento SÍ decide consultar, el propio guardarraíl resuelve esa
 * consulta con datos reales antes de pedir la respuesta final — pero hasta
 * este fix esa respuesta final se re-evaluaba con el MISMO detector textual
 * que la marcó la primera vez, y cualquier respuesta útil tras verificar
 * ("Hilary SÍ puede el jueves a las 3pm") vuelve a nombrar a la especialista
 * en una afirmación: derivaba a una persona de forma sistemática, no solo en
 * el caso raro.
 *
 * Mismo patrón de mocks que pipeline-appointments-dispatch.test.ts (sin BD
 * real).
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

const notifyTeam = vi.fn();
const contactPhoneOf = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
  contactPhoneOf: (...a: unknown[]) => contactPhoneOf(...a),
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
  hoursOpen: "08:00",
  hoursClose: "18:00",
  hoursDays: "1,2,3,4,5,6",
};
const HISTORY = [
  {
    id: "msg_1",
    direction: "in",
    text: "Quiero un retoque de volumen ruso con Hilary",
    createdAt: new Date(),
  },
];
const SERVICIO = {
  id: "svc_1",
  name: "Retoque Volumen Ruso",
  category: null,
  priceCents: 8000000,
  durationMin: 60,
  staffNames: ["Hilary", "Valentina"],
};

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

const RESPUESTA_SIN_VERIFICAR = {
  action: "reply",
  text: "¡Perfecto! Un retoque de Volumen Ruso con Hilary. ¿Para qué día y hora te gustaría agendar tu cita, hermosa? 💖",
};

describe("runAgentTurn: especialista confirmada tras consultar de verdad", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    proximasFechasConCupoMultiple.mockReset();
    catalogoParaPrompt.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("el reintento consulta disponibilidad real y la respuesta final se acepta, sin derivar a una persona", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_hilary" });
    proximasFechasConCupoMultiple.mockResolvedValue([
      { fecha: "21/08/2026", horarios: ["15:00", "16:00"] },
    ]);

    chatJson
      .mockResolvedValueOnce({ ok: true, data: RESPUESTA_SIN_VERIFICAR, raw: "{}" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "consult_availability",
          servicios: ["retoque de volumen ruso"],
          especialista: "Hilary",
        },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "¡Listo! Hilary SÍ tiene el retoque de Volumen Ruso el jueves a las 3:00 p.m. ¿Te la agendo?",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(3);
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/Hilary SÍ tiene/);

    // No derivó: no se avisó al equipo ni se insertó el aviso de handoff.
    expect(notifyTeam).not.toHaveBeenCalled();
    const avisoDerivacion = inserted.find((i) =>
      String((i.values as { text?: string }).text ?? "").includes("Te comunico con una persona")
    );
    expect(avisoDerivacion).toBeUndefined();
  });

  it("si el reintento NO llega a consultar, sigue derivando a una persona (comportamiento sin cambios)", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);

    chatJson
      .mockResolvedValueOnce({ ok: true, data: RESPUESTA_SIN_VERIFICAR, raw: "{}" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "Claro, con Hilary quedaría el jueves a las 3pm. ¿La agendo?",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(resolverEspecialistaMultiple).not.toHaveBeenCalled();
    expect(action).toEqual({ action: "handoff", reason: "error" });
  });
});
