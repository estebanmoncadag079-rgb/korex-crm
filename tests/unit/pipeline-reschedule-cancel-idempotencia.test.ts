import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8A — hardening de `reschedule_appointment`/`cancel_appointment`
 * (auditoría Fase 8, hallazgos A2/B3): mismo mecanismo de idempotencia +
 * registro/aviso/reintento que `book_appointment` (Fase 10V/6B), extendido a
 * estas dos operaciones en vez de clonar infraestructura nueva — ver
 * `src/server/ai/confirmacion-de-cita.ts` (columna `kind`) y el `case
 * "reschedule_appointment"`/`case "cancel_appointment"` en `pipeline.ts`.
 *
 * Mismo scaffold que `pipeline-book-appointment-idempotencia.test.ts`, con
 * `@/server/ai/confirmacion-de-cita` mockeado completo (incluye
 * `guardarContenidoDeCita`/`intentarNotificarCita`, que book_appointment no
 * necesitaba mockear porque sus pruebas usan conversaciones `isTest:true` —
 * aquí se prueba también el camino real, `isTest:false`).
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const reprogramarCita = vi.fn();
const cancelarCita = vi.fn();
const citasActivasDeContacto = vi.fn();
const catalogoParaPrompt = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: (...a: unknown[]) => reprogramarCita(...a),
  cancelarCita: (...a: unknown[]) => cancelarCita(...a),
  citasActivasDeContacto: (...a: unknown[]) => citasActivasDeContacto(...a),
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

// Conversaciones reales (`isTest:false`) pasan por `sendText` de verdad en
// `deliverReply` — sin mockearlo, el envío real fallaría en el entorno de
// pruebas y `deliverReply` derivaría a un humano (notifyTeam con el aviso de
// "no se pudo entregar"), contaminando las aserciones sobre el aviso de la
// CITA. Mismo patrón que pipeline-pedido-ya-confirmado.test.ts.
const sendText = vi.fn();
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...real, sendText: (...a: unknown[]) => sendText(...a) };
});

const registrarConfirmacionDeCita = vi.fn();
const guardarContenidoDeCita = vi.fn();
const intentarNotificarCita = vi.fn();
vi.mock("@/server/ai/confirmacion-de-cita", () => ({
  registrarConfirmacionDeCita: (...a: unknown[]) => registrarConfirmacionDeCita(...a),
  guardarContenidoDeCita: (...a: unknown[]) => guardarContenidoDeCita(...a),
  intentarNotificarCita: (...a: unknown[]) => intentarNotificarCita(...a),
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

function conversacion(overrides: Record<string, unknown> = {}) {
  return {
    id: "cv_citas",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: false,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
    ...overrides,
  };
}
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
const HISTORY = [{ id: "msg_1", direction: "in", text: "hola", createdAt: new Date() }];
const SERVICIO = {
  id: "svc_1",
  name: "Corte de cabello",
  category: null,
  priceCents: 5000000,
  durationMin: 30,
  staffNames: ["Ana"],
};
const CITA_ACTIVA = {
  id: "cit_1",
  serviceId: "svc_1",
  serviceName: "Corte de cabello",
  staffId: "st_1",
  staffName: "Ana",
  startsAt: new Date("2026-08-10T15:00:00Z"), // 10:00 Bogotá
  endsAt: new Date("2026-08-10T15:30:00Z"),
};

function queueTurnoBase(conv: Record<string, unknown>) {
  selectQueue.push([conv], [PROFILE], HISTORY, [], [], [], [], [], [], [], [], []);
}

describe("Fase 8A — reschedule_appointment: idempotencia + notificación confiable", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    reprogramarCita.mockReset();
    cancelarCita.mockReset();
    citasActivasDeContacto.mockReset();
    catalogoParaPrompt.mockReset().mockResolvedValue([SERVICIO]);
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    sendText.mockReset().mockResolvedValue(undefined);
    registrarConfirmacionDeCita.mockReset().mockResolvedValue({ primeraVez: true, id: "apbc_1" });
    guardarContenidoDeCita.mockReset().mockResolvedValue(undefined);
    intentarNotificarCita
      .mockReset()
      .mockResolvedValue({ estado: "enviado", sent: 1, failed: 0, detail: "ok" });
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("1: reschedule normal -> reprograma una vez y notifica por el registro (confirmationId), no por el camino directo", async () => {
    queueTurnoBase(conversacion());
    citasActivasDeContacto.mockResolvedValue([CITA_ACTIVA]);
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
    expect(registrarConfirmacionDeCita).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", conversationId: "cv_citas", kind: "reprogramacion" })
    );
    expect(guardarContenidoDeCita).toHaveBeenCalledWith(
      "apbc_1",
      expect.stringMatching(/reprogramada/),
      null
    );
    expect(intentarNotificarCita).toHaveBeenCalledWith(expect.objectContaining({ id: "apbc_1" }));
    expect(notifyTeam).not.toHaveBeenCalled(); // el camino directo de siempre ya no se usa

    // Conversación real (isTest:false): la confirmación al cliente sale por
    // sendText (WhatsApp), no por una fila insertada a mano en la BD.
    expect(sendText).toHaveBeenCalledTimes(1);
    expect((sendText.mock.calls[0]![0] as { text: string }).text).toMatch(/reprogramada/);
  });

  it("2: cancel normal -> cancela una vez y notifica por el registro (confirmationId)", async () => {
    queueTurnoBase(conversacion());
    citasActivasDeContacto.mockResolvedValue([CITA_ACTIVA]);
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "cancel_appointment", servicio: "corte de cabello" },
      raw: "{}",
    });
    cancelarCita.mockResolvedValue(true);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(cancelarCita).toHaveBeenCalledTimes(1);
    expect(cancelarCita).toHaveBeenCalledWith("org_1", "cit_1");
    expect(registrarConfirmacionDeCita).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cancelacion" })
    );
    expect(intentarNotificarCita).toHaveBeenCalledWith(expect.objectContaining({ id: "apbc_1" }));
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("3a: reschedule duplicado (mismos mensajes disparadores, el cambio YA quedó aplicado) -> reprogramarCita NO se vuelve a llamar", async () => {
    queueTurnoBase(conversacion());
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
    registrarConfirmacionDeCita.mockResolvedValue({ primeraVez: false, id: "apbc_1" });
    // La primera lectura (encontrar la cita por nombre) y la lectura fresca de
    // verificación ("¿ya quedó aplicado?") ven la MISMA cita, ya movida a la
    // hora objetivo por la ejecución que ganó la carrera.
    citasActivasDeContacto.mockResolvedValue([
      { ...CITA_ACTIVA, startsAt: new Date("2026-08-11T16:00:00Z"), endsAt: new Date("2026-08-11T16:30:00Z") },
    ]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(reprogramarCita).not.toHaveBeenCalled();
    // Igual se (re)confirma — el claim atómico de intentarNotificarCita es
    // quien evita un segundo WhatsApp real al equipo, no este `if`.
    expect(intentarNotificarCita).toHaveBeenCalledWith(expect.objectContaining({ id: "apbc_1" }));
  });

  it("3b: reschedule duplicado pero el primer intento en realidad NO se aplicó (p. ej. crasheó antes del UPDATE) -> sí reintenta reprogramarCita, no finge éxito", async () => {
    queueTurnoBase(conversacion());
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
    registrarConfirmacionDeCita.mockResolvedValue({ primeraVez: false, id: "apbc_1" });
    // La cita sigue en su hora ORIGINAL: el cambio nunca llegó a aplicarse.
    citasActivasDeContacto.mockResolvedValue([CITA_ACTIVA]);
    reprogramarCita.mockResolvedValue({ ok: true });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(reprogramarCita).toHaveBeenCalledTimes(1);
  });

  it("4a: cancel duplicado (mismos mensajes disparadores) -> cancelarCita NO se vuelve a llamar", async () => {
    queueTurnoBase(conversacion());
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "cancel_appointment", servicio: "corte de cabello" },
      raw: "{}",
    });
    registrarConfirmacionDeCita.mockResolvedValue({ primeraVez: false, id: "apbc_1" });
    citasActivasDeContacto.mockResolvedValue([CITA_ACTIVA]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(cancelarCita).not.toHaveBeenCalled();
    expect(intentarNotificarCita).toHaveBeenCalledWith(expect.objectContaining({ id: "apbc_1" }));
  });

  it("4b: notifyTeam falla en el primer intento (fallo_recuperable) -> el turno no se rompe, el cliente igual recibe su confirmación, y queda registro reintentable", async () => {
    queueTurnoBase(conversacion());
    citasActivasDeContacto.mockResolvedValue([CITA_ACTIVA]);
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
    intentarNotificarCita.mockResolvedValue({
      estado: "fallo_recuperable",
      sent: 0,
      failed: 1,
      detail: "timeout de red",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_citas");

    expect(action?.action).toBe("reschedule_appointment");
    expect(reprogramarCita).toHaveBeenCalledTimes(1); // la cita SÍ quedó reprogramada
    // El cliente no se entera del fallo del aviso interno: su confirmación
    // sale igual.
    expect(sendText).toHaveBeenCalledTimes(1);
    expect((sendText.mock.calls[0]![0] as { text: string }).text).toMatch(/reprogramada/);
    // El registro reintentable (notify_status='fallo_recuperable') es
    // responsabilidad de intentarNotificarCita, ya probado exhaustivamente
    // en notificacion-cita-confiable.test.ts; aquí solo se prueba que el
    // turno no se rompe ni pierde el efecto real por ese fallo.
  });

  it("5: dos organizaciones -> cada reschedule usa su propia organizationId, sin mezclarse", async () => {
    // Turno 1: org_1
    queueTurnoBase(conversacion({ id: "cv_org1", organizationId: "org_1", contactId: "ct_1" }));
    citasActivasDeContacto.mockResolvedValueOnce([CITA_ACTIVA]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "reschedule_appointment",
        servicio: "corte",
        nuevaFecha: "2026-08-11",
        nuevaHora: "11:00",
      },
      raw: "{}",
    });
    reprogramarCita.mockResolvedValueOnce({ ok: true });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_org1");

    // Turno 2: org_2, otra conversación, otra cita. Lo que le sobró de la
    // cola al turno 1 (lecturas que no necesitó) no debe colarse por delante
    // de los datos del turno 2 — mismo criterio que el escenario F de
    // pipeline-book-appointment-idempotencia.test.ts.
    selectQueue.length = 0;
    queueTurnoBase(
      conversacion({ id: "cv_org2", organizationId: "org_2", contactId: "ct_2" })
    );
    citasActivasDeContacto.mockResolvedValueOnce([
      { ...CITA_ACTIVA, id: "cit_2", staffId: "st_2", staffName: "Beatriz" },
    ]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "reschedule_appointment",
        servicio: "corte",
        nuevaFecha: "2026-08-12",
        nuevaHora: "09:00",
      },
      raw: "{}",
    });
    reprogramarCita.mockResolvedValueOnce({ ok: true });

    await runAgentTurn("cv_org2");

    expect(registrarConfirmacionDeCita).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ organizationId: "org_1", conversationId: "cv_org1" })
    );
    expect(registrarConfirmacionDeCita).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ organizationId: "org_2", conversationId: "cv_org2" })
    );
    expect(citasActivasDeContacto).toHaveBeenNthCalledWith(1, "org_1", "ct_1");
    expect(citasActivasDeContacto).toHaveBeenNthCalledWith(2, "org_2", "ct_2");
    expect(reprogramarCita.mock.calls[0]![0]).toMatchObject({ organizationId: "org_1" });
    expect(reprogramarCita.mock.calls[1]![0]).toMatchObject({ organizationId: "org_2" });
  });
});
