import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Incidente real (6-sep-2026, Lucero Vallejo / Lis Pastelería), reproducido
 * contra el pipeline COMPLETO: la clienta confirma ("Si esta bien") y el bot,
 * en vez de cerrar el pedido, le reenvía el mismo resumen.
 *
 * Traza real de producción:
 *   [agente] notify_order sin resumen previo en cv_cyl2n5awhjh8fn4rte3y; rehaciendo el turno
 *   [traza]  ... accion=reply ...
 *   → 0 filas en order_confirmation: el equipo nunca recibió el aviso.
 *
 * La causa NO fue el modelo (emitió `notify_order` correctamente): fue el
 * guardarraíl del 14-ago comprobando el FORMATO del resumen ("Total: $X") en
 * vez del HECHO, contra un negocio cuyo prompt pide "TOTAL SIN DOMICILIO: X".
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
    execute: () => Promise.resolve([{ id: "oc_claim" }]),
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
  hoursOpen: "00:00",
  hoursClose: "23:59",
  hoursDays: "1,2,3,4,5,6,7",
  catalogSource: "tabla",
  paymentSource: "prompt",
};

/** El resumen REAL de Lis, con el formato que su propio prompt le pide. */
const RESUMEN_DE_LIS = `¡Perfecto, Lucero! 💗 Aquí tienes el resumen de tu pedido:

👤 *Nombre:* Lucero Vallejo
🍰 *Pedido:* 1 × Cremoso de Temporada Franui 12 oz ($19.000)
📍 *Dirección:* Cra 11d#71-11, barrio Siete de Agosto

💰 *TOTAL SIN DOMICILIO:* $19.000

¿Me confirmas si todos los datos están correctos para agendarlo? ✨`;

function msg(id: string, direction: "in" | "out", text: string) {
  return { id, direction, text, createdAt: new Date() };
}

function producto(id: string, nombre: string) {
  return { id, nombre, categoria: null, precioCents: 1900000, descripcion: null, grupos: [] };
}

function queueTurno(history: ReturnType<typeof msg>[]) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push(
    [CONVERSATION],
    [PROFILE],
    copia,
    [],
    [],
    [],
    [],
    [], // ultimaConfirmacionDe: ninguna previa
    [] // appendLeadNote
  );
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock
    .mockReset()
    .mockResolvedValue([producto("prod_franui", "Cremoso de Temporada Franui 12 oz")]);
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue("573001112222");
  sendText.mockReset().mockResolvedValue({ id: "wamid.1" });
  selectQueue.length = 0;
});

describe("Incidente real: 'TOTAL SIN DOMICILIO' bloqueaba el cierre del pedido", () => {
  it("BUG REAL corregido: tras el 'Si esta bien' de la clienta, el pedido SE CIERRA (una llamada al modelo, sin repetir el resumen)", async () => {
    queueTurno([
      msg("m0", "in", "Me das por favor 1 cremoso de franui"),
      msg("m1", "out", RESUMEN_DE_LIS),
      msg("m2", "in", "Si esta bien"),
    ]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "notify_order",
        summary: "1 × Cremoso de Temporada Franui 12 oz — $19.000",
        farewell: "¡Gracias, Lucero! Ya lo estamos preparando 💗",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    // Antes del arreglo: 2 llamadas (la corrección forzaba rehacer el turno) y
    // la acción final era `reply` con el mismo resumen otra vez.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it("el formato clásico ('Total: $18.000') sigue cerrando igual — sin regresión", async () => {
    queueTurno([
      msg("m0", "in", "quiero un franui"),
      msg("m1", "out", "💰 *Total:* $19.000 ¿Confirmas?"),
      msg("m2", "in", "sí"),
    ]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "notify_order", summary: "1 × Franui — $19.000" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it("PROTECCIÓN ORIGINAL INTACTA: si el cliente nunca vio una cifra, el cierre se sigue bloqueando y se rehace el turno", async () => {
    queueTurno([
      msg("m0", "in", "quiero algo dulce"),
      msg("m1", "out", "¡Claro! ¿Te muestro la carta?"),
      msg("m2", "in", "sí confirmo"),
    ]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "notify_order", summary: "un pedido" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Antes de cerrar, te muestro el resumen con el total." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2); // el guardarraíl actuó, como debe
    expect(action?.action).toBe("reply");
    expect(notifyTeam).not.toHaveBeenCalled();
  });
});
