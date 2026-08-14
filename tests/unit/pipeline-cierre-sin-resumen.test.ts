import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * No se cierra un pedido que el cliente nunca vio.
 *
 * 14-ago-2026, Laboratorio de Lis. La conversación entera fue esta:
 *
 *   CLIENTE  Hola, buenas
 *   AGENTE   ¡Hola! Bienvenid@ a Lis Pastelería 🍰
 *   CLIENTE  ¿Qué opciones tienen para pedir?
 *   AGENTE   Tenemos cremosos, polvorosos… te dejo el menú
 *   CLIENTE  Sí, así está perfecto. Confirmo el pedido
 *   AGENTE   ¡Tu pedido ha sido confirmado! 🎉 Para el pago: llave 0089174299…
 *
 * El equipo recibió un pedido **sin producto, sin toppings, sin nombre y sin
 * dirección**, y el cliente ya tenía los datos de pago en la mano.
 *
 * El prompt lo prohíbe —"el resumen es OBLIGATORIO"—, pero un "confirmo"
 * entusiasta basta para que el modelo crea que hay algo que confirmar. Por eso
 * se comprueba el hecho: que exista un resumen con su total entre lo que el
 * agente ya le enseñó.
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

/** El caso real: el cliente "confirma" sin que le hayan enseñado nada. */
const SIN_RESUMEN = [
  { id: "m1", direction: "in", text: "Hola, buenas", createdAt: new Date() },
  {
    id: "m2",
    direction: "out",
    text: "¡Hola! 💗 Tenemos cremosos, polvorosos y tortas. Te dejo el menú.",
    createdAt: new Date(),
  },
  { id: "m3", direction: "in", text: "Sí, así está perfecto. Confirmo el pedido", createdAt: new Date() },
];

/** Lo mismo, pero con el resumen enseñado antes. */
const CON_RESUMEN = [
  { id: "m1", direction: "in", text: "quiero un cremoso de 12 oz", createdAt: new Date() },
  {
    id: "m2",
    direction: "out",
    text: "Resumen: 1 Cremoso 12 oz. 💰 *Total: $18.000* 👉 CONFIRMA TU PEDIDO",
    createdAt: new Date(),
  },
  { id: "m3", direction: "in", text: "Confirmo", createdAt: new Date() },
];

const CIERRE = {
  action: "notify_order",
  summary: "1 Cremoso 12 oz — $18.000 · Natalia · 3113840785",
  farewell: "¡Listo! Para el pago: llave 0089174299",
};

function queueTurno(history: unknown[]) {
  selectQueue.push([CONVERSATION], [PROFILE], history, [], [], []);
}

describe("runAgentTurn: no cierra un pedido que el cliente nunca vio", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
  });

  it("sin resumen previo, rehace el turno y NO avisa al equipo", async () => {
    queueTurno(SIN_RESUMEN);
    chatJson
      .mockResolvedValueOnce({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) })
      // El reintento hace lo correcto: enseñar el resumen.
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¿Qué producto deseas? 💗" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("reply");
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("si insiste en cerrar sin resumen, lo toma una persona", async () => {
    queueTurno(SIN_RESUMEN);
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("handoff");
    /*
     * Al equipo SÍ le llega un aviso — el de "esto lo tiene que ver alguien" —,
     * pero lo que no puede llegarle nunca es el pedido: eso significaría una
     * comanda sin producto ni dirección en la cocina.
     */
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: CIERRE.summary })
    );
  });

  it("con el resumen ya enseñado, cierra a la primera", async () => {
    queueTurno(CON_RESUMEN);
    chatJson.mockResolvedValue({ ok: true, data: CIERRE, raw: JSON.stringify(CIERRE) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledTimes(1);
  });
});

/**
 * Un guardarraíl de pedidos no se le aplica a un salón.
 *
 * `resumenMalArmado` nació midiendo resúmenes de pedidos y busca un total en
 * pesos. En citas no hay total que enseñar —`CIERRE_CITAS` dice justo lo
 * contrario: "no hace falta un resumen largo ni una confirmación
 * ceremoniosa"—, así que un "aquí está el resumen de tu cita" lo daba por
 * vacío y rehacía el turno sin motivo.
 */
describe("los guardarraíles de pedidos no se aplican a un negocio de citas", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    contactPhoneOf.mockReset().mockResolvedValue(null);
    selectQueue.length = 0;
  });

  it("un salón puede decir 'aquí está el resumen' sin total y no se rehace el turno", async () => {
    const salon = { ...PROFILE, appointmentsEnabled: true };
    selectQueue.push(
      [CONVERSATION],
      [salon],
      [{ id: "m1", direction: "in", text: "¿me confirmas mi cita?", createdAt: new Date() }],
      [],
      [],
      []
    );
    const respuesta = {
      action: "reply",
      text: "¡Claro! Aquí está el resumen de tu cita: Volumen Ruso el viernes a las 10:30 AM con Carolina 💗",
    };
    chatJson.mockResolvedValue({ ok: true, data: respuesta, raw: JSON.stringify(respuesta) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    // Una sola llamada: sin el arreglo eran dos (la corrección "te falta el
    // total", que en una cita no tiene sentido).
    expect(chatJson).toHaveBeenCalledTimes(1);
  });
});
