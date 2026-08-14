import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El cliente confirma y el pedido SE CIERRA — a la primera.
 *
 * 13-ago-2026, Natalia (La Churra): escribió "Confirmo" y el agente le devolvió
 * el mismo resumen pidiéndole confirmar. Escribió "Correcto": otra vez. "Si":
 * otra vez. Tres veces, hasta que una persona entró a mano. El pedido nunca
 * llegó al equipo por la vía normal.
 *
 * La causa no estaba en el modelo: el guardarraíl del resumen (12-ago) evalúa
 * `summary` + `farewell` PEGADOS, y en un `notify_order` eso junta la petición
 * de confirmar —que el modelo copia dentro del summary que va al equipo— con la
 * despedida y los datos de pago del farewell. Leía un "cierre prematuro" donde
 * había un cierre perfecto, rehacía el turno y el modelo, obediente, volvía a
 * pedir confirmación.
 *
 * Esto prueba el turno entero, que es donde vive el arreglo.
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
  id: "cv_pedidos",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};

/** Un negocio de PEDIDOS: sin citas, como La Churra. */
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

/** El resumen ya enseñado, y la clienta diciendo que sí. */
const HISTORY = [
  { id: "msg_1", direction: "in", text: "quiero un cremoso de 12 oz", createdAt: new Date() },
  {
    id: "msg_2",
    direction: "out",
    text: "Aquí está el resumen de tu pedido: 1 Cremoso 12 oz — $18.000. 💰 *Total: $18.000* 👉 *POR FAVOR, CONFIRMA TU PEDIDO* 👈",
    createdAt: new Date(),
  },
  { id: "msg_3", direction: "in", text: "Confirmo", createdAt: new Date() },
];

/** Lo que el modelo devuelve al cerrar: el pedido al equipo y el adiós al cliente. */
const CIERRE = {
  action: "notify_order",
  summary: [
    "Resumen de tu pedido:",
    "• 1 Cremoso 12 oz — $18.000 (MILO, AREQUIPE)",
    "• Natalia Becerra · 3113840785 · Carrera 53 #3 oeste 22",
    "💰 *Total: $18.000 (sin incluir domicilio)*",
    "👉 *POR FAVOR, CONFIRMA TU PEDIDO* 👈",
  ].join("\n"),
  farewell:
    "¡Listo Natalia! Ya estamos preparando todo con mucho amor para ti 🥣 Para el pago: llave 0089174299",
};

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

describe("runAgentTurn: la clienta confirma y el pedido se cierra", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue("573113840785");
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("no rehace el turno: avisa al equipo a la primera", async () => {
    queueTurnoBase();
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    /*
     * UNA sola llamada al modelo. Con el guardarraíl aplicándose a
     * `notify_order` había una segunda —la corrección— y era la que devolvía el
     * resumen otra vez. Si esta cuenta vuelve a 2, la clienta está recibiendo
     * "confirma tu pedido" después de haber confirmado.
     */
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("el resumen que ve la clienta ANTES de confirmar sí se sigue vigilando", async () => {
    queueTurnoBase();
    // Un resumen que pide confirmar y se despide en el mismo mensaje: el fallo
    // del 12-ago, que debe seguir disparando la corrección.
    const malArmado = {
      action: "reply",
      text: "Aquí está el resumen de tu pedido: 1 Cremoso — 💰 *Total: $18.000* 👉 *POR FAVOR, CONFIRMA TU PEDIDO* 👈 ¡Ya estamos preparando todo con mucho amor para ti!",
    };
    chatJson.mockResolvedValue({
      ok: true,
      data: malArmado,
      raw: JSON.stringify(malArmado),
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    expect(chatJson).toHaveBeenCalledTimes(2);
  });
});
