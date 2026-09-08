import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10V, Hallazgo D (auditoría) — la ventana real:
 *
 *   registro de idempotencia exitoso → crash/error → efecto real NO
 *   completado → reintento → la clave ya está tomada, nunca se repara.
 *
 * `notify_order`: `notifyTeam` NUNCA lanza (cada envío tiene su propio
 * try/catch, ver notify-team.ts) — el único punto que puede lanzar ANTES
 * del aviso real es `contactPhoneOf`; `appendLeadNote` puede lanzar
 * DESPUÉS. Deshacer la clave solo es seguro en el primer caso.
 *
 * `book_appointment`: `crearCitaMultiple` sí puede lanzar un error
 * inesperado (no el `sin_cupo`/`fuera_de_horario` que ya maneja sin
 * lanzar). Deshacer la clave solo es seguro si NINGUNA reserva del lote se
 * creó todavía.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const notifyTeam = vi.fn();
const contactPhoneOf = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
  contactPhoneOf: (...a: unknown[]) => contactPhoneOf(...a),
}));

const borrarConfirmacionDePedido = vi.fn();
vi.mock("@/server/ai/confirmacion-de-pedido", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ai/confirmacion-de-pedido")>();
  return {
    ...real, // registrarConfirmacionDePedido REAL, contra el mock de @/lib/db
    borrarConfirmacionDePedido: (...a: Parameters<typeof borrarConfirmacionDePedido>) =>
      borrarConfirmacionDePedido(...a),
  };
});

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

const borrarConfirmacionDeCita = vi.fn();
vi.mock("@/server/ai/confirmacion-de-cita", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ai/confirmacion-de-cita")>();
  return {
    ...real, // registrarConfirmacionDeCita REAL, contra el mock de @/lib/db
    borrarConfirmacionDeCita: (...a: Parameters<typeof borrarConfirmacionDeCita>) =>
      borrarConfirmacionDeCita(...a),
  };
});

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

/**
 * Controlable por test: simula que `appendLeadNote` (un `db.update`) falla.
 * `runAgentTurn` ya hace un `db.update` PROPIO más temprano en el turno
 * (marca `lastTurnInboundAt`) — ese SIEMPRE debe seguir funcionando; el
 * fallo simulado solo debe golpear el `update` de `appendLeadNote`, que es
 * el SEGUNDO en ocurrir. Contar en vez de adivinar la tabla evita depender
 * de la forma interna del proxy de `schema`.
 */
let updateDebeFallar = false;
let updateLlamadas = 0;

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
    update: () => {
      updateLlamadas++;
      if (updateDebeFallar && updateLlamadas === 2) throw new Error("fallo al anotar la nota");
      return {
        set: () => ({
          where: () => {
            const chain = {
              returning: () => Promise.resolve([{}]),
              then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
            };
            return chain;
          },
        }),
      };
    },
    delete: () => ({ where: () => Promise.resolve() }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

function conversacionPedidos() {
  return {
    id: "cv_pedidos",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}
const PROFILE_PEDIDOS = {
  id: "agp_1",
  organizationId: "org_1",
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
};
const HISTORY_PEDIDOS = [
  { id: "msg_1", direction: "in", text: "quiero un cremoso", createdAt: new Date() },
  {
    id: "msg_2",
    direction: "out",
    text: "Resumen: 1 Cremoso — $18.000. Total: $18.000. ¿Confirmas?",
    createdAt: new Date(),
  },
  { id: "msg_3", direction: "in", text: "Confirmo", createdAt: new Date() },
];
const CIERRE = {
  action: "notify_order",
  summary: "1 Cremoso — $18.000. Total: $18.000",
  farewell: "¡Listo!",
};

function queueTurnoPedidos() {
  // `runAgentTurn` lee con `ORDER BY created_at DESC` y revierte
  // internamente: el historial se encola del más nuevo al más viejo.
  // Padding con una fila de contacto válida (no `[]`): `appendLeadNote`
  // hace su propia lectura de `contact` más adelante en el turno, y
  // necesita encontrar algo para llegar a su `update`.
  selectQueue.push(
    [conversacionPedidos()],
    [PROFILE_PEDIDOS],
    [...HISTORY_PEDIDOS].reverse(),
    [],
    [],
    [],
    [{ id: "ct_1", notes: null }],
    [{ id: "ct_1", notes: null }],
    [{ id: "ct_1", notes: null }]
  );
}

describe("Fase 10V, Hallazgo D — notify_order: fallo parcial entre el registro y el efecto", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue("573113840785");
    borrarConfirmacionDePedido.mockReset().mockResolvedValue(undefined);
    selectQueue.length = 0;
    inserted.length = 0;
    updateDebeFallar = false;
    updateLlamadas = 0;
  });

  it("BUG REAL corregido: contactPhoneOf lanza ANTES de registrar la confirmación -> el turno falla y NUNCA llega a tomar la clave de idempotencia (nada que deshacer)", async () => {
    // Fase 11-B — `contactPhoneOf` ahora se resuelve ANTES de
    // `registrarConfirmacionDePedido` (el teléfono se guarda en la fila,
    // para que un reintento posterior de la notificación lo tenga sin
    // volver a preguntarlo): si falla aquí, la clave de idempotencia ni
    // siquiera se intenta tomar — no hay nada que `borrarConfirmacionDePedido`
    // necesite deshacer, a diferencia del escenario anterior (donde el
    // registro sí llegaba a ocurrir primero).
    queueTurnoPedidos();
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: "{}" });
    contactPhoneOf.mockRejectedValue(new Error("DB caída"));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await expect(runAgentTurn("cv_pedidos")).rejects.toThrow("DB caída");

    // notifyTeam NUNCA se llegó a intentar.
    expect(notifyTeam).not.toHaveBeenCalled();
    // Y tampoco se llegó a REGISTRAR nada que deshacer: la clave de
    // idempotencia nunca se intentó tomar.
    expect(borrarConfirmacionDePedido).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("appendLeadNote lanza DESPUÉS de que notifyTeam ya se envió -> NO se deshace (evitaría duplicar el aviso real), el turno no se cae", async () => {
    queueTurnoPedidos();
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: "{}" });
    // appendLeadNote real hace un `db.update(...)` — se simula su fallo
    // solo para esta prueba (el flag se resetea en beforeEach).
    updateDebeFallar = true;

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    // El turno NO se cae: el pedido queda avisado igual.
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    // Y, crucialmente, NO se deshizo la idempotencia — habría arriesgado
    // duplicar el WhatsApp real al equipo en un reintento.
    expect(borrarConfirmacionDePedido).not.toHaveBeenCalled();
  });
});

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
const CONVERSATION_CITAS = {
  id: "cv_citas",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};
const PROFILE_CITAS = {
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
const HISTORY_CITAS = [{ id: "msg_1", direction: "in", text: "hola", createdAt: new Date() }];

function queueTurnoCitas() {
  selectQueue.push(
    [CONVERSATION_CITAS],
    [PROFILE_CITAS],
    HISTORY_CITAS,
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

describe("Fase 10V, Hallazgo D — book_appointment: fallo parcial entre el registro y la creación", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    resolverEspecialistaMultiple.mockReset();
    crearCitaMultiple.mockReset();
    citasActivasDeContacto.mockReset();
    catalogoParaPrompt.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    borrarConfirmacionDeCita.mockReset().mockResolvedValue(undefined);
    selectQueue.length = 0;
    inserted.length = 0;
    updateDebeFallar = false;
    updateLlamadas = 0;
  });

  it("BUG REAL corregido: crearCitaMultiple lanza y NADA se creó todavía -> se deshace la idempotencia y el turno falla (permite reintento real)", async () => {
    queueTurnoCitas();
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
    crearCitaMultiple.mockRejectedValue(new Error("conexión perdida"));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await expect(runAgentTurn("cv_citas")).rejects.toThrow("conexión perdida");

    expect(borrarConfirmacionDeCita).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_citas", messageIds: ["msg_1"] })
    );
  });

  it("crearCitaMultiple lanza en la SEGUNDA reserva, tras ya haber creado la primera -> NO se deshace (evitaría duplicar la ya creada), el turno reporta ambas honestamente", async () => {
    queueTurnoCitas();
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
      .mockResolvedValueOnce({ ok: true, staffName: "Ana" }) // primera reserva: éxito
      .mockRejectedValueOnce(new Error("conexión perdida")); // segunda: error inesperado

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_citas");

    // El turno NO se cae: se reporta lo que sí se logró.
    expect(action?.action).toBe("book_appointment");
    expect(crearCitaMultiple).toHaveBeenCalledTimes(2);
    // Crucial: NO se deshizo la idempotencia — habría arriesgado duplicar
    // la cita de "Corte de cabello" que sí se creó, en un reintento.
    expect(borrarConfirmacionDeCita).not.toHaveBeenCalled();
    const reply = inserted.find((i) => (i.values as { direction?: string }).direction === "out");
    expect(reply?.values.text).toMatch(/Quedaste agendada.*Corte de cabello/s);
    expect(reply?.values.text).toMatch(/error inesperado/);
  });
});
