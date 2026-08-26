import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de la verificación factual FORZADA (docs/korexia/143): la
 * prueba controlada con Lis mostró que el modelo no siempre decide llamar
 * `consultar_producto` por su cuenta. Con `consultasVerificadasEnabled`
 * encendido, el servidor detecta una pregunta factual concreta ANTES de la
 * primera llamada al modelo y le entrega el hecho verificado ya en esa
 * primera respuesta — sin depender de que el modelo decida verificar.
 *
 * Mismo patrón de mocks que pipeline-consultar-producto.test.ts.
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

function perfil(
  organizationId: string,
  opts: { consultasVerificadasEnabled: boolean; catalogSource?: string }
) {
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
    catalogSource: opts.catalogSource ?? "tabla",
    paymentSource: "prompt",
    consultasVerificadasEnabled: opts.consultasVerificadasEnabled,
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

function mensajesDeLaLlamada(indice: number): { role: string; content: string }[] {
  return chatJson.mock.calls[indice]![1] as { role: string; content: string }[];
}

describe("runAgentTurn: verificación factual forzada (docs/korexia/143)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("CASO 1/2 — flag encendido: 'tienen torta de chocolate' verifica ANTES de la primera respuesta del modelo", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Tienen disponible torta de chocolate?")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Tenemos Porción Chocolate a $12.500." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Una sola llamada al modelo: el hecho ya viaja en ESA llamada, no hace
    // falta una segunda vuelta ni que el modelo pida `consultar_producto`.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");

    const primeraLlamada = mensajesDeLaLlamada(0);
    const infoSistema = primeraLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/Encontré "Porción Chocolate"/);
    expect(infoSistema?.role).toBe("user");
  });

  it("CASO 3 — pregunta de precio con producto nombrado: verifica y usa el precio real", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Cuánto cuesta la torta de chocolate?")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "La Porción Chocolate cuesta $12.500." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const infoSistema = mensajesDeLaLlamada(0).find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/\$12\.500|1250000|Encontré "Porción Chocolate"/);
  });

  it("CASO 4 — pregunta abierta ('qué tienen de chocolate'): NO fuerza nada, catálogo completo como siempre", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Qué tienen de chocolate?")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Tenemos varias opciones con chocolate: [...]" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const huboInyeccion = mensajesDeLaLlamada(0).some((m) => m.content.includes("[SISTEMA]"));
    expect(huboInyeccion).toBe(false);
  });

  it("CASO 5 — consulta interpretativa ('para 15 personas, no muy dulce'): NO fuerza búsqueda única", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("Quiero algo para 15 personas y que no sea tan dulce.")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Te recomiendo el Mini Box, tiene variedad y no es tan dulce." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const huboInyeccion = mensajesDeLaLlamada(0).some((m) => m.content.includes("[SISTEMA]"));
    expect(huboInyeccion).toBe(false);
  });

  it("CASO 6 — producto inexistente: verifica y no inventa", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Tienen cupcakes de vainilla?")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "No manejamos cupcakes de vainilla en este momento." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const infoSistema = mensajesDeLaLlamada(0).find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No encontré "cupcakes de vainilla"/);
  });

  it("CASO 7 — flag APAGADO: el comportamiento actual no cambia (sin inyección previa)", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: false }),
      historial("¿Tienen disponible torta de chocolate?")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Tenemos Porción Chocolate a $12.500." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");
    const huboInyeccion = mensajesDeLaLlamada(0).some((m) => m.content.includes("[SISTEMA]"));
    expect(huboInyeccion).toBe(false);
  });

  it("CASO 8 — aislamiento: la verificación forzada usa solo el catálogo de esta organización", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Tienen disponible combo especial fresa?")
    );
    catalogoDePedidosMock.mockImplementation(async (orgId: string) => {
      if (orgId === "org_1") return [producto("p1", "Porción Chocolate", 1250000)];
      if (orgId === "org_2") return [producto("p2", "Combo Especial Fresa", 2000000)];
      return [];
    });

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Por ahora no manejamos ese producto." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(catalogoDePedidosMock).toHaveBeenCalledWith("org_1");
    expect(catalogoDePedidosMock).not.toHaveBeenCalledWith("org_2");
    const infoSistema = mensajesDeLaLlamada(0).find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No encontré "combo especial fresa"/);
  });

  it("evita doble ejecución: si el modelo IGUAL llama a consultar_producto tras el precheck, no repite la consulta a la base de datos", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Tienen disponible torta de chocolate?")
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Porción Chocolate", 1250000)]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "torta de chocolate" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí! Tenemos Porción Chocolate a $12.500." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    // El catálogo se cargó UNA sola vez (al armar el prompt): el bucle de
    // consultar_producto reutiliza ese mismo arreglo en memoria, sin volver
    // a golpear la base de datos.
    expect(catalogoDePedidosMock).toHaveBeenCalledTimes(1);
  });
});
