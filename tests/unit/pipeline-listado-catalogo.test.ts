import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reproducción de extremo a extremo del incidente real de Malía (auditoría
 * de jerarquía de verdad, 1-sep-2026): un humano le dijo a un cliente "no
 * tenemos Pavé de Leche Klim" y ese mensaje quedó en el historial. Días
 * después el producto vuelve a estar disponible en el catálogo real, pero
 * cuando el cliente preguntó "¿cuáles son los sabores que tienes?" — una
 * pregunta de LISTADO, no de un producto puntual — nada verificaba el
 * catálogo actual antes de responder.
 *
 * Este test corre el pipeline REAL (`runAgentTurn`) con ese historial exacto
 * y confirma que el mensaje `[SISTEMA]` con el catálogo real (que SÍ incluye
 * Leche Klim) llega a la llamada real del modelo.
 *
 * Mismo patrón de mocks que pipeline-forzar-consulta-factual.test.ts y
 * pipeline-salto-de-historial.test.ts.
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

function producto(id: string, nombre: string, precioCents: number | null) {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

/**
 * El pipeline pide el historial en orden DESCENDENTE y lo revierte él mismo
 * (igual que la consulta real). El mock de `select` no reordena nada por su
 * cuenta, así que aquí se entrega ya invertido — mismo patrón que
 * pipeline-salto-de-historial.test.ts.
 */
function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], [...history].reverse(), [], [], [], []);
}

function mensajesDeLaLlamada(indice: number): { role: string; content: string }[] {
  return chatJson.mock.calls[indice]![1] as { role: string; content: string }[];
}

const HACE_3_DIAS = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

describe("runAgentTurn: historial humano obsoleto vs. catálogo real (auditoría 1-sep-2026)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("PASO 7 — el caso real del incidente: mensaje humano obsoleto + pregunta de listado → gana el catálogo real", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      [
        {
          id: "m1",
          direction: "out",
          text: "No tenemos Pavé de Leche Klim en este momento.",
          aiGenerated: false,
          createdAt: HACE_3_DIAS,
        },
        {
          id: "m2",
          direction: "in",
          text: "¿Cuáles son los sabores que tienes?",
          createdAt: new Date(),
        },
      ]
    );
    catalogoDePedidosMock.mockResolvedValue([
      producto("p1", "Pavé de Leche Klim", 1500000),
      producto("p2", "Pavé de Oreo", 1500000),
    ]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "reply",
        text: "Tenemos Pavé de Leche Klim y Pavé de Oreo, ¿cuál te gustaría?",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const mensajes = mensajesDeLaLlamada(0);

    // El mensaje humano obsoleto sigue en el historial (se preserva, no se borra)...
    const mensajeHumano = mensajes.find((m) => m.content.includes("No tenemos Pavé de Leche Klim"));
    expect(mensajeHumano).toBeTruthy();

    // ...pero el catálogo real, con Leche Klim disponible, se inyecta DESPUÉS,
    // como la última palabra antes de que el modelo responda.
    const infoSistema = mensajes.find(
      (m) => m.content.includes("[SISTEMA]") && m.content.includes("Pavé de Leche Klim")
    );
    expect(infoSistema).toBeTruthy();
    expect(infoSistema!.content).toContain("catálogo real y ACTUAL");

    const indiceHumano = mensajes.indexOf(mensajeHumano!);
    const indiceSistema = mensajes.indexOf(infoSistema!);
    expect(indiceHumano).toBeLessThan(indiceSistema);

    expect(action?.action).toBe("reply");
  });

  it("PASO 8 — contexto humano legítimo: un compromiso concreto se preserva, sin disparar ninguna verificación", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      [
        {
          id: "m1",
          direction: "out",
          text: "Ya te aparté el Pavé de Oreo.",
          aiGenerated: false,
          createdAt: HACE_3_DIAS,
        },
        {
          id: "m2",
          direction: "in",
          text: "Perfecto, paso por él más tarde.",
          createdAt: new Date(),
        },
      ]
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Pavé de Oreo", 1500000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Perfecto! Ahí te esperamos." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const mensajes = mensajesDeLaLlamada(0);

    // El compromiso del humano sigue intacto en el historial.
    const mensajeHumano = mensajes.find((m) => m.content.includes("Ya te aparté el Pavé de Oreo"));
    expect(mensajeHumano).toBeTruthy();
    expect(mensajeHumano!.content).toContain("una persona del negocio");

    // "Perfecto, paso por él más tarde" no es una consulta factual ni de
    // listado: no debe dispararse ninguna verificación contra backend. (El
    // "[SISTEMA]" del salto de historial es un mecanismo aparte, ya probado
    // en pipeline-salto-de-historial.test.ts — se excluye aquí a propósito.)
    const huboInyeccionDeCatalogo = mensajes.some(
      (m) => m.content.includes("[SISTEMA]") && !m.content.includes("días sin mensajes")
    );
    expect(huboInyeccionDeCatalogo).toBe(false);
  });

  it("PASO 9 — flag APAGADO: la pregunta de listado no dispara ninguna verificación nueva", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: false }),
      [
        {
          id: "m1",
          direction: "out",
          text: "No tenemos Pavé de Leche Klim en este momento.",
          aiGenerated: false,
          createdAt: HACE_3_DIAS,
        },
        {
          id: "m2",
          direction: "in",
          text: "¿Cuáles son los sabores que tienes?",
          createdAt: new Date(),
        },
      ]
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Pavé de Leche Klim", 1500000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Tenemos varios sabores disponibles." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const huboInyeccionDeCatalogo = mensajesDeLaLlamada(0).some(
      (m) => m.content.includes("[SISTEMA]") && !m.content.includes("días sin mensajes")
    );
    expect(huboInyeccionDeCatalogo).toBe(false);
  });

  it("FASE C.1 — precedencia: '¿qué sabores tienen disponibles?' se reconoce como LISTADO, no busca 'disponibles' como producto", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      [
        {
          id: "m1",
          direction: "out",
          text: "No tenemos Pavé de Leche Klim en este momento.",
          aiGenerated: false,
          createdAt: HACE_3_DIAS,
        },
        {
          id: "m2",
          direction: "in",
          text: "¿Qué sabores tienen disponibles?",
          createdAt: new Date(),
        },
      ]
    );
    catalogoDePedidosMock.mockResolvedValue([
      producto("p1", "Pavé de Leche Klim", 1500000),
      producto("p2", "Pavé de Oreo", 1500000),
    ]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "reply",
        text: "Tenemos Pavé de Leche Klim y Pavé de Oreo, ¿cuál te gustaría?",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const mensajes = mensajesDeLaLlamada(0);

    // Se reconoce como LISTADO: llega el catálogo completo, con Leche Klim.
    const infoListado = mensajes.find(
      (m) => m.content.includes("[SISTEMA]") && m.content.includes("catálogo real y ACTUAL")
    );
    expect(infoListado).toBeTruthy();
    expect(infoListado!.content).toContain("Pavé de Leche Klim");

    // "disponibles" NUNCA se buscó como si fuera el nombre de un producto —
    // antes de la Fase C.1 esto habría inyectado 'No encontré "disponibles"'.
    const falsoPositivo = mensajes.some((m) => m.content.includes('No encontré "disponibles"'));
    expect(falsoPositivo).toBe(false);
  });

  it("FASE C.1 — control: '¿tienen Pavé de Leche Klim?' sigue resolviendo como producto puntual (found), no como listado", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      [
        {
          id: "m1",
          direction: "out",
          text: "No tenemos Pavé de Leche Klim en este momento.",
          aiGenerated: false,
          createdAt: HACE_3_DIAS,
        },
        {
          id: "m2",
          direction: "in",
          text: "¿Tienen Pavé de Leche Klim?",
          createdAt: new Date(),
        },
      ]
    );
    catalogoDePedidosMock.mockResolvedValue([producto("p1", "Pavé de Leche Klim", 1500000)]);

    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Tenemos Pavé de Leche Klim a $15.000." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const mensajes = mensajesDeLaLlamada(0);

    const infoProducto = mensajes.find(
      (m) => m.content.includes("[SISTEMA]") && m.content.includes('Encontré "Pavé de Leche Klim"')
    );
    expect(infoProducto).toBeTruthy();

    // No debió tratarse como consulta de listado (ese mensaje no aparece).
    const infoListado = mensajes.some((m) => m.content.includes("catálogo real y ACTUAL"));
    expect(infoListado).toBe(false);
  });
});
