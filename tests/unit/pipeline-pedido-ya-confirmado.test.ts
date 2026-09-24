import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Incidente real de producción (5-sep-2026), Caso B — corregido:
 * `notify_order` es una acción TERMINAL por pedido. El único candado
 * anterior (`registrarConfirmacionDePedido`, por `messageIds`) protegía que
 * el MISMO lote de mensajes disparadores no confirmara dos veces (Caso A),
 * pero un mensaje CUALQUIERA del cliente DESPUÉS de un cierre exitoso
 * ("¿cuánto demora?", "gracias"...) trae su propio `idempotencyKey`
 * distinto — y si el modelo decidía reabrir la confirmación (visto tras el
 * relevo automático de `handoff-policy.ts`, 2 horas después de cerrar),
 * nada lo frenaba: doble aviso al equipo, doble "pedido confirmado".
 *
 * Estas pruebas reproducen exactamente el ejemplo real del incidente:
 * "Quiero 12 churros" → confirmado → "¿Cuánto demora?" → NO debe volver a
 * confirmar ni avisar al equipo.
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

/** Mismo `Set` en memoria de `notificacion-pedido-confiable.test.ts`: simula `UNIQUE(conversation_id, idempotency_key)`. */
const clavesYaRegistradas = new Set<string>();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
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
    // `reclamarNotificacion` (claim atómico) — nunca en disputa en este archivo.
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

function msg(id: string, direction: "in" | "out", text: string, createdAt: Date) {
  return { id, direction, text, createdAt };
}

function producto(id: string, nombre: string) {
  return { id, nombre, categoria: null, precioCents: 1000000, descripcion: null, grupos: [] };
}

const CATALOGO = [producto("prod_churros", "CHURROS"), producto("prod_besties", "BESTIES")];

/**
 * @param ultimaConfirmacion `null` si nunca se ha confirmado nada antes en
 * esta conversación (primera confirmación); una fila si ya existe una.
 */
function queueTurno(
  history: ReturnType<typeof msg>[],
  ultimaConfirmacion: { id: string; createdAt: Date } | null,
  /** `true` cuando ESTE turno reconfirma el MISMO lote de mensajes que uno anterior (conflicto por `UNIQUE`): `registrarConfirmacionDePedido` hace una lectura de respaldo extra para recuperar el `id` de la fila ya existente. */
  esperaConflictoDeIdempotencia = false
) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push(
    [CONVERSATION], // conversation
    [PROFILE], // agentProfile
    copia, // message history
    [], // contact
    [], // kb
    [], // stages
    [], // (lectura genérica adicional)
    ultimaConfirmacion ? [ultimaConfirmacion] : [], // ultimaConfirmacionDe
    ...(esperaConflictoDeIdempotencia ? [[{ id: "oc_existente" }]] : []), // fallback SELECT de registrarConfirmacionDePedido
    [] // appendLeadNote (contact), si se llega a ejecutar notify_order
  );
}

const HACE_3_HORAS = new Date(Date.now() - 3 * 60 * 60 * 1000);
const HACE_1_HORA = new Date(Date.now() - 60 * 60 * 1000);
const AHORA = new Date();

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue(CATALOGO);
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue("573001112222");
  sendText.mockReset().mockResolvedValue({ id: "wamid.1" });
  selectQueue.length = 0;
  clavesYaRegistradas.clear();
});

describe("Incidente real: notify_order es TERMINAL por pedido (Caso B — mensaje posterior a la confirmación)", () => {
  it("TEST 2 — nuevo mensaje posterior ('¿Cuánto demora?'): NO reconfirma, NO reavisa al equipo", async () => {
    const historia = [
      msg("m0", "in", "Quiero 12 churros", HACE_3_HORAS),
      msg("m1", "out", "Perfecto, tu pedido es 12 churros. 💰 Total: $18.000. ¿Confirmas?", HACE_3_HORAS),
      msg("m2", "in", "Sí", HACE_3_HORAS),
      msg("m3", "out", "Pedido confirmado. Ya avisamos al equipo.", HACE_3_HORAS),
      msg("m4", "in", "¿Cuánto demora?", AHORA),
    ];
    const confirmacionPrevia = { id: "ordc_previo", createdAt: HACE_1_HORA };
    queueTurno(historia, confirmacionPrevia);

    chatJson
      // El modelo, confundido por el historial completo, decide reabrir la
      // confirmación — el bug real, reproducido a propósito.
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "notify_order", summary: "1 Churros x12 — $18.000" },
        raw: '{"action":"notify_order"}',
      })
      // Tras la corrección del backend, responde lo que el cliente preguntó.
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Tu pedido llega en unos 30-40 minutos." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
    expect(notifyTeam).not.toHaveBeenCalled();
    // Ninguna fila NUEVA de order_confirmation se creó para este intento.
    expect(clavesYaRegistradas.size).toBe(0);

    // El mensaje de corrección que vio el modelo es explícito: ya está
    // confirmado, no lo repitas. (Desde la PR #13 el PLAN DEL TURNO es otro
    // `[SISTEMA]`; aquí se busca la corrección, no "cualquier [SISTEMA]".)
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const correccion = segundaLlamada.find(
      (m) => m.content.includes("[SISTEMA]") && !m.content.includes("PLAN DEL TURNO")
    );
    expect(correccion?.content).toMatch(/YA fue confirmado/);
  });

  it("TEST 3 — nueva intención posterior: SÍ procesa la pregunta, no vuelve a confirmar el pedido", async () => {
    const historia = [
      msg("m0", "in", "Quiero 12 churros", HACE_3_HORAS),
      msg("m1", "out", "💰 Total: $18.000. ¿Confirmas?", HACE_3_HORAS),
      msg("m2", "in", "Sí", HACE_3_HORAS),
      msg("m3", "out", "Pedido confirmado. Ya avisamos al equipo.", HACE_3_HORAS),
      msg("m4", "in", "¿Cuánto demora?", AHORA),
    ];
    queueTurno(historia, { id: "ordc_previo", createdAt: HACE_1_HORA });

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "notify_order", summary: "1 Churros x12 — $18.000" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Tu pedido llega en 30-40 minutos aproximadamente." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("reply");
    expect((action as { text?: string })?.text).toMatch(/demora|minutos/i);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("TEST 4 — nuevo pedido legítimo tras uno ya confirmado: SÍ se procesa y notifica", async () => {
    const historia = [
      msg("m0", "in", "Quiero 12 churros", HACE_3_HORAS),
      msg("m1", "out", "💰 Total: $18.000. ¿Confirmas?", HACE_3_HORAS),
      msg("m2", "in", "Sí", HACE_3_HORAS),
      msg("m3", "out", "Pedido confirmado. Ya avisamos al equipo.", HACE_3_HORAS),
      // El cliente vuelve y nombra un producto real del catálogo: un
      // pedido GENUINAMENTE nuevo.
      msg("m4", "in", "Hola, ahora quiero un Besties", HACE_1_HORA),
      msg("m5", "out", "Perfecto, tu Besties. 💰 Total: $12.000. ¿Confirmas?", HACE_1_HORA),
      msg("m6", "in", "Sí, confirmo", AHORA),
    ];
    queueTurno(historia, { id: "ordc_previo", createdAt: new Date(HACE_3_HORAS.getTime() + 1000) });

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "notify_order",
        summary: "1 Besties — $12.000",
        farewell: "¡Gracias por tu nuevo pedido!",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1); // ninguna corrección: el pedido nuevo es legítimo, pasa directo
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it("TEST 5 — concurrencia: dos ejecuciones del MISMO pedido nuevo (tras uno ya confirmado antes) producen exactamente una notificación", async () => {
    const confirmacionPrevia = { id: "ordc_previo", createdAt: HACE_3_HORAS };
    const historiaPedidoNuevo = [
      msg("m0", "in", "Quiero 12 churros", new Date(HACE_3_HORAS.getTime() - 1000)),
      msg("m1", "out", "💰 Total: $18.000. Confirmado. Ya avisamos al equipo.", new Date(HACE_3_HORAS.getTime() - 500)),
      // Pedido GENUINAMENTE nuevo: el cliente vuelve a nombrar un producto real.
      msg("m2", "in", "Ahora quiero un Besties", HACE_1_HORA),
      msg("m3", "out", "💰 Total: $12.000. ¿Confirmas?", HACE_1_HORA),
      msg("m4", "in", "Sí", AHORA),
    ];

    // Primera ejecución del turno.
    queueTurno(historiaPedidoNuevo, confirmacionPrevia);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "notify_order", summary: "1 Besties — $12.000" },
      raw: "{}",
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const primera = await runAgentTurn("cv_1");
    expect(primera?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);

    // Segunda ejecución — EXACTAMENTE el mismo lote de mensajes disparadores
    // (el escenario real de `rescatarHuerfanos`, o cualquier otro motivo por
    // el que el turno se re-ejecute). El guardarraíl nuevo deja pasar el
    // pedido (SÍ hay un producto nuevo desde la última confirmación), y la
    // idempotencia por `messageIds` ya existente es quien decide que es un
    // duplicado — exactamente una notificación efectiva en total.
    queueTurno(historiaPedidoNuevo, confirmacionPrevia, true);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "notify_order", summary: "1 Besties — $12.000" },
      raw: "{}",
    });
    const segunda = await runAgentTurn("cv_1");
    expect(segunda?.action).toBe("notify_order");

    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it("TEST 1 (regresión) — primera confirmación de esta conversación: sigue funcionando igual (sin confirmación previa, nada que bloquear)", async () => {
    const historia = [
      msg("m0", "in", "Quiero 12 churros", HACE_1_HORA),
      msg("m1", "out", "💰 Total: $18.000. ¿Confirmas?", HACE_1_HORA),
      msg("m2", "in", "Sí", AHORA),
    ];
    queueTurno(historia, null); // nunca se ha confirmado nada en esta conversación

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "notify_order", summary: "1 Churros x12 — $18.000" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledTimes(1);
  });

  it("insiste en reabrir tras la corrección -> deriva a una persona (no queda mudo, no repite el aviso)", async () => {
    const historia = [
      msg("m0", "in", "Quiero 12 churros", HACE_3_HORAS),
      msg("m1", "out", "💰 Total: $18.000. ¿Confirmas?", HACE_3_HORAS),
      msg("m2", "in", "Sí", HACE_3_HORAS),
      msg("m3", "out", "Pedido confirmado. Ya avisamos al equipo.", HACE_3_HORAS),
      msg("m4", "in", "¿Cuánto demora?", AHORA),
    ];
    queueTurno(historia, { id: "ordc_previo", createdAt: HACE_1_HORA });
    // Encola una lectura extra de contacto para `derivarAUnaPersona`.
    selectQueue.push([]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "notify_order", summary: "1 Churros x12 — $18.000" },
        raw: "{}",
      })
      // Insiste, incluso tras la corrección.
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "notify_order", summary: "1 Churros x12 — $18.000" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("handoff");
    // `derivarAUnaPersona` SÍ avisa al equipo que alguien debe revisar la
    // conversación (comportamiento correcto y preexistente) — lo que NO debe
    // pasar es que se cree una fila NUEVA de confirmación de pedido.
    expect(clavesYaRegistradas.size).toBe(0);
    expect(notifyTeam).toHaveBeenCalledTimes(1);
    expect(notifyTeam.mock.calls[0]![0]).toMatchObject({
      summary: expect.stringContaining("ya estaba cerrado"),
    });
  });
});
