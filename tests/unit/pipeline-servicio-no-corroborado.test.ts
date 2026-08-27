import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confirmación por servicio antes de `book_appointment`
 * (docs/korexia/149-CONFIRMACION-POR-SERVICIO-EN-CITAS.md).
 *
 * Incidente real (Lashes Valen, 26-27-ago-2026): una visita de VARIOS
 * servicios ("manos y pies") se agendó cuando el modelo solo había consultado
 * disponibilidad para uno. `offered_slot` guardaba el HORARIO, así que el
 * filtro anterior (`estaEntreLosOfrecidos`) pasaba; nadie comprobaba QUÉ
 * servicios se habían consultado para ese horario.
 *
 * Ahora `book_appointment` compara —servicio a servicio— la combinación que
 * intenta agendar contra la que de verdad se consultó junta para esa
 * fecha+hora, usando `serviciosOfrecidosPara`. El guardarraíl:
 *  - NUNCA corre para visitas de un solo servicio (cero regresión).
 *  - Es permisivo si no hay nada registrado para ese horario (fecha/hora
 *    directa, igual que `estaEntreLosOfrecidos`).
 *  - Bloquea solo cuando un servicio pedido NO estaba entre los consultados.
 *
 * `serviciosOfrecidosPara` se MOCKEA aquí a propósito: qué quedó "ofrecido"
 * para un horario es un hecho de la base, no algo que deba producir un LLM
 * real. Mismo patrón de mocks que pipeline-reservas-multiples.test.ts.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const resolverEspecialistaMultiple = vi.fn();
const crearCitaMultiple = vi.fn();
const catalogoParaPrompt = vi.fn();
const serviciosOfrecidosPara = vi.fn();
const estaEntreLosOfrecidos = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  crearCitaMultiple: (...a: unknown[]) => crearCitaMultiple(...a),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn().mockResolvedValue([]),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  disponibilidadRealMultiple: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
  estaEntreLosOfrecidos: (...a: unknown[]) => estaEntreLosOfrecidos(...a),
  serviciosOfrecidosPara: (...a: unknown[]) => serviciosOfrecidosPara(...a),
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
const HISTORY = [{ id: "msg_1", direction: "in", text: "hola", createdAt: new Date() }];

// Visita de dos servicios ("manos y pies"): la misma especialista atiende ambos.
const MANOS = {
  id: "svc_manos",
  name: "Manicure",
  category: null,
  priceCents: 3000000,
  durationMin: 45,
  staffNames: ["Vale"],
};
const PIES = {
  id: "svc_pies",
  name: "Pedicure",
  category: null,
  priceCents: 3500000,
  durationMin: 60,
  staffNames: ["Vale"],
};

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

function bookAppointment(servicios: string[]) {
  return {
    ok: true as const,
    data: {
      action: "book_appointment",
      reservas: [
        { servicios, fecha: "2026-08-28", hora: "15:30", especialista: "Vale" },
      ],
    },
    raw: "{}",
  };
}

function replyText(): string {
  const reply = inserted.find(
    (i) => (i.values as { direction?: string }).direction === "out"
  );
  return String((reply?.values as { text?: string })?.text ?? "");
}

describe("runAgentTurn: confirmación por servicio antes de agendar", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset().mockResolvedValue({ ok: true, staffId: "st_vale" });
    crearCitaMultiple.mockReset().mockResolvedValue({ ok: true, staffName: "Vale" });
    catalogoParaPrompt.mockReset().mockResolvedValue([MANOS, PIES]);
    serviciosOfrecidosPara.mockReset();
    estaEntreLosOfrecidos.mockReset().mockResolvedValue({ ok: true });
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // Caso 1 — un solo servicio: el chequeo NUNCA corre. Sin cambio de conducta.
  it("Caso 1: una visita de UN solo servicio se agenda sin consultar la combinación", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue(bookAppointment(["manicure"]));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(serviciosOfrecidosPara).not.toHaveBeenCalled();
    expect(crearCitaMultiple).toHaveBeenCalledTimes(1);
    expect(replyText()).toMatch(/Quedaste agendada/);
  });

  // Caso 2 — varios servicios, todos consultados juntos: coincide, se agenda.
  it("Caso 2: dos servicios, ambos consultados para ese horario, se agenda", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue(bookAppointment(["manicure", "pedicure"]));
    serviciosOfrecidosPara.mockResolvedValue(["svc_manos", "svc_pies"]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(serviciosOfrecidosPara).toHaveBeenCalledWith(
      "org_1",
      "cv_citas",
      "28/08/2026",
      "15:30"
    );
    expect(crearCitaMultiple).toHaveBeenCalledTimes(1);
    expect(replyText()).toMatch(/Quedaste agendada/);
  });

  // Caso 3 — respuesta compacta ("Sí, tradicional") que el modelo interpretó
  // como confirmando AMBOS servicios ANTES de consultar: como el modelo ya
  // incluyó los dos en su consult_availability, `offered_slot` quedó con los
  // dos ids. Mecánicamente idéntico al Caso 2 (por eso se mockea el resultado
  // de la consulta, no la interpretación del LLM).
  it("Caso 3: el modelo consultó ambos servicios de antemano, se agenda", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue(bookAppointment(["manicure", "pedicure"]));
    serviciosOfrecidosPara.mockResolvedValue(["svc_pies", "svc_manos"]); // orden distinto: da igual

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(crearCitaMultiple).toHaveBeenCalledTimes(1);
    expect(replyText()).toMatch(/Quedaste agendada/);
  });

  // Caso 4 — un servicio PENDIENTE: se intenta agendar más de lo consultado.
  // Bloqueado, con el nombre del servicio sin corroborar en el motivo.
  it("Caso 4: intenta agendar un servicio que nunca se consultó: BLOQUEA y lo nombra", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue(bookAppointment(["manicure", "pedicure"]));
    // Solo se consultó "manos" para ese horario; "pies" nunca.
    serviciosOfrecidosPara.mockResolvedValue(["svc_manos"]);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    // No se creó la cita ni se avisó al equipo: no hay cita real de por medio.
    expect(crearCitaMultiple).not.toHaveBeenCalled();
    expect(notifyTeam).not.toHaveBeenCalled();

    const texto = replyText();
    expect(texto).toMatch(/no se pudo agendar/);
    expect(texto).toMatch(/Pedicure/); // nombra el servicio pendiente
    expect(texto).toMatch(/consult_availability/); // le dice cómo corregir

    // Evidencia diagnóstica en vivo: el console.warn de [citas] con el detalle.
    const advertencia = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("[citas] reserva rechazada") && l.includes("sin corroborar"));
    expect(advertencia).toBeTruthy();
    expect(advertencia).toContain("Pedicure");
  });

  // Caso 5 — respuesta ambigua: el modelo incluye un servicio que jamás pasó
  // por una consulta real. Mismo mecanismo que el Caso 4 (no se detecta
  // "ambigüedad" en texto; solo si el servicio pasó o no por consult_availability).
  it("Caso 5: servicio incluido sin haber pasado por consult_availability: BLOQUEA", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue(bookAppointment(["manicure", "pedicure"]));
    serviciosOfrecidosPara.mockResolvedValue(["svc_pies"]); // esta vez faltó "manos"

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(crearCitaMultiple).not.toHaveBeenCalled();
    const texto = replyText();
    expect(texto).toMatch(/no se pudo agendar/);
    expect(texto).toMatch(/Manicure/);
  });

  // Permisivo — nada registrado para ese horario (fecha/hora directa): NO
  // bloquea, igual que `estaEntreLosOfrecidos`. Evita sobre-bloquear el camino
  // directo que hoy funciona.
  it("permisivo: sin registro para ese horario (fecha directa), NO bloquea y agenda", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue(bookAppointment(["manicure", "pedicure"]));
    serviciosOfrecidosPara.mockResolvedValue([]); // el horario no pasó por consulta

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_citas");

    expect(crearCitaMultiple).toHaveBeenCalledTimes(1);
    expect(replyText()).toMatch(/Quedaste agendada/);
  });
});
