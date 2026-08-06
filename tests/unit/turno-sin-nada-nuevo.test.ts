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

/** Los mensajes tal como se los pasa el pipeline al modelo (2º argumento). */
function mensajesDelModelo(): { role: string; content: string }[] {
  return chatJson.mock.calls[0]?.[1] ?? [];
}

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

  /**
   * Caso Tatis (Lis Pastelería, 5-ago-2026 13:47 Colombia): preguntó "¿ya
   * tienen servicio a domi?" y 4 s después eligió "1" del menú, cuando el
   * agente ya estaba respondiendo. Le contestaron lo del domicilio y el "1"
   * quedó guardado POR DETRÁS de esa respuesta: nunca recibió la carta, y
   * encima el turno siguiente derivó a un humano.
   *
   * Con la marca de hasta dónde llegó el turno anterior, el "1" se reconoce
   * como pendiente y se le pasa al modelo AL FINAL, después de la respuesta
   * ya enviada.
   */
  it("el caso Tatis: el mensaje que se coló va al final, después de la respuesta ya enviada", async () => {
    selectQueue.push(
      [{ ...CONVERSATION, lastTurnInboundAt: t(59) }], // el turno anterior llegó hasta "Depronto…"
      [PROFILE],
      [
        {
          id: "m3",
          direction: "out",
          text: "¡Claro que sí! 💗 Hacemos domicilios por medio de *Yango*…",
          aiGenerated: true,
          createdAt: t(64),
        },
        { id: "m2", direction: "in", text: "1", createdAt: t(63) },
        {
          id: "m1",
          direction: "in",
          text: "Depronto ya tienen servicio a domi?",
          createdAt: t(59),
        },
      ],
      [],
      [],
      []
    );
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "¡Aquí tienes nuestra carta! 💗" },
      usage: { promptTokens: 10, completionTokens: 5 },
      model: "test",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_jorge");

    const mensajes = mensajesDelModelo();
    const ultimo = mensajes[mensajes.length - 1]!;
    // Termina en el cliente, no en el agente: es lo que evita el `content: null`
    expect(ultimo.role).toBe("user");
    expect(ultimo.content).toBe("1");
    // Y la respuesta ya enviada queda ANTES, como contexto
    const posDomicilio = mensajes.findIndex((m) => m.content.includes("Yango"));
    expect(posDomicilio).toBeGreaterThan(-1);
    expect(posDomicilio).toBeLessThan(mensajes.length - 1);
  });

  it("con marca al día, un mensaje ya respondido no vuelve a disparar el turno", async () => {
    selectQueue.push(
      [{ ...CONVERSATION, lastTurnInboundAt: t(63) }], // ya se procesó hasta el "1"
      [PROFILE],
      [
        {
          id: "m3",
          direction: "out",
          text: "¡Aquí tienes nuestra carta! 💗",
          aiGenerated: true,
          createdAt: t(64),
        },
        { id: "m2", direction: "in", text: "1", createdAt: t(63) },
      ]
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const accion = await runAgentTurn("cv_jorge");

    expect(accion).toBeNull();
    expect(chatJson).not.toHaveBeenCalled();
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
