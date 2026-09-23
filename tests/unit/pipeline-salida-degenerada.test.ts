import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Una respuesta corrupta no puede llegar a WhatsApp (22-sep-2026, MALIA).
 *
 * El caso real salió con `}]}]}` pegado y restos del formato interno del
 * modelo. Pasó las dos validaciones que existían —`extractJson` y Zod— porque
 * las dos miran la FORMA del objeto, y el objeto estaba perfecto: la basura
 * viajaba DENTRO del string de `reply`. Nada miraba el texto.
 *
 * El gate va en el punto que el propio pipeline llama "la decisión final":
 * después de los ocho guardarraíles de texto que pueden reescribir `action`,
 * y antes de ejecutarla. Ponerlo justo tras la primera respuesta del modelo
 * habría dejado fuera todo lo que produce una segunda llamada
 * (`consult_product`, `consult_availability`, los reintentos de guardarraíl),
 * que es de donde sale el texto que lee el cliente en esos turnos.
 *
 * Mismo patrón de mocking que pipeline-handoff-cliente-pide-asesor.test.ts.
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
  stateSource: "prompt",
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  hoursOpen: "00:00",
  hoursClose: "23:59",
  hoursDays: "0,1,2,3,4,5,6",
};
const HISTORY = [
  { id: "msg_1", direction: "in", text: "hola, quiero dos de 7 onzas", createdAt: new Date() },
];

const BASURA = "Perfecto, te confirmo 😊 }]}]}";
const LIMPIA = "Perfecto 😊 ¿me confirmas para cuándo lo necesitas?";

function respuesta(text: string, finishReason?: string) {
  return {
    ok: true,
    data: { action: "reply", text },
    raw: JSON.stringify({ action: "reply", text }),
    usage: { model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0 },
    ...(finishReason ? { finishReason } : {}),
  };
}

function textosEnviados(): string[] {
  return inserted
    .filter((i) => (i.values as { direction?: string }).direction === "out")
    .map((i) => String((i.values as { text?: string }).text ?? ""));
}

describe("runAgentTurn: una salida degenerada no llega al cliente", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
    inserted.length = 0;
    updated.length = 0;
  });

  function colaDeUnTurno() {
    selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], [], [], [], [], []);
  }

  it("se reintenta UNA vez, y si el reintento sirve el cliente recibe la buena", async () => {
    colaDeUnTurno();
    chatJson.mockResolvedValueOnce(respuesta(BASURA)).mockResolvedValueOnce(respuesta(LIMPIA));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(textosEnviados()).toContain(LIMPIA);
    expect(textosEnviados().join(" ")).not.toContain("}]}]}");
  });

  it("si el reintento TAMPOCO sirve, lo toma una persona y la basura no sale", async () => {
    colaDeUnTurno();
    chatJson.mockResolvedValue(respuesta(BASURA));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action).toEqual({ action: "handoff", reason: "error" });
    expect(textosEnviados().join(" ")).not.toContain("}]}]}");
    expect(textosEnviados().join(" ")).toMatch(/te comunico con una persona/i);
    expect(notifyTeam).toHaveBeenCalled();
  });

  it("MÁXIMO un reintento: no encadena llamadas al modelo", async () => {
    colaDeUnTurno();
    chatJson.mockResolvedValue(respuesta(BASURA));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("una respuesta sana no gasta ni una llamada de más", async () => {
    colaDeUnTurno();
    chatJson.mockResolvedValue(respuesta(LIMPIA, "stop"));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(textosEnviados()).toContain(LIMPIA);
  });

  it("una respuesta que el proveedor cortó por longitud también se reintenta", async () => {
    colaDeUnTurno();
    chatJson
      .mockResolvedValueOnce(respuesta("Tu total es de", "length"))
      .mockResolvedValueOnce(respuesta(LIMPIA, "stop"));

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(textosEnviados()).toContain(LIMPIA);
  });
});
