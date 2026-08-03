import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cobertura de la ORQUESTACIÓN de book/reschedule/cancel_appointment en
 * runAgentTurn — el terreno que tocó el dedup de `avisarYConfirmar` y
 * `encontrarCitaActiva` (ver pipeline.ts). Antes solo se probaba la lógica
 * pura (appointments-logic.test.ts); esto prueba que el turno completo sigue
 * agendando/reprogramando/cancelando, avisando al equipo y confirmando al
 * cliente en el orden correcto tras esa refactorización.
 *
 * No requiere BD real: usa el mismo patrón de lab-sandbox.test.ts, con
 * @/server/appointments/queries y @/server/ai/notify-team mockeados enteros.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const resolverEspecialista = vi.fn();
const crearCita = vi.fn();
const reprogramarCita = vi.fn();
const cancelarCita = vi.fn();
const citasActivasDeContacto = vi.fn();
const catalogoParaPrompt = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialista: (...a: unknown[]) => resolverEspecialista(...a),
  crearCita: (...a: unknown[]) => crearCita(...a),
  reprogramarCita: (...a: unknown[]) => reprogramarCita(...a),
  cancelarCita: (...a: unknown[]) => cancelarCita(...a),
  citasActivasDeContacto: (...a: unknown[]) => citasActivasDeContacto(...a),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  disponibilidadReal: vi.fn(),
  proximasFechasConCupo: vi.fn(),
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
const SERVICIO = {
  id: "svc_1",
  name: "Corte de cabello",
  category: null,
  priceCents: 5000000,
  durationMin: 30,
  staffNames: ["Ana"],
};

/** conversación, perfil, historial, kb, etapas, contacto — antes del switch. */
function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

describe("runAgentTurn: agendar/reprogramar/cancelar cita (tras el dedup)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialista.mockReset();
    crearCita.mockReset();
    reprogramarCita.mockReset();
    cancelarCita.mockReset();
    citasActivasDeContacto.mockReset();
    catalogoParaPrompt.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("book_appointment: agenda, avisa al equipo y confirma al cliente", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        servicio: "corte de cabello",
        fecha: "2026-08-10",
        hora: "10:00",
      },
      raw: "{}",
    });
    resolverEspecialista.mockResolvedValue({ ok: true, staffId: null });
    crearCita.mockResolvedValue({ ok: true, staffName: "Ana" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_citas");

    expect(action?.action).toBe("book_appointment");
    expect(crearCita).toHaveBeenCalledTimes(1);
    expect(crearCita.mock.calls[0]![0]).toMatchObject({
      organizationId: "org_1",
      contactId: "ct_1",
      fecha: "2026-08-10",
      hora: "10:00",
    });

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(notifyTeam.mock.calls[0]![0]).toMatchObject({
      organizationId: "org_1",
      isTest: true,
    });
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/Nueva cita/);

    const reply = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(reply?.values.text).toMatch(/Quedaste agendada/);
    expect(reply?.values.text).toMatch(/Corte de cabello/);
  });

  it("reschedule_appointment: encuentra la cita activa por nombre parafraseado y reprograma", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    citasActivasDeContacto.mockResolvedValue([
      {
        id: "cit_1",
        serviceId: "svc_1",
        serviceName: "Corte de cabello",
        staffId: "st_1",
        staffName: "Ana",
        startsAt: new Date("2026-08-10T15:00:00Z"),
        endsAt: new Date("2026-08-10T15:30:00Z"),
      },
    ]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "reschedule_appointment",
        servicio: "corte",
        nuevaFecha: "2026-08-11",
        nuevaHora: "11:00",
      },
      raw: "{}",
    });
    reprogramarCita.mockResolvedValue({ ok: true });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(reprogramarCita).toHaveBeenCalledTimes(1);
    expect(reprogramarCita.mock.calls[0]![0]).toMatchObject({
      appointmentId: "cit_1",
      nuevaFecha: "2026-08-11",
      nuevaHora: "11:00",
    });
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/reprogramada/);

    const reply = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(reply?.values.text).toMatch(/reprogramada/);
  });

  it("cancel_appointment: cancela la cita activa encontrada y confirma", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    citasActivasDeContacto.mockResolvedValue([
      {
        id: "cit_1",
        serviceId: "svc_1",
        serviceName: "Corte de cabello",
        staffId: "st_1",
        staffName: "Ana",
        startsAt: new Date("2026-08-10T15:00:00Z"),
        endsAt: new Date("2026-08-10T15:30:00Z"),
      },
    ]);
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "cancel_appointment", servicio: "corte de cabello" },
      raw: "{}",
    });
    cancelarCita.mockResolvedValue(true);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(cancelarCita).toHaveBeenCalledWith("org_1", "cit_1");
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/Cita cancelada/);

    const reply = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(reply?.values.text).toMatch(/cancelé tu cita/);
  });

  it("reschedule_appointment sin cita activa que empareje: no llama a reprogramarCita", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    citasActivasDeContacto.mockResolvedValue([]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "reschedule_appointment",
        servicio: "manicure",
        nuevaFecha: "2026-08-11",
        nuevaHora: "11:00",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(reprogramarCita).not.toHaveBeenCalled();
    expect(notifyTeam).not.toHaveBeenCalled();
  });
});
