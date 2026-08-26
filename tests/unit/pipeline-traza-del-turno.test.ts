import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de la traza diagnóstica (docs/korexia/145) contra el pipeline
 * real: confirma que la instrumentación agregada a `runAgentTurn` de verdad
 * emite la línea `[traza]` esperada en los 5 escenarios pedidos, no solo
 * que el módulo `traza.ts` funcione aislado (eso ya lo cubre
 * traza-del-turno.test.ts).
 *
 * Mismo patrón de mocks que pipeline-forzar-consulta-factual.test.ts.
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

function perfil(organizationId: string, opts: { consultasVerificadasEnabled?: boolean } = {}) {
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
    consultasVerificadasEnabled: opts.consultasVerificadasEnabled ?? true,
    ficha: null,
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

/** Captura todas las líneas `[traza]` emitidas durante la llamada. */
function capturarTraza(): { obtener: () => string; restaurar: () => void } {
  const lineas: string[] = [];
  const registrar = (args: unknown[]) => {
    const linea = String(args[0] ?? "");
    if (linea.startsWith("[traza]")) lineas.push(linea);
  };
  const spyLog = vi.spyOn(console, "log").mockImplementation((...a) => registrar(a));
  const spyWarn = vi.spyOn(console, "warn").mockImplementation((...a) => registrar(a));
  const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
  return {
    obtener: () => lineas.at(-1) ?? "",
    restaurar: () => {
      spyLog.mockRestore();
      spyWarn.mockRestore();
      spyError.mockRestore();
    },
  };
}

describe("runAgentTurn: traza diagnóstica por turno (docs/korexia/145)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("ESCENARIO 1 — consulta factual exitosa: fact_verified, source=backend", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1"), historial("¿Tienen torta de chocolate?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Tenemos Porción Chocolate a $12.500." },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(linea).toContain("categorias=fact_verified");
    expect(linea).toMatch(/hechos=producto:"torta de chocolate"=found@backend/);
    expect(linea).toContain("accion=reply");
    expect(linea).toContain("handoff=no");
  });

  it("ESCENARIO 2 — consulta abierta: no marca fact_verified", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1"), historial("¿Qué tienen de chocolate?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Tenemos varias opciones con chocolate." },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(linea).not.toContain("fact_verified");
    expect(linea).toContain("deteccion_factual=no");
    expect(linea).toContain("hechos=-");
  });

  it("ESCENARIO 3 — send_menu sin reply: model_output_partial_recovered", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", { consultasVerificadasEnabled: false }), historial("Hola"));
    catalogoDePedidosMock.mockResolvedValue([]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "send_menu", tipo: "intenciones" },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action?.action).toBe("send_menu");
    expect(linea).toContain("model_output_partial_recovered");
    expect(linea).toContain("recuperacion=nivel1:exito");
  });

  it("ESCENARIO 4 — guardarraíl corrige una respuesta: guardrail_corrected", async () => {
    const conv = conversacion("org_1");
    // Flag apagado: el precheck determinista no interviene, así que el
    // único camino hacia el hecho verificado es que el propio modelo pida
    // `consultar_producto` — lo que deja el guardarraíl de contradicción
    // como el único mecanismo que puede corregir la respuesta siguiente.
    queueTurnoBase(conv, perfil("org_1", { consultasVerificadasEnabled: false }), historial("¿me recomiendas algo de chocolate?"));
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "chocolate" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "No tenemos porción chocolate en este momento." },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí! Tenemos Porción Chocolate a $12.500." },
        raw: "{}",
      });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action?.action).toBe("reply");
    expect(linea).toContain("guardrail_corrected");
    expect(linea).toContain("guardarrailes=producto_contradicho:corrigio");
  });

  it("ESCENARIO 5 — handoff real: causa específica, no un genérico", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", { consultasVerificadasEnabled: false }), historial("Quiero cejas y uñas a la vez"));
    catalogoDePedidosMock.mockResolvedValue([]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "handoff", farewell: "Te comunico con alguien del equipo." },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action?.action).toBe("handoff");
    expect(linea).toContain("handoff=si");
    expect(linea).toContain("causa_handoff=business_rule");
  });
});
