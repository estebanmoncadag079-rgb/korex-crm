import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10N-A (3-sep-2026) — el cliente confirma el pedido y el agente vuelve
 * a pedirle que confirme, en vez de cerrarlo con `notify_order`.
 *
 * Reportado dos veces sobre el mismo patrón: Natalia (13-ago-2026, tres
 * repeticiones hasta que una persona intervino a mano) y este caso:
 *
 *   AGENTE   📍 Entrega: Cll 60A #119-140 · 💰 Total: $30.000
 *            ¿Me confirmas si todo está correcto para dejar tu pedido
 *            en firme? 😊
 *   CLIENTE  Correcto
 *   AGENTE   [el mismo resumen, la misma pregunta, otra vez]
 *
 * Investigado con evidencia de código (no es un problema de duplicación de
 * infraestructura: el historial le llega bien al modelo, no hay reintento
 * ni webhook duplicado en este camino) — es que el cierre depende
 * enteramente de que el modelo decida invocar `notify_order` leyendo texto
 * libre, sin ningún chequeo de servidor. Este archivo prueba el guardarraíl
 * que corrige eso: `confirmoPeroNoSeCerro` (`anuncio-de-cierre.ts`).
 *
 * La idempotencia de `notify_order` en sí (que no mande dos avisos al
 * equipo si de verdad se invoca dos veces) se prueba aparte, en
 * `tests/unit/confirmacion-de-pedido.test.ts` — son dos protecciones
 * distintas para dos fallos distintos.
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
      values: (values: Record<string, unknown>) => {
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
  id: "cv_pedidos",
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
  hoursClose: "23:00",
  hoursDays: "1,2,3,4,5,6,7",
};

/** La frase real del incidente — antes no matcheaba `PIDE_CONFIRMAR`, ver el fix en `anuncio-de-cierre.ts`. */
const RESUMEN_PIDIENDO_CONFIRMAR =
  "📍 Entrega: Cll 60A #119-140 · 💰 Total: $30.000\n¿Me confirmas si todo está correcto para dejar tu pedido en firme? 😊";

const HISTORIAL_CONFIRMO = [
  { id: "m1", direction: "in", text: "quiero un pavé de fresas", createdAt: new Date() },
  { id: "m2", direction: "out", text: RESUMEN_PIDIENDO_CONFIRMAR, createdAt: new Date() },
  { id: "m3", direction: "in", text: "Correcto", createdAt: new Date() },
];

const RESUMEN_REPETIDO = {
  action: "reply",
  text: RESUMEN_PIDIENDO_CONFIRMAR,
};

const CIERRE = {
  action: "notify_order",
  summary: "1 Pavé Cremoso 16 oz (Fresas con crema) — $18.000 · Domicilio $12.000 · Total $30.000",
  farewell: "¡Listo! Para el pago: llave 0089174299…",
};

/**
 * `runAgentTurn` pide el historial con `orderBy(desc(createdAt))` (más
 * nuevo primero, como lo devuelve Postgres) y hace `history.reverse()` en
 * el sitio para volver a orden cronológico. Como este array de prueba ya
 * está escrito en orden cronológico (para que se lea fácil), hay que
 * invertirlo antes de entregarlo — igual que haría el `DESC` real — y
 * copiarlo, porque ese `.reverse()` muta el array en el sitio y reusar el
 * mismo entre tests corrompería el fixture del siguiente.
 */
function queueTurno(history: Array<Record<string, unknown>>) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push([CONVERSATION], [PROFILE], copia, [], [], []);
}

describe("runAgentTurn: el cliente confirma y el agente no vuelve a preguntar lo mismo", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
  });

  it("A: el modelo repite el resumen tras 'Correcto' — el guardarraíl rehace el turno y SÍ cierra el pedido", async () => {
    queueTurno(HISTORIAL_CONFIRMO);
    chatJson
      .mockResolvedValueOnce({ ok: true, data: RESUMEN_REPETIDO, raw: JSON.stringify(RESUMEN_REPETIDO) })
      .mockResolvedValueOnce({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("B: si insiste en no cerrar tras confirmar, lo toma una persona (nunca queda en bucle infinito)", async () => {
    queueTurno(HISTORIAL_CONFIRMO);
    chatJson.mockResolvedValue({ ok: true, data: RESUMEN_REPETIDO, raw: JSON.stringify(RESUMEN_REPETIDO) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("handoff");
    // `derivarAUnaPersona` SÍ avisa al equipo de que alguien debe revisar la
    // conversación — lo que nunca debe llegar es el PEDIDO como si se
    // hubiera cerrado de verdad.
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: RESUMEN_PIDIENDO_CONFIRMAR })
    );
  });

  it("C (control negativo): si el modelo cierra bien a la primera, el guardarraíl no interfiere", async () => {
    queueTurno(HISTORIAL_CONFIRMO);
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("notify_order");
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("D (control negativo): el cliente NO confirma de forma corta e inequívoca ('sí pero cámbiame el sabor') — no dispara nada", async () => {
    queueTurno([
      HISTORIAL_CONFIRMO[0]!,
      HISTORIAL_CONFIRMO[1]!,
      { id: "m3", direction: "in", text: "Sí pero cámbiame el sabor a vainilla", createdAt: new Date() },
    ]);
    chatJson.mockResolvedValue({ ok: true, data: RESUMEN_REPETIDO, raw: JSON.stringify(RESUMEN_REPETIDO) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("E (control negativo): el turno anterior del agente no pedía confirmar — no dispara nada aunque el cliente diga 'Correcto'", async () => {
    queueTurno([
      { id: "m1", direction: "in", text: "Hola", createdAt: new Date() },
      { id: "m2", direction: "out", text: "¡Hola! ¿En qué te ayudo? 😊", createdAt: new Date() },
      { id: "m3", direction: "in", text: "Correcto", createdAt: new Date() },
    ]);
    chatJson.mockResolvedValue({ ok: true, data: RESUMEN_REPETIDO, raw: JSON.stringify(RESUMEN_REPETIDO) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("F (control negativo): notify_order en la primera respuesta nunca dispara el guardarraíl (aunque el resto de condiciones se den)", async () => {
    queueTurno(HISTORIAL_CONFIRMO);
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    expect(chatJson).toHaveBeenCalledTimes(1);
  });
});

describe("el guardarraíl de 'confirmó y no se cerró' no se aplica a un negocio de citas", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
  });

  it("G: mismo patrón de texto en un negocio de citas — no rehace el turno (notify_order no existe en ese vertical)", async () => {
    const salon = { ...PROFILE, appointmentsEnabled: true };
    selectQueue.push(
      [CONVERSATION],
      [salon],
      // Invertido: ver el comentario de `queueTurno` — el pipeline espera
      // orden DESC (más nuevo primero) y lo revierte él mismo.
      [
        { id: "m3", direction: "in", text: "Correcto", createdAt: new Date() },
        { id: "m2", direction: "out", text: RESUMEN_PIDIENDO_CONFIRMAR, createdAt: new Date() },
        { id: "m1", direction: "in", text: "quiero agendar", createdAt: new Date() },
      ],
      [],
      [],
      []
    );
    chatJson.mockResolvedValue({ ok: true, data: RESUMEN_REPETIDO, raw: JSON.stringify(RESUMEN_REPETIDO) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    expect(chatJson).toHaveBeenCalledTimes(1);
  });
});
