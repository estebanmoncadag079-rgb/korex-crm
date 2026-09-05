import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase urgente (4-sep-2026) — BUG REAL confirmado y corregido: el mensaje
 * de despedida (`action.farewell`) que se le manda al CLIENTE al cerrar un
 * pedido vivía FUERA del `if(!primeraVez){...}else{...}` de idempotencia
 * en `pipeline.ts` — así que una re-ejecución del MISMO turno (mismos
 * mensajes disparadores; el escenario real que documenta
 * `rescatarHuerfanos` en `cola.ts`) correctamente no repetía el aviso al
 * EQUIPO (eso sí estaba protegido desde la Fase 10N-A), pero SÍ le
 * reenviaba al CLIENTE el mismo mensaje de confirmación una vez por cada
 * re-ejecución. Es la causa real, confirmada, del incidente reportado
 * ("el mismo mensaje de confirmación enviado ~3 veces").
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const notifyTeam = vi.fn();
const contactPhoneOf = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
  contactPhoneOf: (...a: unknown[]) => contactPhoneOf(...a),
}));

const sendText = vi.fn();
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...real, sendText: (...a: unknown[]) => sendText(...a) };
});

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

/**
 * `registrarConfirmacionDePedido` REAL (contra este mock de bajo nivel):
 * un `Set` en memoria simula la semántica exacta del `UNIQUE(conversation_id,
 * idempotency_key)` — la SEGUNDA ejecución con los MISMOS mensajes
 * disparadores debe ver `primeraVez: false`, igual que Postgres.
 */
const clavesYaRegistradas = new Set<string>();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    // Un resultado vacío (cola agotada O un padding explícito `[]`) cae a
    // `[{ id: "oc_1" }]`: en la segunda ejecución (`primeraVez: false`),
    // `registrarConfirmacionDePedido` hace un SELECT de respaldo para leer
    // el `id` de la fila que ya existía — no relevante para lo que prueba
    // este archivo (la despedida al cliente), así que basta con que nunca
    // quede `undefined`.
    select: () => {
      const proximo = selectQueue.shift();
      return thenableChain(proximo && proximo.length > 0 ? proximo : [{ id: "oc_1" }]);
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
          returning: () => {
            const clave = `${values.conversationId}::${values.idempotencyKey}`;
            if (clavesYaRegistradas.has(clave)) return Promise.resolve([]);
            clavesYaRegistradas.add(clave);
            return Promise.resolve([values]);
          },
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
    // `reclamarNotificacion` (claim atómico de la notificación) — sin
    // concurrencia que probar en este archivo, siempre "gana" el claim.
    execute: () => Promise.resolve([{ id: "oc_1" }]),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: false,
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
  hoursClose: "23:00",
  hoursDays: "1,2,3,4,5,6,7",
};

function msg(id: string, direction: "in" | "out", text: string) {
  return { id, direction, text, createdAt: new Date() };
}

function queueTurno(history: ReturnType<typeof msg>[]) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push([CONVERSATION], [PROFILE], copia, [], [], [], [], []);
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue("573001112222");
  sendText.mockReset().mockResolvedValue({ id: "wamid.1" });
  selectQueue.length = 0;
  clavesYaRegistradas.clear();
});

describe("BUG REAL corregido: la despedida de notify_order NO se reenvía al cliente en una re-ejecución del mismo turno", () => {
  it("misma conversación, MISMOS mensajes disparadores, dos ejecuciones (rescatarHuerfanos) -> el cliente recibe la despedida UNA sola vez", async () => {
    const historia = [
      msg("m0", "out", "💰 Total: $18.000. ¿Confirmas?"),
      msg("m1", "in", "Confirmo"),
    ];
    const cierre = {
      action: "notify_order",
      summary: "1 Pavé Cremoso — $18.000",
      farewell: "¡Gracias por tu pedido! En un momento te confirmamos.",
    };

    // Primera ejecución: el turno cierra normalmente.
    queueTurno(historia);
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const primera = await runAgentTurn("cv_1");
    expect(primera?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1); // la despedida real

    // Segunda ejecución: EXACTAMENTE el mismo lote de mensajes disparadores
    // (el escenario real de `rescatarHuerfanos` — un worker "huérfano" que
    // en realidad seguía vivo, o cualquier otro camino que repita el
    // turno). `registrarConfirmacionDePedido` debe ver `primeraVez: false`.
    queueTurno(historia);
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });
    const segunda = await runAgentTurn("cv_1");
    expect(segunda?.action).toBe("notify_order");

    // El aviso al EQUIPO nunca se duplicó (ya estaba protegido).
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    // Y AHORA, la despedida al CLIENTE tampoco: sigue en 1, no en 2.
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});
