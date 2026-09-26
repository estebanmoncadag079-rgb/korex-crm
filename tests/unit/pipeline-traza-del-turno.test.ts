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

const resolverEspecialistaMultiple = vi.fn();
const catalogoParaPrompt = vi.fn();
const proximasFechasConCupoMultiple = vi.fn();
const crearCitaMultiple = vi.fn();
const serviciosOfrecidosPara = vi.fn();
vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPrompt(...a),
  proximasFechasConCupoMultiple: (...a: unknown[]) => proximasFechasConCupoMultiple(...a),
  crearCitaMultiple: (...a: unknown[]) => crearCitaMultiple(...a),
  serviciosOfrecidosPara: (...a: unknown[]) => serviciosOfrecidosPara(...a),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn().mockResolvedValue([]),
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
  opts: { consultasVerificadasEnabled?: boolean; appointmentsEnabled?: boolean } = {}
) {
  return {
    id: `agp_${organizationId}`,
    organizationId,
    enabled: true,
    appointmentsEnabled: opts.appointmentsEnabled ?? false,
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
    resolverEspecialistaMultiple.mockReset().mockResolvedValue({ ok: true, staffId: "st_1" });
    catalogoParaPrompt.mockReset().mockResolvedValue([]);
    proximasFechasConCupoMultiple.mockReset().mockResolvedValue([]);
    crearCitaMultiple.mockReset().mockResolvedValue({ ok: true, staffName: "Vale" });
    serviciosOfrecidosPara.mockReset().mockResolvedValue([]);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("ESCENARIO 1 — consulta factual exitosa: fact_verified, source=backend", async () => {
    // Desde el 25-sep-2026 (doc 198) la consulta la PIDE EL MODELO: el backend
    // ya no adivina la pregunta con palabras clave. La traza la sigue anotando.
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1"), historial("¿Tienen torta de chocolate?"));
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

  it("ESCENARIO 6 — respuesta normal: categorias=normal, sin hechos ni guardarraíles", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", { consultasVerificadasEnabled: false }), historial("Hola, buenas"));
    catalogoDePedidosMock.mockResolvedValue([]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Hola! ¿En qué te puedo ayudar?" },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action?.action).toBe("reply");
    expect(linea).toContain("categorias=normal");
    expect(linea).toContain("accion=reply");
    expect(linea).toContain("hechos=-");
    expect(linea).toContain("guardarrailes=-");
    expect(linea).toContain("handoff=no");
  });

  it("ESCENARIO 7 — acción interna consult_availability: hecho de disponibilidad verificado", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: false, appointmentsEnabled: true }),
      historial("¿Tienes cupo para manicure?")
    );
    catalogoParaPrompt.mockResolvedValue([
      {
        id: "svc_1",
        name: "Manicure",
        category: null,
        priceCents: 3000000,
        durationMin: 45,
        staffNames: ["Vale"],
      },
    ]);
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_vale" });
    proximasFechasConCupoMultiple.mockResolvedValue([
      { fecha: "28/08/2026", horarios: ["15:00", "15:30"] },
    ]);
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consult_availability", servicios: ["manicure"] },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Tengo el 28 a las 3:00 o 3:30 p.m., ¿cuál te sirve?" },
        raw: "{}",
      });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action?.action).toBe("reply");
    expect(linea).toContain("categorias=fact_verified");
    expect(linea).toContain('hechos=disponibilidad:"manicure"=consultado@backend');
    expect(linea).toContain("accion=reply");
  });

  /**
   * ESCENARIO 8 — book_appointment con el guardarraíl nuevo de la Parte 1
   * (docs/korexia/149). Documenta HONESTAMENTE una limitación conocida: como el
   * `[traza]` del turno se emite ANTES del switch (punto único ~1965, por
   * crash-safety), el guardarraíl `appointment_incomplete_services` —que se
   * decide DENTRO del case— NO queda en la línea `[traza]` (aparece
   * `guardarrailes=-`). Su evidencia en vivo es el `console.warn` de `[citas]`,
   * que sí se verifica en pipeline-servicio-no-corroborado.test.ts. Aquí se
   * comprueba lo real: el turno bloquea la reserva y aún así emite su traza.
   */
  it("ESCENARIO 8 — book_appointment bloqueado por servicio no corroborado: traza emitida (guardarraíl fuera de la línea, por diseño)", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: false, appointmentsEnabled: true }),
      historial("Agéndame manos y pies el 28 a las 3")
    );
    catalogoParaPrompt.mockResolvedValue([
      { id: "svc_manos", name: "Manicure", category: null, priceCents: 3000000, durationMin: 45, staffNames: ["Vale"] },
      { id: "svc_pies", name: "Pedicure", category: null, priceCents: 3500000, durationMin: 60, staffNames: ["Vale"] },
    ]);
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "st_vale" });
    // Solo se consultó "manos": "pies" quedó sin corroborar → bloqueo.
    serviciosOfrecidosPara.mockResolvedValue(["svc_manos"]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "book_appointment",
        reservas: [
          { servicios: ["manicure", "pedicure"], fecha: "2026-08-28", hora: "15:00", especialista: "Vale" },
        ],
      },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    // Se bloqueó de verdad: no se creó ninguna cita.
    expect(crearCitaMultiple).not.toHaveBeenCalled();
    expect(action?.action).toBe("book_appointment");
    // El turno SÍ deja traza (pasa por el punto único antes del switch).
    expect(linea).toContain("accion=book_appointment");
    // Limitación documentada: el guardarraíl del case no llega a esta línea.
    expect(linea).toContain("guardarrailes=-");
  });

  /**
   * ESCENARIO 9 — excepción controlada del proveedor. El adaptador `chatJson`
   * captura el fallo de red y lo devuelve como `{ ok:false, error:"provider_error" }`;
   * el pipeline lo convierte en handoff con causa específica. La traza lo nombra.
   */
  it("ESCENARIO 9 — fallo del proveedor (provider_error): handoff con causa específica", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1", { consultasVerificadasEnabled: false }), historial("Hola"));
    catalogoDePedidosMock.mockResolvedValue([]);
    chatJson.mockResolvedValueOnce({
      ok: false,
      error: "provider_error",
      detail: "network timeout",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action?.action).toBe("handoff");
    expect(linea).toContain("handoff=si");
    expect(linea).toContain("causa_handoff=provider_error");
    expect(linea).toContain("provider_error");
  });

  /**
   * ESCENARIO 10 — retorno anticipado ANTES del LLM. Cuando la conversación ya
   * está en manos de una persona (`handoffAt`), `runAgentTurn` sale en la
   * línea ~492, ANTES de crear la traza (que nace justo antes de la primera
   * llamada al modelo). Es una ruta que DELIBERADAMENTE no genera traza: no
   * hubo turno de agente ni decisión que trazar — solo enrutamiento. Se declara
   * explícito aquí para que quede claro que la ausencia de traza es por diseño,
   * no un hueco (docs/korexia/150).
   */
  it("ESCENARIO 10 — conversación ya en handoff: sale antes del LLM y NO emite traza (por diseño)", async () => {
    const conv = { ...conversacion("org_1"), handoffAt: new Date() };
    // Solo se llega a leer la conversación; ni siquiera pide perfil/historial.
    selectQueue.push([conv]);
    catalogoDePedidosMock.mockResolvedValue([]);

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    expect(action).toBeNull();
    expect(linea).toBe(""); // ninguna línea [traza] emitida
    expect(chatJson).not.toHaveBeenCalled();
  });
});
