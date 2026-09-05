import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase urgente (4-sep-2026) — reproduce el incidente REAL de La Churra
 * contra el pipeline completo: "¿tienen chocolate blanco?" es una salsa
 * (opción dentro de cada producto), no un producto en sí. Antes de esta
 * fase, `consultar_producto` solo buscaba entre nombres de producto,
 * devolvía `not_found`, y el `[SISTEMA]` resultante le decía al modelo
 * "no lo tienen" sobre algo que sí estaba en el catálogo real. Mismo
 * patrón de mocks que `pipeline-consultar-producto.test.ts`.
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
    escalationRules: null,
    greeting: null,
    hoursOpen: "09:00 AM",
    hoursClose: "21:00",
    hoursDays: "1,2,3,4,5,6",
    catalogSource: "tabla",
    paymentSource: "prompt",
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function opcion(id: string, nombre: string) {
  return { id, nombre, precioExtraCents: 0 };
}

function producto(id: string, nombre: string, grupos: ReturnType<typeof grupoDeSalsas>[] = []) {
  return { id, nombre, categoria: null, precioCents: 1000000, descripcion: null, grupos };
}

function grupoDeSalsas(id: string, opciones: ReturnType<typeof opcion>[]) {
  return { id, nombre: "SALSA", minimo: 1, maximo: 1, permiteRepeticion: false, opciones };
}

/** Encola las 7 lecturas que hace `runAgentTurn` antes de llegar a la lógica de acciones. */
function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

const CATALOGO_LA_CHURRA = [
  producto("prod_besties", "BESTIES", [
    grupoDeSalsas("g1", [opcion("o1", "arequipe"), opcion("o2", "chocolate blanco"), opcion("o3", "chocolate negro"), opcion("o4", "lechera")]),
  ]),
  producto("prod_churrita", "CHURRITA", [
    grupoDeSalsas("g2", [opcion("o5", "arequipe"), opcion("o6", "chocolate blanco"), opcion("o7", "chocolate negro"), opcion("o8", "lechera")]),
  ]),
  producto("prod_familybox", "FAMILY BOX", [
    grupoDeSalsas("g3", [opcion("o9", "arequipe"), opcion("o10", "chocolate blanco"), opcion("o11", "chocolate negro"), opcion("o12", "lechera")]),
  ]),
  producto("prod_megabox", "MEGA BOX", [
    grupoDeSalsas("g4", [opcion("o13", "arequipe"), opcion("o14", "chocolate blanco"), opcion("o15", "chocolate negro"), opcion("o16", "lechera")]),
  ]),
];

describe("runAgentTurn: consultar_producto reconoce salsas/opciones — incidente real de La Churra", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset().mockResolvedValue(CATALOGO_LA_CHURRA);
    catalogoDeMock.mockReset().mockResolvedValue(CATALOGO_LA_CHURRA);
    selectQueue.length = 0;
  });

  it("BUG REAL corregido: 'chocolate blanco' no es un producto, pero SÍ existe como salsa -> el [SISTEMA] confirma que la tienen, nunca que no existe", async () => {
    const conv = conversacion("org_la_churra");
    queueTurnoBase(conv, perfil("org_la_churra"), historial("Tienes disponible la salsa de chocolate blanco?"));

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "la salsa de chocolate blanco" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí, claro! Tenemos chocolate blanco disponible 🤎" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(action?.action).toBe("reply");

    // El hecho [SISTEMA] que vio el modelo NUNCA dice "no existe" — dice
    // que SÍ es una opción real del catálogo.
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).not.toMatch(/no lo tienen|no digas que sí lo tienen/i);
    expect(infoSistema?.content).toMatch(/chocolate blanco/i);
    expect(infoSistema?.content).toMatch(/opción real del catálogo/i);
    // Respeta la relación producto -> opción: dice para cuáles aplica.
    expect(infoSistema?.content).toMatch(/BESTIES/);
    expect(infoSistema?.content).toMatch(/CHURRITA/);
  });

  it("compatibilidad: un producto real sigue resolviéndose como producto, no como opción (sin regresión del camino ya probado)", async () => {
    const conv = conversacion("org_la_churra");
    queueTurnoBase(conv, perfil("org_la_churra"), historial("¿Tienen churrita?"));

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "churrita" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "¡Sí, tenemos Churrita!" },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/Encontré "CHURRITA"/);
  });

  it("genuinamente no existe ni como producto ni como opción -> sigue diciendo que no lo tienen, no inventa nada", async () => {
    const conv = conversacion("org_la_churra");
    queueTurnoBase(conv, perfil("org_la_churra"), historial("¿Tienen servicio de manicure?"));

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "servicio de manicure" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "No manejamos eso, lo siento." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No encontré/);
  });

  it("multi-tenant: la salsa de La Churra nunca aparece al resolver la consulta de otro tenant", async () => {
    const conv = conversacion("org_otro_negocio");
    queueTurnoBase(conv, perfil("org_otro_negocio"), historial("¿Tienen chocolate blanco?"));
    // Otro negocio, con un catálogo completamente distinto (sin esa salsa).
    catalogoDePedidosMock.mockReset().mockResolvedValueOnce([producto("prod_x", "COMBO", [])]);

    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "consultar_producto", consulta: "chocolate blanco" },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "No manejamos eso." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(catalogoDePedidosMock).toHaveBeenCalledWith("org_otro_negocio");
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const infoSistema = segundaLlamada.find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No encontré/);
  });
});
