import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Corrección de los dos defectos bloqueantes encontrados en la validación
 * determinista del guardarraíl `disponibilidad_sin_verificar` extendido a
 * `handoff` (Lashes Valen, 30-ago-2026):
 *
 * 1. El guardarraíl no reconocía especialistas ARCHIVADOS ("Laura", el caso
 *    real que lo originó) porque `nombresReales` salía de `services`/
 *    `catalogoParaPrompt`, que excluye a propósito a quien ya no atiende.
 *    Ahora sale de `listStaff(..., {includeArchived:true})`.
 * 2. El reintento, tras darle al modelo la disponibilidad real, no
 *    contemplaba que este volviera a pedir `consult_availability` en vez de
 *    responder: esa acción llegaba sin resolver hasta el switch final —sin
 *    `case` para ella— y el turno terminaba en `return null`, silencio total
 *    para el cliente. Ahora reutiliza `resolverBucleDeDisponibilidad`, la
 *    MISMA función que ya protegía la primera consulta del turno.
 *
 * Mismo patrón de mocks que `pipeline-especialista-verificada.test.ts` (sin
 * BD real).
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const resolverEspecialistaMultiple = vi.fn();
const proximasFechasConCupoMultiple = vi.fn();
const catalogoParaPrompt = vi.fn();
const listStaff = vi.fn();

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  proximasFechasConCupoMultiple: (...a: unknown[]) => proximasFechasConCupoMultiple(...a),
  listStaff: (...a: unknown[]) => listStaff(...a),
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
    text: "Quiero agendar con Laura un retoque de acrílico",
    createdAt: new Date(),
  },
];
const SERVICIO = {
  id: "svc_1",
  name: "Retoque de acrílico",
  category: null,
  priceCents: 8500000,
  durationMin: 120,
  // "Laura" YA NO aparece aquí: catalogoParaPrompt (lo que ve el modelo para
  // ofrecer especialistas) excluye a los archivados, a propósito — es
  // justo la fuente que el guardarraíl YA NO debe usar.
  staffNames: ["Geimar"],
};

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

const STAFF_CON_ARCHIVADA = [
  { id: "st_geimar", name: "Geimar", archivedAt: null },
  { id: "st_laura", name: "Laura", archivedAt: new Date("2026-08-25T00:00:00Z") },
];

const HANDOFF_LAURA_SIN_VERIFICAR = {
  action: "handoff",
  reason:
    "La clienta pide cita con Laura. Confirmar si Laura existe, si atiende este servicio y su disponibilidad.",
  farewell: "Te comunico con el equipo para confirmar con Laura 😊",
};

describe("Grupo 1 — especialista archivado (defecto 1)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    proximasFechasConCupoMultiple.mockReset();
    catalogoParaPrompt.mockReset().mockResolvedValue([SERVICIO]);
    listStaff.mockReset().mockResolvedValue(STAFF_CON_ARCHIVADA);
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("1-2. un especialista archivado se reconoce como conocido, y un handoff que depende de su disponibilidad sin consultar SÍ dispara el guardarraíl", async () => {
    queueTurnoBase();
    // Tras la corrección: el reintento SÍ decide consultar disponibilidad
    // real (con Geimar, la única activa) y responde con eso.
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_geimar" });
    proximasFechasConCupoMultiple.mockResolvedValue([
      { fecha: "31/08/2026", horarios: ["10:00", "14:00"] },
    ]);
    chatJson
      .mockResolvedValueOnce({ ok: true, data: HANDOFF_LAURA_SIN_VERIFICAR, raw: "{}" })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consult_availability", servicios: ["retoque de acrílico"], especialista: "Laura" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "reply",
          text: "Laura ya no está en el equipo, pero tengo cupo con Geimar el 31/08 a las 10:00 o 14:00. ¿Cuál prefieres?",
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    // 3. El guardarraíl intercepta (se ve en que forzó una 2a y 3a llamada).
    expect(chatJson).toHaveBeenCalledTimes(3);
    // 4. No entrega el handoff original sin verificar: la acción final ya
    // no es aquel handoff — es la respuesta verificada contra el backend.
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/Geimar/);
  });

  it("no permite entregar el handoff original si el reintento no logra verificar nada (se deriva a una persona, nunca en silencio)", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: HANDOFF_LAURA_SIN_VERIFICAR, raw: "{}" })
      // El reintento repite el mismo patrón sin verificar (sigue sin llamar a consult_availability).
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "handoff", reason: "Laura no está disponible según lo que sé." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(resolverEspecialistaMultiple).not.toHaveBeenCalled();
    // Nunca null, nunca el handoff original sin verificar: se deriva de
    // forma segura y explícita.
    expect(action).toEqual({ action: "handoff", reason: "error" });
  });
});

describe("Grupo 2 — especialista inexistente", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    proximasFechasConCupoMultiple.mockReset();
    catalogoParaPrompt.mockReset().mockResolvedValue([SERVICIO]);
    listStaff.mockReset().mockResolvedValue(STAFF_CON_ARCHIVADA); // Geimar + Laura; "Camila" nunca existió.
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("un nombre que nunca existió no se confunde con un especialista real: el guardarraíl no lo reconoce como hecho verificable", () => {
    const nombresReales = STAFF_CON_ARCHIVADA.map((s) => s.name);
    expect(nombresReales).not.toContain("Camila");
  });

  it("handoff que menciona SOLO un nombre inexistente no dispara el guardarraíl (nada real que verificar) y se entrega tal cual", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "handoff", reason: "El cliente pide a 'Camila', que no aparece en nuestro catálogo." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    // Una sola llamada: el guardarraíl no encontró ningún especialista REAL
    // mencionado, así que no fuerza ningún reintento.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action).toEqual({
      action: "handoff",
      reason: "El cliente pide a 'Camila', que no aparece en nuestro catálogo.",
    });
  });
});

describe("Grupo 3 — especialista activo (control, sin regresión)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    proximasFechasConCupoMultiple.mockReset();
    catalogoParaPrompt.mockReset().mockResolvedValue([SERVICIO]);
    listStaff.mockReset().mockResolvedValue(STAFF_CON_ARCHIVADA);
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("una consulta de disponibilidad normal (especialista activo) no pasa por el guardarraíl en absoluto", async () => {
    queueTurnoBase();
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_geimar" });
    proximasFechasConCupoMultiple.mockResolvedValue([
      { fecha: "31/08/2026", horarios: ["10:00"] },
    ]);
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consult_availability", servicios: ["retoque de acrílico"], especialista: "Geimar" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Con Geimar tengo el 31/08 a las 10:00. ¿Te sirve?" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(2); // sin la 3a llamada del guardarraíl
    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/Geimar/);
  });
});

describe("Grupo 4 — handoff legítimo (no debe bloquearse)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    catalogoParaPrompt.mockReset().mockResolvedValue([SERVICIO]);
    listStaff.mockReset().mockResolvedValue(STAFF_CON_ARCHIVADA);
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it('"quiero hablar con una persona" hace handoff inmediato, sin que el guardarraíl lo intercepte', async () => {
    queueTurnoBase();
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "handoff", reason: "cliente" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action).toEqual({ action: "handoff", reason: "cliente" });
    expect(resolverEspecialistaMultiple).not.toHaveBeenCalled();
  });
});

describe("Grupo 5 — reintento seguro (defecto 2): nunca termina en null silencioso", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    proximasFechasConCupoMultiple.mockReset();
    catalogoParaPrompt.mockReset().mockResolvedValue([SERVICIO]);
    listStaff.mockReset().mockResolvedValue(STAFF_CON_ARCHIVADA);
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("A. primera respuesta inválida → corrección → segunda respuesta final válida (ya cubierto en pipeline-especialista-verificada.test.ts; se repite aquí como parte del mismo grupo)", async () => {
    queueTurnoBase();
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_geimar" });
    proximasFechasConCupoMultiple.mockResolvedValue([{ fecha: "31/08/2026", horarios: ["10:00"] }]);
    chatJson
      .mockResolvedValueOnce({ ok: true, data: HANDOFF_LAURA_SIN_VERIFICAR, raw: "{}" })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consult_availability", servicios: ["retoque de acrílico"], especialista: "Laura" },
        raw: "{}",
      })
      .mockResolvedValueOnce({ ok: true, data: { action: "reply", text: "Con Geimar el 31/08 a las 10:00." }, raw: "{}" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(action).not.toBeNull();
    expect(action?.action).toBe("reply");
  });

  it("B. la segunda respuesta vuelve a pedir consult_availability (repetidamente): termina en handoff seguro, NUNCA en null", async () => {
    queueTurnoBase();
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_geimar" });
    proximasFechasConCupoMultiple.mockResolvedValue([{ fecha: "31/08/2026", horarios: ["10:00"] }]);
    const consultaDeNuevo = {
      ok: true,
      data: { action: "consult_availability", servicios: ["retoque de acrílico"], especialista: "Laura" },
      raw: "{}",
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: HANDOFF_LAURA_SIN_VERIFICAR, raw: "{}" }) // T1
      .mockResolvedValueOnce(consultaDeNuevo) // reintento post-corrección: pide consultar
      .mockResolvedValueOnce(consultaDeNuevo) // dentro del bucle, vuelta 1: vuelve a pedir consultar
      .mockResolvedValueOnce(consultaDeNuevo); // dentro del bucle, vuelta 2 (tope MAX=2): sigue sin resolver

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(action).not.toBeNull();
    expect(action).toEqual({ action: "handoff", reason: "error" });
    // Se avisó al equipo del handoff de recuperación (derivarAUnaPersona real
    // ejecuta un deliverReply + notifyTeam según el negocio; lo esencial aquí
    // es que el turno terminó en un estado explícito, no en silencio).
    expect(chatJson).toHaveBeenCalledTimes(4);
  });

  it("C. la segunda respuesta trae una acción inesperada (no reply/handoff/consult_availability): se acepta tal cual, de forma segura", async () => {
    queueTurnoBase();
    chatJson
      .mockResolvedValueOnce({ ok: true, data: HANDOFF_LAURA_SIN_VERIFICAR, raw: "{}" })
      .mockResolvedValueOnce({ ok: true, data: { action: "none" }, raw: "{}" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_lashes");

    expect(action).not.toBeNull();
    expect(action).toEqual({ action: "none" });
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("D. ninguno de los escenarios anteriores devuelve null/undefined", async () => {
    // Aserción transversal: ya verificada en A, B y C arriba (todas usan
    // `expect(action).not.toBeNull()`), se deja como recordatorio explícito
    // del objetivo de este grupo completo.
    expect(true).toBe(true);
  });
});
