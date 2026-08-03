import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El patrón de respaldo de handoff (FR-022, matchesHandoffIntent en
 * @/server/ai/handoff) corta el turno ANTES de llamar al modelo cuando el
 * cliente pide explícitamente un asesor/humano. Hasta el 3-ago-2026 eso
 * marcaba el handoff en silencio, sin avisar ni al cliente ni al equipo —
 * caso real verificado en Lis Pastelería: "me puedes pasar con un asesor?"
 * se quedó sin ninguna respuesta del bot, y como Lis no tiene número de
 * aviso, nadie se enteró. Ahora usa el mismo mecanismo que la derivación
 * por error (avisa al cliente con el mensaje neutro y notifica al equipo).
 *
 * Mismo patrón de mocking que pipeline-appointments-dispatch.test.ts.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

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
  hoursOpen: "08:00",
  hoursClose: "18:00",
  hoursDays: "1,2,3,4,5,6",
};
const HISTORY = [
  {
    id: "msg_1",
    direction: "in",
    text: "me puedes pasar con un asesor?",
    createdAt: new Date(),
  },
];

describe("runAgentTurn: el cliente pide un asesor (patrón de respaldo FR-022)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
    updated.length = 0;
  });

  it("avisa al cliente, notifica al equipo, marca handoff='cliente' y NO llama al modelo", async () => {
    selectQueue.push([CONVERSATION], [PROFILE], HISTORY);

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action).toEqual({ action: "handoff", reason: "cliente" });
    expect(chatJson).not.toHaveBeenCalled();

    const aviso = inserted.find(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    expect(aviso?.values.text).toMatch(/te comunico con una persona/i);

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(notifyTeam.mock.calls[0]![0].summary).toMatch(
      /pidió hablar con una persona/i
    );

    const handoffUpdate = updated.find(
      (u) => (u.values as { handoffReason?: string }).handoffReason
    );
    expect(handoffUpdate?.values).toMatchObject({ handoffReason: "cliente" });
  });
});
