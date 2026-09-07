import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Incidente real (7-sep-2026, MALIA), reproducido contra el pipeline COMPLETO.
 *
 * La clienta confirma su pedido con un "Si" y el bot, en vez de cerrarlo,
 * responde "Dame un momentico 🙏 Te comunico con una persona del equipo".
 *
 * Este archivo prueba las DOS mitades del mismo momento del flujo, que es lo
 * que el incidente destapó:
 *
 *  1. una confirmación LEGÍTIMA debe poder cerrar el pedido (aunque el
 *     negocio cobre domicilio y no tenga tabla de zonas);
 *  2. un pedido YA confirmado no debe volver a cerrarse por un mensaje
 *     posterior (protección de `pipeline-pedido-ya-confirmado.test.ts`, que
 *     sigue vigente y no se toca aquí).
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoDePedidosMock = vi.fn();
vi.mock("@/server/catalog/queries", () => ({
  catalogoDePedidos: (...a: unknown[]) => catalogoDePedidosMock(...a),
  catalogoDe: vi.fn(),
}));

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: vi.fn(),
  catalogoParaPrompt: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn(),
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

const sendText = vi.fn();
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...real, sendText: (...a: unknown[]) => sendText(...a) };
});

const selectQueue: unknown[][] = [];
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (r: (v: unknown) => void) => Promise.resolve(rows).then(r);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
          returning: () => Promise.resolve([values]),
          then: (r: (v: unknown) => void) => Promise.resolve([values]).then(r),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (r: (v: unknown) => void) => Promise.resolve([{}]).then(r),
          };
          return chain;
        },
      }),
    }),
    execute: () => Promise.resolve([{ id: "oc_claim" }]),
  }),
  schema: new Proxy(
    {},
    { get: (_t, t) => new Proxy({}, { get: (_x, c) => `${String(t)}.${String(c)}` }) }
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

/** MALIA: catálogo en tabla, pero el DOMICILIO vive en prosa (`delivery_source='prompt'`). */
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
  hoursOpen: "00:00",
  hoursClose: "23:59",
  hoursDays: "1,2,3,4,5,6,7",
  catalogSource: "tabla",
  paymentSource: "prompt",
  deliverySource: "prompt",
};

function msg(id: string, direction: "in" | "out", text: string) {
  return { id, direction, text, createdAt: new Date() };
}

function producto(id: string, nombre: string) {
  return { id, nombre, categoria: null, precioCents: 1800000, descripcion: null, grupos: [] };
}

/** El resumen REAL que MALIA le mostró a la clienta antes del "Si". */
const RESUMEN_REAL = `¡Perfecto! Aquí tienes el resumen de tu pedido:

🍧 *1 × Pavé Cremoso 16 oz* — $18.000
• Sabor: Leche Klim
• Topping: M&M's
🛵 *Domicilio:* $8.000
💰 *Total:* $26.000

¿Todo correcto para confirmar tu pedido?`;

function queueTurno(history: ReturnType<typeof msg>[], ultimaConfirmacion: unknown[] = []) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push(
    [CONVERSATION], [PROFILE], copia, [], [], [], [], ultimaConfirmacion, []
  );
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([producto("prod_pave", "Pavé Cremoso 16 oz")]);
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue("573001112222");
  sendText.mockReset().mockResolvedValue({ id: "wamid.1" });
  selectQueue.length = 0;
});

describe("Incidente real: confirmar un pedido con domicilio en un negocio sin tabla de zonas", () => {
  it('TEST J — BUG REAL: resumen → "Si" → el pedido SE CIERRA (no deriva a una persona)', async () => {
    queueTurno([
      msg("m0", "in", "Regálame un Pavé Cremoso 16 oz"),
      msg("m1", "out", "El domicilio a Ciudad Modelo tiene un valor de $8.000 🛵"),
      msg("m2", "out", RESUMEN_REAL),
      msg("m3", "in", "Si"),
    ]);

    // El modelo entiende el "Si" perfectamente y cierra, con los campos
    // estructurados que el esquema JSON siempre le presenta.
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "notify_order",
        summary: "1 × Pavé Cremoso 16 oz — $18.000 · Domicilio $8.000 · Total $26.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
        farewell: "¡Gracias! Ya estamos preparando tu pedido 💗",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    // Antes del arreglo: 2 llamadas (reintento por "domicilio-no-verificado")
    // y la acción final era `handoff`.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Si"],
    ["Sí"],
    ["si"],
    ["Sí, correcto"],
    ["Confirmo"],
    ["Todo bien"],
    ["Listo"],
    ["Dale"],
  ])('TEST B — confirmación natural "%s": cierra igual', async (confirmacion) => {
    queueTurno([
      msg("m0", "in", "Regálame un Pavé Cremoso 16 oz"),
      msg("m1", "out", RESUMEN_REAL),
      msg("m2", "in", confirmacion),
    ]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "notify_order",
        summary: "1 × Pavé Cremoso 16 oz — $18.000 · Domicilio $8.000 · Total $26.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it("TEST G/H — el modelo NO cierra ante 'Sí, pero cámbiame la salsa': la decisión sigue siendo suya y el backend no la fuerza", async () => {
    queueTurno([
      msg("m0", "in", "Regálame un Pavé Cremoso 16 oz"),
      msg("m1", "out", RESUMEN_REAL),
      msg("m2", "in", "Sí, pero cámbiame el topping a Oreo"),
    ]);

    // El modelo interpreta la modificación y NO emite notify_order.
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Claro! Te lo cambio a Oreo. Te confirmo el nuevo resumen." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("reply");
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("REGRESIÓN — la aritmética sigue protegida: un total que no cuadra se rehace, no se cierra a ciegas", async () => {
    queueTurno([
      msg("m0", "in", "Regálame un Pavé Cremoso 16 oz"),
      msg("m1", "out", RESUMEN_REAL),
      msg("m2", "in", "Si"),
    ]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "notify_order",
          summary: "1 × Pavé — $18.000 · Domicilio $8.000 · Total $20.000",
          subtotalCents: 1800000,
          deliveryFeeCents: 800000,
          totalCents: 2000000, // no cuadra: 18.000 + 8.000 = 26.000
        },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          action: "notify_order",
          summary: "1 × Pavé — $18.000 · Domicilio $8.000 · Total $26.000",
          subtotalCents: 1800000,
          deliveryFeeCents: 800000,
          totalCents: 2600000, // corregido
        },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2); // el guardarraíl actuó y el modelo corrigió
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });
});
