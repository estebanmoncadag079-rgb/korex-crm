import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Venta perdida real (Jorge, La Churra, 2-ago-2026 18:32 Colombia).
 *
 * El cliente escribió "Azur y canela" y 11 s después se corrigió con "Azúcar
 * y canela", cuando el agente ya estaba respondiendo. El segundo mensaje
 * quedó encolado y disparó un SEGUNDO turno en cuanto terminó el primero —
 * un turno sin nada que contestar, porque el historial ya terminaba en la
 * respuesta del propio agente. `toChatHistory` la mapea como `assistant`, y
 * con el array terminado en `assistant` google/gemini-2.5-flash devuelve
 * `content: null`: el turno se daba por fallido y disparaba el handoff de
 * error. El cliente, a un paso de cerrar el pedido, recibió "te comunico con
 * una persona" y no volvió a escribir.
 *
 * Ese segundo turno ahora se omite ANTES de llamar al modelo.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...a: unknown[]) => chatJson(...a) }));

const notifyTeam = vi.fn();
const contactPhoneOf = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
  contactPhoneOf: (...a: unknown[]) => contactPhoneOf(...a),
}));

const sendText = vi.fn();
vi.mock("@/server/inbox/send", () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  SendError: class SendError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

const selectQueue: unknown[][] = [];

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
    insert: () => ({
      values: () => {
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([{}]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
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
  id: "cv_jorge",
  organizationId: "org_churra",
  contactId: "ct_jorge",
  isTest: false,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};

const PROFILE = {
  id: "agp_1",
  organizationId: "org_churra",
  enabled: true,
  appointmentsEnabled: false,
  name: "Churr@",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  hoursOpen: "08:00",
  hoursClose: "23:59",
  hoursDays: "1,2,3,4,5,6,7",
};

const t = (s: number) => new Date(2026, 7, 2, 18, 32, s);

describe("runAgentTurn: un turno sin nada nuevo que responder", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    sendText.mockReset().mockResolvedValue({ messageId: "msg_x" });
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
  });

  it("el caso Jorge: el historial ya termina en la respuesta del agente → ni se llama al modelo", async () => {
    selectQueue.push(
      [CONVERSATION],
      [PROFILE],
      // La consulta real los trae del más nuevo al más viejo (`desc`) y el
      // código los invierte: el mock respeta ese orden.
      [
        {
          id: "m3",
          direction: "out",
          text: "¡Excelente elección! Azúcar y canela para tus churritos. 😋",
          aiGenerated: true,
          createdAt: t(34),
        },
        { id: "m2", direction: "in", text: "Azúcar y canela", createdAt: t(33) },
        { id: "m1", direction: "in", text: "Azur y canela", createdAt: t(22) },
      ]
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const accion = await runAgentTurn("cv_jorge");

    expect(accion).toBeNull();
    expect(chatJson).not.toHaveBeenCalled(); // no se gasta una llamada al modelo
    expect(sendText).not.toHaveBeenCalled(); // y NO le llega el "te comunico con una persona"
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("con un mensaje del cliente al final, el turno corre normal", async () => {
    selectQueue.push(
      [CONVERSATION],
      [PROFILE],
      [
        { id: "m2", direction: "in", text: "De arequipe", createdAt: t(30) },
        {
          id: "m1",
          direction: "out",
          text: "¿Con qué salsita?",
          aiGenerated: true,
          createdAt: t(20),
        },
      ],
      [], // kb
      [], // etapas
      [] // contacto
    );
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "¡De arequipe entonces!" },
      usage: { promptTokens: 10, completionTokens: 5 },
      model: "test",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const accion = await runAgentTurn("cv_jorge");

    expect(chatJson).toHaveBeenCalled();
    expect(accion).toMatchObject({ action: "reply" });
  });
});
