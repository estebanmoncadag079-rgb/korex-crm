import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8 contra el PIPELINE completo, para el negocio que no tiene tabla de
 * zonas (`delivery_source='prompt'`: La Churra, Lis).
 *
 * Los tests de `domicilio-sin-tarifa-verificable.test.ts` prueban el
 * detector puro. Este prueba lo que de verdad importaba: que el pipeline lo
 * LLAME en este caso. Antes no lo hacía —el `if` exigía una zona verificada,
 * imposible sin tabla— así que el detector estaba perfecto y no corría nunca.
 *
 * Y prueba lo contrario con el mismo cuidado: que un pedido que deja el
 * domicilio pendiente, o que repite una cifra que dio una PERSONA del
 * negocio, no se toca. Ese es el riesgo real de esta fase — el incidente de
 * Zahenz (7-sep-2026) derivó el 100% de los pedidos con domicilio por exigir
 * una prueba imposible, y el del 8/9-sep bloqueó un total que había cotizado
 * el equipo a mano con el cliente ya pagado.
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
const inserted: Record<string, unknown>[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
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
    { get: (_t, t) => new Proxy({}, { get: (_t2, c) => `${String(t)}.${String(c)}` }) }
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

/** La Churra / Lis: pedidos, SIN tabla de zonas. El domicilio lo cotiza Uber. */
const PROFILE_SIN_TABLA = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  appointmentsEnabled: false,
  deliverySource: "prompt",
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  hoursOpen: "08:00",
  hoursClose: "23:00",
  hoursDays: "1,2,3,4,5,6,7",
};

function queueTurno(history: Array<Record<string, unknown>>) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push([CONVERSATION], [PROFILE_SIN_TABLA], copia, [], [], []);
}

const PREGUNTA = [
  {
    id: "m1",
    direction: "in",
    text: "cuanto me sale con domicilio a Villa Colombia?",
    aiGenerated: false,
    createdAt: new Date(),
  },
];

function textoSaliente(): string | undefined {
  const m = inserted.find((i) => i.direction === "out");
  return m?.text as string | undefined;
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue(null);
  selectQueue.length = 0;
  inserted.length = 0;
});

describe("negocio sin tabla de zonas: el modelo no puede inventar una tarifa", () => {
  it("inventa '$5.000 de domicilio' -> el turno se rehace", async () => {
    queueTurno(PREGUNTA);
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "El domicilio a Villa Colombia son $5.000 🛵" },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "reply",
          text: "El domicilio lo cotizamos por la plataforma y te confirmamos el valor.",
        },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    // Dos llamadas = el guardarraíl disparó y pidió rehacer.
    expect(chatJson).toHaveBeenCalledTimes(2);
    // Y lo que sale es la respuesta corregida, no la inventada.
    expect(textoSaliente()).not.toContain("5.000");
  });

  it("dejar el domicilio pendiente, sin cifra, NO dispara nada", async () => {
    queueTurno(PREGUNTA);
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "Los churros son $20.000. El domicilio se cotiza aparte según tu dirección 🛵",
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    // Una sola llamada: el camino normal de estos negocios no se toca.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(textoSaliente()).toContain("20.000");
  });

  it("repetir la cifra que cotizó UNA PERSONA del negocio NO se bloquea", async () => {
    // Incidente real (MALIA, 8 y 9-sep-2026): el equipo cotiza a mano y el
    // bot repite ese número. Sin esta excepción, se bloquea un total que el
    // modelo no inventó — la segunda vez, con el cliente ya pagado.
    queueTurno([
      ...PREGUNTA,
      {
        id: "m2",
        direction: "out",
        text: "Hola! El domicilio hasta allá nos sale en $7.000",
        aiGenerated: false, // ← lo escribió una persona, no el bot
        createdAt: new Date(),
      },
      { id: "m3", direction: "in", text: "listo, entonces?", aiGenerated: false, createdAt: new Date() },
    ]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: { action: "reply", text: "Sí, el domicilio queda en $7.000 como te confirmaron 🛵" },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(textoSaliente()).toContain("7.000");
  });

  it("si insiste en inventar tras el reintento, lo toma una persona", async () => {
    queueTurno(PREGUNTA);
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "El domicilio son $5.000" },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "Te confirmo: el domicilio son $5.000" },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const accion = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(accion?.action).toBe("handoff");
  });
});
