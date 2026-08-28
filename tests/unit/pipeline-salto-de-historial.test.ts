import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reproducción de extremo a extremo del incidente real (Lis Pastelería,
 * "Laura Stefanny", docs/korexia/151): un pedido se cerró y 11 días después
 * la clienta escribió "Hola" — el bot respondió como si el pedido siguiera
 * en curso porque el historial que llegaba al modelo no tenía ninguna marca
 * de tiempo.
 *
 * Este test corre el pipeline REAL (`runAgentTurn`) con un historial que
 * reproduce esa misma forma (pedido completo + 11 días de silencio + "Hola")
 * y confirma que el mensaje `[SISTEMA]` de ruptura temporal SÍ llega a la
 * llamada real del modelo, y que la traza del turno lo refleja.
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
  serviciosOfrecidosPara: () => Promise.resolve([]),
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

function capturarTraza(): { obtener: () => string; restaurar: () => void } {
  const lineas: string[] = [];
  const registrar = (args: unknown[]) => {
    const linea = String(args[0] ?? "");
    if (linea.startsWith("[traza]")) lineas.push(linea);
  };
  const spyLog = vi.spyOn(console, "log").mockImplementation((...a) => registrar(a));
  const spyWarn = vi.spyOn(console, "warn").mockImplementation((...a) => registrar(a));
  return {
    obtener: () => lineas.at(-1) ?? "",
    restaurar: () => {
      spyLog.mockRestore();
      spyWarn.mockRestore();
    },
  };
}

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

function perfil(organizationId: string) {
  return {
    id: `agp_${organizationId}`,
    organizationId,
    enabled: true,
    appointmentsEnabled: false,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules:
      "Pasa la conversación a una persona del equipo si el cliente pregunta por el estado de un pedido ya hecho.",
    greeting: null,
    hoursOpen: "09:00 AM",
    hoursClose: "21:00",
    hoursDays: "1,2,3,4,5,6",
    catalogSource: "prompt",
    paymentSource: "prompt",
    consultasVerificadasEnabled: false,
    ficha: null,
  };
}

const DIA = 24 * 60 * 60 * 1000;
// +1h de colchón sobre los 11 días: los mensajes "de hace 11 días" quedan a
// 11 días y unos 35 minutos de "ahora", así el redondeo hacia abajo de
// `mayorSaltoDeHistorial` (días completos) da 11 de forma estable, sin
// depender de los milisegundos exactos en que corre el test.
const HACE_11_DIAS = new Date(Date.now() - 11 * DIA - 60 * 60 * 1000);
const AHORA = new Date();

/** El pedido completo de hace 11 días + el "Hola" nuevo — la forma real del incidente. */
function historialDelIncidente() {
  return [
    { id: "m1", direction: "out", text: "¡Excelente! Tu pedido está confirmado.", aiGenerated: true, createdAt: HACE_11_DIAS },
    { id: "m2", direction: "out", text: "Recibimos tu pago, ya lo estamos preparando.", aiGenerated: false, createdAt: new Date(HACE_11_DIAS.getTime() + 5 * 60 * 1000) },
    { id: "m3", direction: "out", text: "Ya va en camino tu pedido, que lo disfrutes.", aiGenerated: false, createdAt: new Date(HACE_11_DIAS.getTime() + 20 * 60 * 1000) },
    { id: "m4", direction: "in", text: "Gracias", createdAt: new Date(HACE_11_DIAS.getTime() + 25 * 60 * 1000) },
    { id: "m5", direction: "in", text: "Hola", createdAt: AHORA },
  ];
}

/**
 * El pipeline pide el historial en orden DESCENDENTE (más reciente primero)
 * y lo revierte él mismo antes de usarlo — igual que hace la consulta real
 * (`orderBy(desc(createdAt))` seguido de `.reverse()`). El mock de `select`
 * no reordena nada por su cuenta, así que aquí se entrega ya invertido para
 * que, tras el `.reverse()` del pipeline, quede en el orden cronológico real.
 */
function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], [...history].reverse(), [], [], [], []);
}

function mensajesDeLaLlamada(indice: number): { role: string; content: string }[] {
  return chatJson.mock.calls[indice]![1] as { role: string; content: string }[];
}

describe("runAgentTurn: contexto temporal en el historial (docs/korexia/151)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset().mockResolvedValue([]);
    catalogoDeMock.mockReset().mockResolvedValue([]);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("reproduce el incidente real: el mensaje [SISTEMA] de ruptura llega a la llamada real del modelo", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(conv, perfil("org_1"), historialDelIncidente());
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Hola! Bienvenida de nuevo 💗 ¿En qué te puedo ayudar hoy?" },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    const mensajes = mensajesDeLaLlamada(0);
    const marcador = mensajes.find((m) => m.content.includes("[SISTEMA]"));
    expect(marcador).toBeTruthy();
    expect(marcador!.content).toContain("11 días");

    // El marcador va DESPUÉS de "Gracias" (lo viejo) y ANTES de "Hola" (lo nuevo).
    const indiceGracias = mensajes.findIndex((m) => m.content === "Gracias");
    const indiceMarcador = mensajes.findIndex((m) => m.content.includes("[SISTEMA]"));
    const indiceHola = mensajes.findIndex((m) => m.content === "Hola");
    expect(indiceGracias).toBeLessThan(indiceMarcador);
    expect(indiceMarcador).toBeLessThan(indiceHola);

    // La traza lo refleja, sin exponer el texto del cliente.
    expect(linea).toContain("historial_salto=11d");
    expect(linea).toContain("categorias=history_gap");

    expect(action?.action).toBe("reply");
  });

  it("sin ruptura (pedido de hace 20 minutos): NO aparece ningún marcador, ni en la traza", async () => {
    const conv = conversacion("org_1");
    const reciente = new Date(Date.now() - 20 * 60 * 1000);
    queueTurnoBase(conv, perfil("org_1"), [
      { id: "m1", direction: "out", text: "Tu pedido está confirmado.", aiGenerated: true, createdAt: reciente },
      { id: "m2", direction: "in", text: "Hola", createdAt: new Date() },
    ]);
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Hola! ¿Cómo vas con tu pedido?" },
      raw: "{}",
    });

    const captura = capturarTraza();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);
    const linea = captura.obtener();
    captura.restaurar();

    const mensajes = mensajesDeLaLlamada(0);
    expect(mensajes.some((m) => m.content.includes("[SISTEMA]"))).toBe(false);
    expect(linea).toContain("historial_salto=no");
  });
});
