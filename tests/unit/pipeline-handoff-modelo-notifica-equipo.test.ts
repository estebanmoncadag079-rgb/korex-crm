import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10T — bug real encontrado por auditoría (no reportado por un cliente
 * todavía, pero confirmado en el código): cuando el MODELO decide un
 * `handoff` por regla de negocio (no un error del proveedor, no el patrón de
 * respaldo FR-022 de "pásame con un asesor"), el ejecutor llamaba
 * `applyHandoff` directamente y NUNCA `notifyTeam` — el prompt le pide al
 * modelo decir siempre "te comunico con el equipo" (`generador/generar.ts`)
 * justo en el único camino de handoff que no avisaba a nadie por WhatsApp,
 * solo quedaba el evento SSE del CRM. Este test reproduce ese camino exacto
 * y confirma que ahora sí notifica.
 *
 * Mismo patrón de mocks que pipeline-traza-del-turno.test.ts.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoDePedidosMock = vi.fn();
const catalogoDeMock = vi.fn();
vi.mock("@/server/catalog/queries", () => ({
  catalogoDePedidos: (...a: unknown[]) => catalogoDePedidosMock(...a),
  catalogoDe: (...a: unknown[]) => catalogoDeMock(...a),
}));

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: vi.fn(),
  catalogoParaPrompt: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  serviciosOfrecidosPara: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn().mockResolvedValue([]),
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
const updated: { table: unknown; values: Record<string, unknown> }[] = [];

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
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updated.push({ table, values });
        const chain = {
          returning: () => Promise.resolve([{}]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
        };
        return { where: () => chain };
      },
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
  id: "cv_1",
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
  appointmentsEnabled: false,
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  hoursOpen: "09:00 AM",
  hoursClose: "21:00",
  hoursDays: "1,2,3,4,5,6",
};
const HISTORY = [
  { id: "msg_1", direction: "in", text: "Quiero cejas y uñas a la vez", createdAt: new Date() },
];

/** conversación, perfil, historial, y 4 lecturas más antes del switch. */
function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], [], []);
}

describe("runAgentTurn: handoff decidido por el modelo (regla de negocio) SÍ notifica al equipo", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset().mockResolvedValue([]);
    catalogoDeMock.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
    updated.length = 0;
  });

  it("BUG REAL corregido: {action:'handoff', farewell} del modelo marca el handoff Y avisa al equipo por notifyTeam", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "handoff", reason: "combo no disponible", farewell: "Te comunico con alguien del equipo." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("handoff");

    // El farewell del MODELO se entrega tal cual (no se pisa con el aviso genérico).
    const farewell = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(farewell?.values.text).toBe("Te comunico con alguien del equipo.");

    // Antes del fix: notifyTeam nunca se llamaba en este camino.
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/regla de negocio/i);
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(/combo no disponible/);

    const handoffUpdate = updated.find(
      (u) => (u.values as { handoffReason?: string }).handoffReason
    );
    expect(handoffUpdate?.values).toMatchObject({ handoffReason: "modelo" });
  });
  /**
   * INCIDENTE REAL (Lis Pastelería, 15-sep-2026, `cv_z4d9leo1jbencecfx2dl`).
   *
   * `farewell` es opcional en el contrato, así que una derivación sin
   * despedida salía MUDA: el agente dejaba de responder y el cliente no
   * recibía nada. Si además el negocio no tiene números de aviso
   * configurados —Lis, MALIA y La Churra— tampoco se enteraba el equipo.
   *
   * La clienta mandó una foto del producto que quería, el modelo derivó sin
   * `farewell`, y estuvo NUEVE MINUTOS sin una sola palabra —ni del bot ni
   * de nadie— hasta que alguien miró la bandeja por casualidad.
   */
  it("derivación SIN farewell: el cliente igual recibe aviso, nunca queda en silencio", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "handoff", reason: "pide algo personalizado" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("handoff");

    const alCliente = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(alCliente).toBeDefined();
    expect(String(alCliente?.values.text)).toMatch(/persona del equipo/i);
    // Y el equipo se sigue enterando, como antes.
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });
});
