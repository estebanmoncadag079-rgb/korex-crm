import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T016 (feature 003-backend-como-autoridad) — test de integración con el
 * pipeline mockeado, la última tarea de la Fase 3 (US2). Dos garantías que
 * no tenían prueba de punta a punta hasta ahora:
 *
 * 1. Un turno que SOLO cambia un dato (`fijar_dato`) no toca los ítems ya
 *    guardados — la ventaja central de operaciones sobre "reescribe el
 *    estado completo cada turno" (`spec.md`, US2 criterio #2).
 * 2. Una operación que nombra un producto inexistente rechaza en la
 *    Compuerta 2 (resuelve contra datos reales), no en la Compuerta 1 (Zod,
 *    que solo mira la forma: `tipo` válido, campos del tipo correcto). Un
 *    `agregar_item` con `ofrecible` inventado tiene forma perfectamente
 *    válida — el rechazo tiene que venir de más adelante.
 *
 * Mismo patrón de mocks y de estado simulado entre turnos que
 * `pipeline-confirmado-sin-cierre.test.ts` (`estadoActual`/
 * `leerEstadoConVersionMock` como si fuera la fila real de
 * `conversation_state`, para poder encadenar dos `runAgentTurn` y observar
 * qué sobrevive de un turno a otro).
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoDePedidosMock = vi.fn();
const catalogoDeMock = vi.fn();
vi.mock("@/server/catalog/queries", () => ({
  catalogoDePedidos: (...a: unknown[]) => catalogoDePedidosMock(...a),
  catalogoDe: (...a: unknown[]) => catalogoDeMock(...a),
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
  listStaff: vi.fn().mockResolvedValue([]),
  estaEntreLosOfrecidos: () => Promise.resolve({ ok: true }),
  registrarOfrecidos: () => Promise.resolve(),
  limpiarOfrecidos: () => Promise.resolve(),
}));

const notifyTeamMock = vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "prueba" });
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeamMock(...a),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

/** El "estado guardado" simulado — como si fuera la fila de conversation_state. */
let estadoActual: unknown = null;
let versionActual = 0;
const guardarEstadoCalls: { estado: Record<string, unknown> }[] = [];
const guardarEstadoMock = vi.fn(async (entrada: { estado: Record<string, unknown> }) => {
  guardarEstadoCalls.push(entrada);
  estadoActual = entrada.estado;
  versionActual += 1;
  return { ok: true };
});
const leerEstadoConVersionMock = vi.fn(async () =>
  estadoActual ? { estado: estadoActual, version: versionActual } : null
);

vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    guardarEstado: (...a: Parameters<typeof guardarEstadoMock>) => guardarEstadoMock(...a),
    leerEstadoConVersion: (...a: Parameters<typeof leerEstadoConVersionMock>) =>
      leerEstadoConVersionMock(...a),
  };
});

const selectQueue: unknown[][] = [];

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
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const PAVE: { id: string; nombre: string; categoria: null; precioCents: number; descripcion: null; grupos: unknown[] } = {
  id: "p1",
  nombre: "Pavé chocolate",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
};

function conversacion(id = "cv_1") {
  return {
    id,
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil() {
  return {
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
    catalogSource: "tabla",
    paymentSource: "prompt",
    stateSource: "backend",
    deliverySource: "prompt",
    ficha: JSON.stringify({ cierre: { requisitos: [{ id: "direccion", tipo: "direccion", etiqueta: "tu dirección", obligatorio: true }] } }),
  };
}

function queueTurnoBase(texto: string) {
  selectQueue.push(
    [conversacion()],
    [perfil()],
    [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }],
    [],
    [],
    [],
    []
  );
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([PAVE]);
  catalogoDeMock.mockReset().mockResolvedValue([PAVE]);
  selectQueue.length = 0;
  guardarEstadoCalls.length = 0;
  guardarEstadoMock.mockClear();
  leerEstadoConVersionMock.mockClear();
  notifyTeamMock.mockClear();
  estadoActual = null;
  versionActual = 0;
});

describe("T016 — integración: un turno que solo cambia un dato no toca los ítems", () => {
  it("turno 1 agrega un ítem; turno 2 solo fija la dirección — el ítem del turno 1 sigue intacto", async () => {
    const { runAgentTurn } = await import("@/server/ai/pipeline");

    // Turno 1: agrega un pavé.
    queueTurnoBase("quiero un pavé de chocolate");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo! ¿Algo más?",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(1);
    const items1 = guardarEstadoCalls[0]!.estado.items as unknown[];
    expect(items1).toHaveLength(1);

    // Turno 2: SOLO fija la dirección — ninguna operación toca items.
    queueTurnoBase("mi dirección es Cra 1 # 2-3");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "Anotado, ¿algo más?",
        operaciones: [{ tipo: "fijar_dato", requisitoId: "direccion", valor: "Cra 1 # 2-3" }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(2);
    const estadoTras2 = guardarEstadoCalls[1]!.estado as { items: unknown[]; datos: Record<string, string> };
    // El ítem del turno 1 sigue exactamente igual — ninguna Operacion del
    // turno 2 lo mencionó, así que aplicarOperaciones nunca lo tocó.
    expect(estadoTras2.items).toEqual(items1);
    expect(estadoTras2.datos.direccion).toBe("Cra 1 # 2-3");
  });

  it("Compuerta 2, no Compuerta 1: un `agregar_item` bien formado pero con un producto que no existe rechaza al resolver, no al parsear", async () => {
    queueTurnoBase("quiero una torta voladora");
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "reply",
          text: "¡Claro! Te anoto la torta voladora 🎂",
          // Forma perfectamente válida para Zod/Compuerta 1: `tipo` es uno de
          // los permitidos, `ofrecible`/`opciones`/`cantidad` tienen el tipo
          // correcto. El rechazo SOLO puede venir de resolver el nombre
          // contra el catálogo real (Compuerta 2) — nunca existió una "torta
          // voladora" en `PAVE`.
          operaciones: [{ tipo: "agregar_item", ofrecible: "Torta voladora", opciones: [], cantidad: 1 }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "No tenemos torta voladora, ¿quieres un Pavé chocolate?" },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    // Nunca se llegó a guardar nada: el lote entero (una sola operación)
    // falló su Compuerta 2, y `guardarEstado` no se llama en absoluto.
    expect(guardarEstadoMock).not.toHaveBeenCalled();
    // El mecanismo de reintento (T015) sí se disparó con el motivo real.
    expect(chatJson).toHaveBeenCalledTimes(2);
    const correccion = (chatJson.mock.calls[1]![1] as { content: string }[]).at(-1)!.content;
    expect(correccion).toContain("Torta voladora");
  });
});

/**
 * T019 (feature 003-backend-como-autoridad) — el resumen que recibe el
 * EQUIPO por WhatsApp lleva las cifras que calculó el backend, no las que
 * escriba el modelo. No es código nuevo: `bloqueDeCifrasVerificadas`
 * (`anuncio-de-cierre.ts`, Fase 11-C, anterior a esta feature) ya adjunta
 * "Subtotal/Total" verificados al `summary` de `notify_order` — lo que
 * faltaba era que usara el total de ESTE turno (`aplicarOperaciones`, T007),
 * no uno leído antes de aplicar sus operaciones. Ese cableado quedó en
 * T017/T018 (la reasignación de `estadoGuardado` tras `guardarEstadoPropuesto`
 * en `pipeline.ts`). Esta prueba lo demuestra de punta a punta: el total que
 * llega a `notifyTeam` sale de una operación `agregar_item` de ESTE MISMO
 * turno, nunca de un mock pre-cargado.
 */
describe("T019 — el resumen al equipo lleva el total que calculó el backend en ESTE turno", () => {
  it("agregar_item + confirmar + notify_order en un solo turno: notifyTeam recibe el total real, no el que diga el modelo", async () => {
    // El guardarraíl "notify_order sin resumen previo" (anterior a esta
    // feature, `elClienteVioUnTotal`) exige que el cliente ya haya VISTO un
    // total en un mensaje saliente antes de cerrar — nada que ver con lo
    // que este test prueba, así que se satisface con un mensaje previo.
    // `runAgentTurn` invierte el orden (lee DESC): más nuevo primero aquí.
    selectQueue.push(
      [conversacion()],
      [perfil()],
      [
        { id: "msg_1", direction: "in", text: "quiero un pavé de chocolate y confirmo", createdAt: new Date() },
        { id: "msg_0", direction: "out", text: "Un pavé de chocolate. Total: $10.000", createdAt: new Date() },
      ],
      [],
      [],
      [],
      []
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "notify_order",
        // El resumen del modelo no repite ninguna cifra: si el total llega
        // a `notifyTeam`, solo puede venir de `cifrasDelBackend`.
        summary: "Un pavé de chocolate para el cliente.",
        subtotalCents: 1000000,
        totalCents: 1000000,
        operaciones: [
          { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 },
          // T017: este fixture (`perfil()`) declara "direccion" como
          // requisito obligatorio — sin esto, `puedeConfirmarPedido`
          // rechazaría `confirmar` correctamente, pero no es lo que este
          // test quiere demostrar.
          { tipo: "fijar_dato", requisitoId: "direccion", valor: "Cra 1 # 2-3" },
          { tipo: "confirmar" },
        ],
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(notifyTeamMock).toHaveBeenCalledTimes(1);
    const summaryEnviado = (notifyTeamMock.mock.calls[0]![0] as { summary: string }).summary;
    // Las cifras verificadas, calculadas por aplicarOperacion en ESTE turno
    // (Pavé chocolate = $10.000, sin domicilio) — nunca escritas por el
    // modelo, que no las mencionó en su `summary`.
    expect(summaryEnviado).toContain("Subtotal: $10.000");
    expect(summaryEnviado).toContain("Total: $10.000");
  });
});

/**
 * T020 (feature 003-backend-como-autoridad) — `confirmar` con un requisito
 * obligatorio sin cubrir no ejecuta `ejecutarConfirmacionDePedido` (ninguna
 * notificación real al equipo, `notifyTeamMock` nunca se llama); el cliente
 * recibe la pregunta pendiente en un `reply`, nunca una derivación. Mismo
 * mecanismo de reintento YA existente (T015) que usa el rechazo de "pedido
 * ya confirmado" — aquí el motivo es el nuevo de T017.
 */
describe("T020 — confirmar con un requisito obligatorio sin cubrir no cierra, y no deriva", () => {
  it("notify_order sin la dirección: el retry pide la dirección, el cliente NUNCA es derivado ni notificado como cerrado", async () => {
    selectQueue.push(
      [conversacion()],
      [perfil()],
      [
        { id: "msg_1", direction: "in", text: "quiero un pavé de chocolate, confirmo", createdAt: new Date() },
        { id: "msg_0", direction: "out", text: "Un pavé de chocolate. Total: $10.000", createdAt: new Date() },
      ],
      [],
      [],
      [],
      []
    );
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "notify_order",
          summary: "Un pavé de chocolate para el cliente.",
          subtotalCents: 1000000,
          totalCents: 1000000,
          // A propósito SIN fijar_dato de "direccion" — el requisito
          // obligatorio de este negocio (ver `perfil()`) queda sin cubrir.
          operaciones: [
            { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 },
            { tipo: "confirmar" },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "¿Me confirmas tu dirección de entrega?" },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    // El cliente recibe la pregunta pendiente — nunca una derivación.
    expect(action?.action).toBe("reply");
    expect(action?.action).not.toBe("handoff");
    // ejecutarConfirmacionDePedido nunca corrió: para esta conversación de
    // prueba (isTest:true) su único efecto observable es notifyTeam, y
    // nunca se llama.
    expect(notifyTeamMock).not.toHaveBeenCalled();
    // Dos escrituras, ninguna es el cierre: la primera guarda el estado con
    // `confirmado:true` (agregar_item + confirmar son OPERACIONES válidas;
    // lo que la Policy bloquea es el CIERRE, no la escritura en memoria —
    // `data-model.md` sección 4). La segunda es el guardarraíl YA existente
    // "confirmado sin cierre" (`corregirConfirmadoSinCierre`,
    // `pipeline-confirmado-sin-cierre.test.ts`) corrigiendo a `false` porque
    // el turno terminó sin notificar al equipo — interactúa correctamente
    // con el gate nuevo de T017 sin haber tocado ese mecanismo.
    expect(guardarEstadoMock).toHaveBeenCalledTimes(2);
  });
});
