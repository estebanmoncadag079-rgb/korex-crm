import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Programa de mejora integral, Prioridad 1 — mismo patrón del incidente de
 * domicilio ("un dato se conoce en un lugar, se vuelve a generar en otro, y
 * pueden diferir"), aplicado a `conversation_state`.
 *
 * `guardarEstadoPropuesto` persiste la propuesta del modelo justo después de
 * la PRIMERA llamada (`chatJsonConEstado`), pero entre ese guardado y que el
 * turno termine pueden correr hasta 8 guardarraíles de texto que reescriben
 * `action` SIN volver a extraer el estado (ninguno llama `chatJsonConEstado`
 * de nuevo). Si el modelo propuso una orden completa con `confirmado:true`
 * pero la acción final del turno NO es `notify_order` (el modelo eligió
 * "reply" en la misma respuesta, o un guardarraíl lo forzó a otra cosa), el
 * pedido queda `confirmado:true` en base de datos sin que el turno haya
 * cerrado nada — un futuro turno (o un panel) podría leerlo y darlo por
 * confirmado. Este test reproduce exactamente eso y confirma que ahora se
 * corrige a `confirmado:false` antes de que el turno termine.
 *
 * Mismo patrón de mocks que recuperacion-salida-parcial.test.ts, con
 * `stateSource: "backend"` — pero mockeando `@/server/orders/estado` con
 * `importOriginal` (`estadoVacio`/`conEntregaConservada` reales) y sin tocar
 * `@/server/orders/operaciones` en absoluto, así que `aplicarOperaciones`
 * (feature 003, T007) es GENUINA: la propuesta se aplica de verdad, no se
 * finge. Se observan las llamadas a `guardarEstado`/`leerEstado` sin
 * depender del mock de bajo nivel de `@/lib/db` (que no modela
 * `onConflictDoUpdate`).
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
  estaEntreLosOfrecidos: () => Promise.resolve({ ok: true }),
  registrarOfrecidos: () => Promise.resolve(),
  limpiarOfrecidos: () => Promise.resolve(),
}));

vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" }),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

/** El "estado guardado" simulado — como si fuera la fila de conversation_state. */
let estadoActual: unknown = null;
let versionActual = 0;
const guardarEstadoCalls: { estado: { confirmado: boolean } }[] = [];
const guardarEstadoMock = vi.fn(async (entrada: { estado: { confirmado: boolean } }) => {
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

function conversacion(organizationId: string, id = "cv_1") {
  return {
    id,
    organizationId,
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

/** Perfil con Fase 2 encendida (`state_source='backend'`), como Lis. */
function perfilConEstado(organizationId: string) {
  return {
    id: `agp_${organizationId}`,
    organizationId,
    enabled: true,
    appointmentsEnabled: false,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: "09:00 AM",
    hoursClose: "21:00",
    hoursDays: "1,2,3,4,5,6",
    catalogSource: "tabla",
    paymentSource: "prompt",
    stateSource: "backend",
    consultasVerificadasEnabled: false,
    // `cierre.requisitos: []` declarado (no ausente): `requisitosDe` distingue
    // "no declarado" (rechaza cualquier confirmado:true, a propósito) de
    // "declarado y vacío" (nada que pedir, confirmar es válido) — ver
    // `src/server/ai/generador/ficha.ts`.
    ficha: JSON.stringify({
      menu: { opciones: [{ id: "ver_menu", etiqueta: "Ver menú" }] },
      cierre: { requisitos: [] },
    }),
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function producto(id: string, nombre: string, precioCents: number | null) {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

describe("conversation_state: 'confirmado:true' sin cierre real se corrige a false", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    catalogoDeMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    selectQueue.length = 0;
    inserted.length = 0;
    guardarEstadoCalls.length = 0;
    guardarEstadoMock.mockClear();
    leerEstadoConVersionMock.mockClear();
    estadoActual = null;
    versionActual = 0;
  });

  it("BUG REAL: pedido completo propuesto con confirmado:true, pero la acción final es 'reply' (no notify_order) -> se corrige a confirmado:false", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfilConEstado("org_1"), historial("Quiero una Porción Chocolate por favor"));
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Genial! ¿Necesitas algo más?",
        operaciones: [
          { tipo: "agregar_item", ofrecible: "Porción Chocolate", opciones: [], cantidad: 1 },
          { tipo: "confirmar" },
        ],
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Una sola llamada al modelo: ningún guardarraíl de texto tenía motivo
    // para dispararse con esta acción (un "reply" genérico, sin mencionar
    // pedidos, domicilio, pagos ni recursos prometidos).
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");

    // 1) El guardado inicial SÍ ocurrió con confirmado:true (la propuesta
    //    era válida: producto real del catálogo, sin requisitos pendientes).
    expect(guardarEstadoCalls[0]?.estado.confirmado).toBe(true);

    // 2) Como el turno terminó sin ejecutar notify_order, se corrigió: la
    //    ÚLTIMA escritura debe dejar confirmado:false.
    const ultimaEscritura = guardarEstadoCalls.at(-1);
    expect(ultimaEscritura?.estado.confirmado).toBe(false);
    expect(guardarEstadoCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("caso feliz (control, sin regresión): si el turno SÍ cierra con notify_order, confirmado:true se queda tal cual", async () => {
    const conv = conversacion("org_1");
    // El quinto guardarraíl ("notify_order sin resumen previo") exige un
    // mensaje SALIENTE anterior con un total — sin él, este mismo escenario
    // dispararía ESE guardarraíl en vez de probar el que nos interesa aquí.
    // `runAgentTurn` lee con `ORDER BY created_at DESC` y revierte
    // internamente: el array que se encola aquí va del más nuevo al más
    // viejo, igual que la query real.
    queueTurnoBase(conv, perfilConEstado("org_1"), [
      ...historial("Sí, confirmo mi pedido"),
      { id: "msg_0", direction: "out", text: "1 Porción Chocolate. Total: $12.500", createdAt: new Date() },
    ]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "notify_order",
        summary: "1 Porción Chocolate — $12.500. Total: $12.500",
        operaciones: [
          { tipo: "agregar_item", ofrecible: "Porción Chocolate", opciones: [], cantidad: 1 },
          { tipo: "confirmar" },
        ],
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(action?.action).toBe("notify_order");
    // Ninguna escritura posterior debió pisar el confirmado:true real.
    expect(guardarEstadoCalls.every((c) => c.estado.confirmado === true)).toBe(true);
  });
});
