import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 19-ago-2026 (docs/korexia/108-RESERVAS-DE-VARIAS-PERSONAS.md). Caso real de
 * Lashes Valen: una clienta pidió cita para ella (Geimar) y para su mamá
 * (Laura), cada una con su hora. El contrato `book_appointment` solo podía
 * declarar una fecha/hora/especialista por turno, así que solo se creó UNA
 * cita — la de Laura— y el TEXTO le anunció las dos a la clienta como
 * agendadas.
 *
 * `book_appointment` pasa a llevar `reservas[]`: cada reserva se procesa de
 * forma INDEPENDIENTE (nunca todo-o-nada) — el cupo de una no puede
 * depender de si la otra lo tuvo.
 *
 * Mismo patrón de mocks que pipeline-appointments-dispatch.test.ts.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const resolverEspecialistaMultiple = vi.fn();
const crearCitaMultiple = vi.fn();
const catalogoParaPrompt = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  crearCitaMultiple: (...a: unknown[]) => crearCitaMultiple(...a),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn().mockResolvedValue([]),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  disponibilidadRealMultiple: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
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
  id: "cv_citas",
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
  { id: "msg_1", direction: "in", text: "hola", createdAt: new Date() },
];
const SEMIPERMANENTE = {
  id: "svc_semi",
  name: "Semipermanente",
  category: null,
  priceCents: 4000000,
  durationMin: 45,
  staffNames: ["Geimar", "Laura"],
};

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

describe("runAgentTurn: book_appointment con varias reservas independientes", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    crearCitaMultiple.mockReset();
    catalogoParaPrompt.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("dos personas, dos reservas: se crean las DOS citas y se confirman las dos en un solo mensaje", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SEMIPERMANENTE]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [
          { servicios: ["semipermanente"], fecha: "2026-08-21", hora: "15:30", especialista: "Geimar" },
          { servicios: ["semipermanente"], fecha: "2026-08-21", hora: "16:00", especialista: "Laura" },
        ],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple
      .mockResolvedValueOnce({ ok: true, staffId: "st_geimar" })
      .mockResolvedValueOnce({ ok: true, staffId: "st_laura" });
    crearCitaMultiple
      .mockResolvedValueOnce({ ok: true, staffName: "Geimar" })
      .mockResolvedValueOnce({ ok: true, staffName: "Laura" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(crearCitaMultiple).toHaveBeenCalledTimes(2);
    expect(crearCitaMultiple.mock.calls[0]![0]).toMatchObject({ hora: "15:30" });
    expect(crearCitaMultiple.mock.calls[1]![0]).toMatchObject({ hora: "16:00" });

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/Geimar/);
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/Laura/);

    const reply = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(reply?.values.text).toMatch(/Quedaste agendada.*Geimar/s);
    expect(reply?.values.text).toMatch(/Quedaste agendada.*Laura/s);
  });

  it("fallo parcial: la reserva que SÍ tuvo cupo queda agendada aunque la otra no", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SEMIPERMANENTE]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [
          { servicios: ["semipermanente"], fecha: "2026-08-21", hora: "15:30", especialista: "Geimar" },
          { servicios: ["semipermanente"], fecha: "2026-08-21", hora: "16:00", especialista: "Laura" },
        ],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple
      .mockResolvedValueOnce({ ok: true, staffId: "st_geimar" })
      .mockResolvedValueOnce({ ok: true, staffId: "st_laura" });
    crearCitaMultiple
      .mockResolvedValueOnce({ ok: false, reason: "sin_cupo" })
      .mockResolvedValueOnce({ ok: true, staffName: "Laura" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    // Solo se creó UNA cita real (la de Laura); Geimar falló y no se reintentó
    // como si fuera la misma.
    expect(crearCitaMultiple).toHaveBeenCalledTimes(2);
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/Laura/);
    expect(notifyTeam.mock.calls[0]![0].summary).not.toMatch(/Geimar/);

    const reply = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    // La que sí se pudo, queda confirmada de verdad.
    expect(reply?.values.text).toMatch(/Quedaste agendada.*Laura/s);
    // La que falló se informa, no se calla ni se inventa que quedó agendada.
    expect(reply?.values.text).toMatch(/no se pudo agendar/);
  });

  it("las dos reservas fallan: no avisa al equipo, solo informa lo que pasó", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SEMIPERMANENTE]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [
          { servicios: ["semipermanente"], fecha: "2026-08-21", hora: "15:30", especialista: "Geimar" },
          { servicios: ["semipermanente"], fecha: "2026-08-21", hora: "16:00", especialista: "Laura" },
        ],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple
      .mockResolvedValueOnce({ ok: true, staffId: "st_geimar" })
      .mockResolvedValueOnce({ ok: true, staffId: "st_laura" });
    crearCitaMultiple
      .mockResolvedValueOnce({ ok: false, reason: "sin_cupo" })
      .mockResolvedValueOnce({ ok: false, reason: "sin_cupo" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(notifyTeam).not.toHaveBeenCalled();
    const reply = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(reply?.values.text).toMatch(/no se pudo agendar/);
    expect(reply?.values.text).not.toMatch(/Quedaste agendada/);
  });
});
