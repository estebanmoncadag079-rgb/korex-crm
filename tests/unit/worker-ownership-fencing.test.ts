import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 11-A — fencing real de ownership del worker.
 *
 * El token `generation` (Fase 10Q) ya protegía que un worker "huérfano"
 * (reasignado por `rescatarHuerfanos` mientras seguía vivo) no pudiera
 * FINALIZAR el `agent_job` como propio. Lo que no estaba protegido es lo
 * que ese worker seguía haciendo MIENTRAS corría, después de perder la
 * generación: podía mandar un mensaje real, agendar una cita, notificar un
 * pedido. Estas pruebas verifican `asegurarOwnershipVigente` (pipeline.ts)
 * contra `siguePoseyendoElTrabajo` (cola.ts, mockeada aquí para controlar
 * "sigo siendo dueño" / "ya no lo soy" sin depender de una base real).
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

const registrarConfirmacionDePedido = vi.fn();
const borrarConfirmacionDePedido = vi.fn();
const intentarNotificarPedido = vi.fn();
vi.mock("@/server/ai/confirmacion-de-pedido", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ai/confirmacion-de-pedido")>();
  return {
    ...real,
    registrarConfirmacionDePedido: (...a: Parameters<typeof registrarConfirmacionDePedido>) =>
      registrarConfirmacionDePedido(...a),
    borrarConfirmacionDePedido: (...a: Parameters<typeof borrarConfirmacionDePedido>) =>
      borrarConfirmacionDePedido(...a),
    intentarNotificarPedido: (...a: Parameters<typeof intentarNotificarPedido>) =>
      intentarNotificarPedido(...a),
  };
});

const registrarConfirmacionDeCita = vi.fn();
vi.mock("@/server/ai/confirmacion-de-cita", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ai/confirmacion-de-cita")>();
  return {
    ...real,
    registrarConfirmacionDeCita: (...a: Parameters<typeof registrarConfirmacionDeCita>) =>
      registrarConfirmacionDeCita(...a),
  };
});

/**
 * La verificación de ownership en sí — mockeada para controlar "sigo
 * siendo dueño" sin depender de una fila real de `agent_job`. El
 * MECANISMO de la consulta contra Postgres (`siguePoseyendoElTrabajo`) se
 * prueba aparte, sin mocks, en `tests/unit/cola-ownership.test.ts`.
 */
const siguePoseyendoElTrabajo = vi.fn();
vi.mock("@/server/ai/cola", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ai/cola")>();
  return {
    ...real,
    siguePoseyendoElTrabajo: (...a: unknown[]) => siguePoseyendoElTrabajo(...a),
  };
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
 * Fase 6B — `applyHandoff` (pipeline.ts) escribe directo con
 * `getDb().update(schema.conversation)...`, sin pasar por ningún módulo
 * mockeable aparte. Este espía permite comprobar, en el test de regresión
 * de más abajo, que NO se ejecutó — es la única forma de observar ese
 * efecto sin mockear `applyHandoff` en sí (no está exportado desde otro
 * módulo, vive local en pipeline.ts).
 */
const dbUpdateSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: () => {
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
          returning: () => Promise.resolve([{}]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
        };
        return chain;
      },
    }),
    update: (...args: unknown[]) => {
      dbUpdateSpy(...args);
      return {
        set: () => ({
          where: () => {
            const chain = {
              returning: () => Promise.resolve([{}]),
              then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
            };
            return chain;
          },
        }),
      };
    },
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

function queueTurno(history: Array<Record<string, unknown>>) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push([CONVERSATION], [PROFILE], copia, [], [], [], [], [], []);
}

const JOB = { jobId: "aj_1", generation: 3 };

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue("573001112222");
  sendText.mockReset().mockResolvedValue({ id: "wamid.1" });
  registrarConfirmacionDePedido.mockReset().mockResolvedValue({ primeraVez: true, id: "oc_1" });
  borrarConfirmacionDePedido.mockReset().mockResolvedValue(undefined);
  intentarNotificarPedido.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  registrarConfirmacionDeCita.mockReset().mockResolvedValue({ primeraVez: true });
  siguePoseyendoElTrabajo.mockReset();
  dbUpdateSpy.mockClear();
  selectQueue.length = 0;
});

describe("Fase 11-A: fencing de ownership del worker", () => {
  it("1: worker conserva ownership -> el turno actúa con normalidad (reply real)", async () => {
    siguePoseyendoElTrabajo.mockResolvedValue(true);
    queueTurno([{ id: "m1", direction: "in", text: "Hola", createdAt: new Date() }]);
    const respuesta = { action: "reply", text: "¡Hola! ¿En qué te ayudo?" };
    chatJson.mockResolvedValueOnce({ ok: true, data: respuesta, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1", { jobOwnership: JOB });

    expect(action?.action).toBe("reply");
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("2 y 6: worker pierde generation antes de responder -> NO manda el mensaje, el turno lanza OwnershipPerdidaError", async () => {
    siguePoseyendoElTrabajo.mockResolvedValue(false);
    queueTurno([{ id: "m1", direction: "in", text: "Hola", createdAt: new Date() }]);
    const respuesta = { action: "reply", text: "¡Hola! ¿En qué te ayudo?" };
    chatJson.mockResolvedValueOnce({ ok: true, data: respuesta, raw: "" });

    const { runAgentTurn, OwnershipPerdidaError } = await import("@/server/ai/pipeline");
    await expect(runAgentTurn("cv_1", { jobOwnership: JOB })).rejects.toBeInstanceOf(
      OwnershipPerdidaError
    );

    expect(sendText).not.toHaveBeenCalled();
  });

  it("3 y 7: worker pierde generation antes de notify_order -> NO reclama la idempotencia ni notifica", async () => {
    siguePoseyendoElTrabajo.mockResolvedValue(false);
    queueTurno([
      { id: "m0", direction: "out", text: "💰 Total: $20.000. ¿Confirmas?", createdAt: new Date() },
      { id: "m1", direction: "in", text: "Confirmo mi pedido", createdAt: new Date() },
    ]);
    const cierre = { action: "notify_order", summary: "Pedido: $20.000" };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });

    const { runAgentTurn, OwnershipPerdidaError } = await import("@/server/ai/pipeline");
    await expect(runAgentTurn("cv_1", { jobOwnership: JOB })).rejects.toBeInstanceOf(
      OwnershipPerdidaError
    );

    expect(registrarConfirmacionDePedido).not.toHaveBeenCalled();
    expect(intentarNotificarPedido).not.toHaveBeenCalled();
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("8: worker pierde generation antes de book_appointment -> NO reclama la idempotencia de la cita", async () => {
    siguePoseyendoElTrabajo.mockResolvedValue(false);
    const perfilCitas = { ...PROFILE, appointmentsEnabled: true };
    selectQueue.push(
      [CONVERSATION],
      [perfilCitas],
      [{ id: "m1", direction: "in", text: "Agenda mi cita", createdAt: new Date() }],
      [],
      [],
      [],
      [],
      [],
      []
    );
    const cierre = {
      action: "book_appointment",
      reservas: [{ servicios: ["Corte"], fecha: "10/09/2026", hora: "10:00", especialista: null }],
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });

    const { runAgentTurn, OwnershipPerdidaError } = await import("@/server/ai/pipeline");
    await expect(runAgentTurn("cv_1", { jobOwnership: JOB })).rejects.toBeInstanceOf(
      OwnershipPerdidaError
    );

    expect(registrarConfirmacionDeCita).not.toHaveBeenCalled();
  });

  it("4 y 5: worker viejo (rescatado) se detiene; una ejecución NUEVA con generación vigente continúa normal para la MISMA conversación", async () => {
    // El worker "viejo" ya perdió su generación (rescatarHuerfanos la
    // incrementó): su propia llamada a runAgentTurn con la generación
    // VIEJA debe fallar controladamente.
    siguePoseyendoElTrabajo.mockImplementation(
      async (ownership: { jobId: string; generation: number } | undefined) =>
        ownership?.generation === 4 // solo la generación NUEVA sigue vigente
    );
    queueTurno([{ id: "m1", direction: "in", text: "Hola", createdAt: new Date() }]);
    const respuesta = { action: "reply", text: "¡Hola!" };
    chatJson.mockResolvedValueOnce({ ok: true, data: respuesta, raw: "" });

    const { runAgentTurn, OwnershipPerdidaError } = await import("@/server/ai/pipeline");
    await expect(
      runAgentTurn("cv_1", { jobOwnership: { jobId: "aj_1", generation: 3 } })
    ).rejects.toBeInstanceOf(OwnershipPerdidaError);
    expect(sendText).not.toHaveBeenCalled();

    // El worker NUEVO, con la generación vigente (4), sí puede actuar.
    selectQueue.length = 0;
    queueTurno([{ id: "m1", direction: "in", text: "Hola", createdAt: new Date() }]);
    chatJson.mockResolvedValueOnce({ ok: true, data: respuesta, raw: "" });
    const accionNueva = await runAgentTurn("cv_1", {
      jobOwnership: { jobId: "aj_1", generation: 4 },
    });
    expect(accionNueva?.action).toBe("reply");
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("9: sin regresión — sin `jobOwnership` (Laboratorio, scripts, pruebas) el turno actúa exactamente igual, sin ninguna consulta de fencing", async () => {
    queueTurno([{ id: "m1", direction: "in", text: "Hola", createdAt: new Date() }]);
    const respuesta = { action: "reply", text: "¡Hola!" };
    chatJson.mockResolvedValueOnce({ ok: true, data: respuesta, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1"); // sin opts

    expect(action?.action).toBe("reply");
    expect(sendText).toHaveBeenCalledTimes(1);
    // Sin `jobOwnership`, `asegurarOwnershipVigente` retorna de inmediato
    // sin consultar nada — cero cambio de comportamiento para este camino.
    expect(siguePoseyendoElTrabajo).not.toHaveBeenCalled();
  });

  it("10 (Fase 6B, regresión): ownership se pierde DENTRO de derivarAUnaPersona (entre su chequeo y el de deliverReply) -> no se ejecuta applyHandoff ni se notifica al equipo", async () => {
    // El turno entra con ownership vigente (así es como derivarAUnaPersona
    // llega a ejecutarse en absoluto: runAgentTurn ya la comprobó antes de
    // procesar la respuesta del modelo). El modelo devuelve una salida
    // inválida de forma persistente -> dispara el camino MÁS simple hacia
    // derivarAUnaPersona (pipeline.ts, "fallo tras la recuperación").
    //
    // La generación se pierde justo DESPUÉS de ese punto: la reverificación
    // propia de `derivarAUnaPersona` (primera llamada a
    // `siguePoseyendoElTrabajo`) todavía la ve vigente, pero la
    // reverificación interna de `deliverReply` (segunda llamada) ya no.
    // Antes de la Fase 6B, esa `OwnershipPerdidaError` se tragaba en un
    // catch genérico y `applyHandoff` se ejecutaba de todos modos — el
    // hallazgo ALTO de la auditoría de Fase 6A.
    siguePoseyendoElTrabajo
      .mockResolvedValueOnce(true) // chequeo propio de derivarAUnaPersona
      .mockResolvedValueOnce(false); // chequeo interno de deliverReply

    queueTurno([{ id: "m1", direction: "in", text: "algo raro", createdAt: new Date() }]);
    chatJson.mockResolvedValueOnce({
      ok: false,
      error: "invalid_output",
      detail: "el modelo no devolvió un JSON válido tras reintentar",
    });

    const { runAgentTurn, OwnershipPerdidaError } = await import("@/server/ai/pipeline");
    await expect(runAgentTurn("cv_1", { jobOwnership: JOB })).rejects.toBeInstanceOf(
      OwnershipPerdidaError
    );

    // La propiedad exigida: perder ownership antes de un efecto externo
    // crítico => no ejecutar ESE efecto, ni los que vengan después en la
    // misma función. `db.update(conversation)` se llama UNA vez, siempre,
    // al principio de cualquier turno (marca `lastTurnInboundAt`, línea
    // ~904 de pipeline.ts, antes de llamar al modelo — no es el efecto bajo
    // prueba). `applyHandoff` sería una SEGUNDA llamada — la que nunca debió
    // ocurrir tras perder ownership.
    expect(dbUpdateSpy).toHaveBeenCalledTimes(1);
    expect(notifyTeam).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
