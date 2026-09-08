import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10V — auditoría independiente del Hallazgo A ("idempotencia de
 * book_appointment no detiene la ejecución duplicada"). Escenarios A-F
 * pedidos explícitamente por esa auditoría, cada uno con su propio nombre
 * para que se pueda mapear 1:1 contra el hallazgo.
 *
 * Verificación previa a escribir estos tests (regla del hallazgo: "confirma
 * con código que el hallazgo existe" antes de tocar nada): releído
 * `pipeline.ts` en el `case "book_appointment":` — la llamada real es
 *
 *   const resultado = primeraVezDeEsteLote
 *     ? await crearCitaMultiple({...})
 *     : await buscarCitaYaCreada(...)
 *
 * — es decir, `crearCitaMultiple` YA está condicionado por
 * `primeraVezDeEsteLote` y NUNCA se ejecuta cuando es `false`. El bucle
 * `for (const reserva of action.reservas)` sí continúa corriendo (por eso el
 * warning y el bucle conviven en el código, tal como señaló la auditoría),
 * pero lo que corre dentro es solo lectura (`buscarServicio`,
 * `resolverEspecialistaMultiple`, `estaEntreLosOfrecidos`,
 * `buscarCitaYaCreada`) — nunca vuelve a escribir una cita. Estos tests lo
 * demuestran con evidencia ejecutable, no con lectura de código solamente.
 *
 * Mismo scaffold de mocks que pipeline-appointments-dispatch.test.ts.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const resolverEspecialistaMultiple = vi.fn();
const crearCitaMultiple = vi.fn();
const citasActivasDeContacto = vi.fn();
const catalogoParaPrompt = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  crearCitaMultiple: (...a: unknown[]) => crearCitaMultiple(...a),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
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

const registrarConfirmacionDeCita = vi.fn();
vi.mock("@/server/ai/confirmacion-de-cita", () => ({
  registrarConfirmacionDeCita: (...a: unknown[]) => registrarConfirmacionDeCita(...a),
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
const HISTORY = [{ id: "msg_1", direction: "in", text: "hola", createdAt: new Date() }];
const SERVICIO = {
  id: "svc_1",
  name: "Corte de cabello",
  category: null,
  priceCents: 5000000,
  durationMin: 30,
  staffNames: ["Ana"],
};
const SERVICIO_2 = {
  id: "svc_2",
  name: "Manicure",
  category: null,
  priceCents: 3000000,
  durationMin: 45,
  staffNames: ["Beatriz"],
};

/**
 * El camino de éxito de `book_appointment` (con `avisarYConfirmar`) hace más
 * lecturas que las 3 esenciales (conversación/perfil/historial) — el resto
 * (kb, stages, contacto, notas previas) tolera bien una fila vacía si no se
 * necesita nada más. Padding generoso para no adivinar el número exacto.
 */
function queueTurnoBase() {
  selectQueue.push(
    [CONVERSATION],
    [PROFILE],
    HISTORY,
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    []
  );
}

describe("Fase 10V, Hallazgo A — book_appointment nunca crea una cita duplicada", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    crearCitaMultiple.mockReset();
    citasActivasDeContacto.mockReset();
    catalogoParaPrompt.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    registrarConfirmacionDeCita.mockReset().mockResolvedValue({ primeraVez: true });
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("A: primera ejecución -> crea la cita normalmente", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [{ servicios: ["corte de cabello"], fecha: "2026-08-10", hora: "10:00" }],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: null });
    crearCitaMultiple.mockResolvedValue({ ok: true, staffName: "Ana" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_citas");

    expect(registrarConfirmacionDeCita).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", conversationId: "cv_citas", messageIds: ["msg_1"] })
    );
    expect(crearCitaMultiple).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("book_appointment");
    const reply = inserted.find((i) => (i.values as { direction?: string }).direction === "out");
    expect(reply?.values.text).toMatch(/Quedaste agendada/);
  });

  it("B: segunda ejecución, MISMOS messageIds -> cero llamadas adicionales a crearCitaMultiple", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [{ servicios: ["corte de cabello"], fecha: "2026-08-10", hora: "10:00" }],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: null });
    registrarConfirmacionDeCita.mockResolvedValue({ primeraVez: false });
    citasActivasDeContacto.mockResolvedValue([
      {
        id: "cit_ya_creada",
        serviceId: "svc_1",
        serviceName: "Corte de cabello",
        staffId: "st_1",
        staffName: "Ana",
        startsAt: new Date("2026-08-10T15:00:00Z"),
        endsAt: new Date("2026-08-10T15:30:00Z"),
      },
    ]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(crearCitaMultiple).not.toHaveBeenCalled();
  });

  it("C: segunda ejecución con SALIDA DISTINTA del modelo (otro horario/servicio propuesto) -> sigue sin crear otra cita", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    // El modelo, en el reintento, propone algo DISTINTO a lo que se agendó
    // la primera vez (otra hora) — el idempotency key depende de los
    // messageIds disparadores, NO de lo que proponga el modelo esta vez.
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [{ servicios: ["corte de cabello"], fecha: "2026-08-10", hora: "16:00" }],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: null });
    registrarConfirmacionDeCita.mockResolvedValue({ primeraVez: false });
    // No hay ninguna cita para las 16:00 (la real quedó a las 10:00): la
    // búsqueda honesta no encuentra nada que reportar como ya-creada.
    citasActivasDeContacto.mockResolvedValue([
      {
        id: "cit_ya_creada",
        serviceId: "svc_1",
        serviceName: "Corte de cabello",
        staffId: "st_1",
        staffName: "Ana",
        startsAt: new Date("2026-08-10T15:00:00Z"), // 10:00, no 16:00
        endsAt: new Date("2026-08-10T15:30:00Z"),
      },
    ]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    // Ni con un horario distinto propuesto por el modelo se llega a crear
    // una segunda cita.
    expect(crearCitaMultiple).not.toHaveBeenCalled();
    const reply = inserted.find((i) => (i.values as { direction?: string }).direction === "out");
    // Tampoco finge un éxito que no ocurrió.
    expect(reply?.values.text).not.toMatch(/Quedaste agendada/);
  });

  it("D: primera ejecución con VARIAS reservas legítimas -> todas se procesan y se crean", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO, SERVICIO_2]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [
          { servicios: ["corte de cabello"], fecha: "2026-08-10", hora: "10:00" },
          { servicios: ["manicure"], fecha: "2026-08-10", hora: "10:00" },
        ],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: null });
    crearCitaMultiple
      .mockResolvedValueOnce({ ok: true, staffName: "Ana" })
      .mockResolvedValueOnce({ ok: true, staffName: "Beatriz" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(registrarConfirmacionDeCita).toHaveBeenCalledTimes(1); // una vez por TURNO, no por reserva
    expect(crearCitaMultiple).toHaveBeenCalledTimes(2);
    const reply = inserted.find((i) => (i.values as { direction?: string }).direction === "out");
    expect(reply?.values.text).toMatch(/Corte de cabello/);
    expect(reply?.values.text).toMatch(/Manicure/);
  });

  it("E: error parcial de UNA reserva no rompe las demás reservas legítimas", async () => {
    queueTurnoBase();
    catalogoParaPrompt.mockResolvedValue([SERVICIO]); // "spa facial" NO existe en el catálogo
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [
          { servicios: ["spa facial"], fecha: "2026-08-10", hora: "09:00" }, // falla: no está en catálogo
          { servicios: ["corte de cabello"], fecha: "2026-08-10", hora: "10:00" }, // legítima
        ],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: null });
    crearCitaMultiple.mockResolvedValue({ ok: true, staffName: "Ana" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    // Solo se intenta crear la reserva legítima -- la fallida nunca llega a
    // crearCitaMultiple (se descarta antes, por catálogo).
    expect(crearCitaMultiple).toHaveBeenCalledTimes(1);
    const reply = inserted.find((i) => (i.values as { direction?: string }).direction === "out");
    expect(reply?.values.text).toMatch(/Quedaste agendada.*Corte de cabello/s);
    expect(reply?.values.text).toMatch(/no se pudo agendar/);
  });

  it("F: concurrencia simulada — de dos ejecuciones con los MISMOS messageIds, exactamente una crea la cita", async () => {
    catalogoParaPrompt.mockResolvedValue([SERVICIO]);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [{ servicios: ["corte de cabello"], fecha: "2026-08-10", hora: "10:00" }],
      },
      raw: "{}",
    });
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: null });
    crearCitaMultiple.mockResolvedValue({ ok: true, staffName: "Ana" });
    // El "atómico" real es el UNIQUE de Postgres (ver
    // tests/integration/citas-idempotencia.test.ts, no ejecutado en esta
    // sesión por falta de TEST_DATABASE_URL); aquí se simula su resultado
    // determinista: la primera ejecución gana el registro, la segunda
    // (aunque corra "al mismo tiempo" en la realidad) pierde.
    registrarConfirmacionDeCita
      .mockResolvedValueOnce({ primeraVez: true })
      .mockResolvedValueOnce({ primeraVez: false });
    citasActivasDeContacto.mockResolvedValue([
      {
        id: "cit_ya_creada",
        serviceId: "svc_1",
        serviceName: "Corte de cabello",
        staffId: "st_1",
        staffName: "Ana",
        startsAt: new Date("2026-08-10T15:00:00Z"),
        endsAt: new Date("2026-08-10T15:30:00Z"),
      },
    ]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    // Dos "workers" procesando el mismo lote de mensajes, uno tras otro (el
    // orden real de ejecución concurrente no es reproducible en un test
    // unitario de un solo hilo — lo que sí es real es que el SEGUNDO
    // registro, sin importar cuándo corra, pierde el atómico). Cada
    // ejecución encola su PROPIO lote fresco justo antes de correr: por el
    // momento en que la primera ya resolvió del todo, lo que le sobró de su
    // lote no vuelve a leerse nunca.
    selectQueue.length = 0;
    queueTurnoBase();
    await runAgentTurn("cv_citas");
    // Lo que le sobró del lote a la primera ejecución (lecturas que no
    // necesitó) NO debe colarse por delante de los datos de la segunda.
    selectQueue.length = 0;
    queueTurnoBase();
    await runAgentTurn("cv_citas");

    expect(registrarConfirmacionDeCita).toHaveBeenCalledTimes(2);
    expect(crearCitaMultiple).toHaveBeenCalledTimes(1); // exactamente UNA creación real
  });
});
