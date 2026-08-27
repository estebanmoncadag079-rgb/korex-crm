import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de la verificación factual forzada de MEDIOS DE PAGO
 * (docs/korexia/146): la prueba controlada del doc 145 mostró que "¿Puedo
 * pagar por Nequi?" contra Lis obtenía la respuesta correcta sin pasar por
 * `consultar_medio_pago` — el modelo respondía leyendo la ficha en prosa,
 * la misma ruta probabilística que ya se corrigió para productos (143).
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

function perfil(
  organizationId: string,
  opts: { consultasVerificadasEnabled: boolean; paymentSource?: string; formasDePago?: string }
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
    catalogSource: "prompt",
    paymentSource: opts.paymentSource ?? "ficha",
    consultasVerificadasEnabled: opts.consultasVerificadasEnabled,
    ficha:
      opts.paymentSource === "prompt"
        ? null
        : JSON.stringify({ pago: { formas: opts.formasDePago ?? "Transferencia bancaria — incluye Nequi" } }),
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

function mensajesDeLaLlamada(indice: number): { role: string; content: string }[] {
  return chatJson.mock.calls[indice]![1] as { role: string; content: string }[];
}

describe("runAgentTurn: verificación factual forzada de medios de pago (docs/korexia/146)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    catalogoDePedidosMock.mockReset();
    catalogoDeMock.mockReset();
    catalogoDePedidosMock.mockResolvedValue([]);
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("CASO 1 — ¿Puedo pagar por Nequi?: fact_verified, allowed=true, sin contradicción", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true, formasDePago: "Transferencia bancaria — incluye Nequi" }),
      historial("¿Puedo pagar por Nequi?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Puedes pagar con Nequi sin problema." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    // Una sola llamada: el hecho ya viaja en esa llamada.
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");
    const infoSistema = mensajesDeLaLlamada(0).find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/SÍ está entre las formas de pago/);
  });

  it("CASO 2 — ¿Reciben efectivo?: allowed=false, no afirma que se acepta", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true, formasDePago: "Solo transferencia bancaria" }),
      historial("¿Reciben efectivo?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "No manejamos efectivo, solo transferencia." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");
    const infoSistema = mensajesDeLaLlamada(0).find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/NO está entre las formas de pago/);
  });

  it("CASO 3 — ¿Puedo pagar con criptomonedas?: unknown, no inventa", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Puedo pagar con criptomonedas?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "No estoy segura, te confirmo con el equipo." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const infoSistema = mensajesDeLaLlamada(0).find((m) => m.content.includes("[SISTEMA]"));
    expect(infoSistema?.content).toMatch(/No reconozco "criptomonedas" con certeza/);
  });

  it("CASO 4 — ¿Qué medios de pago manejan?: NO fuerza, sigue el flujo normal", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true }),
      historial("¿Qué medios de pago manejan?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Aceptamos transferencia bancaria, incluyendo Nequi." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    const huboInyeccion = mensajesDeLaLlamada(0).some((m) => m.content.includes("[SISTEMA]"));
    expect(huboInyeccion).toBe(false);
  });

  it("CASO 5 — flag apagado en otra organización: comportamiento intacto", async () => {
    const conv = conversacion("org_2");
    queueTurnoBase(
      conv,
      perfil("org_2", { consultasVerificadasEnabled: false, formasDePago: "Transferencia bancaria — incluye Nequi" }),
      historial("¿Puedo pagar por Nequi?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Puedes pagar con Nequi sin problema." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");
    const huboInyeccion = mensajesDeLaLlamada(0).some((m) => m.content.includes("[SISTEMA]"));
    expect(huboInyeccion).toBe(false);
  });

  it("payment_source='prompt' (sin ficha.pago): tampoco fuerza nada, aunque el flag esté encendido", async () => {
    const conv = conversacion("org_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { consultasVerificadasEnabled: true, paymentSource: "prompt" }),
      historial("¿Puedo pagar por Nequi?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "¡Sí! Puedes pagar con Nequi sin problema." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    const huboInyeccion = mensajesDeLaLlamada(0).some((m) => m.content.includes("[SISTEMA]"));
    expect(huboInyeccion).toBe(false);
  });
});
