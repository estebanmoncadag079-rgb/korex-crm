import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8C — auditoría de Fase 8B: cablea `contradiceDatosDeCuenta` en
 * `runAgentTurn`. Mismo tratamiento que el resto de la familia
 * (`confirmaPagoSinVerificar`, `niegaMetodoDePagoPermitido`): una
 * oportunidad de rehacerlo con la corrección delante y, si insiste, handoff.
 *
 * Mismo scaffold que pipeline-forzar-consulta-factual-pago.test.ts.
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

const notifyTeam = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
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

function conversacion(organizationId: string, id: string) {
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
  opts: { paymentSource: "prompt" | "ficha"; datosDeCuenta: string; formas?: string }
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
    paymentSource: opts.paymentSource,
    consultasVerificadasEnabled: false,
    // `fichaDelNegocio` (pipeline.ts:1049) se lee SIEMPRE, sin depender de
    // `paymentSource` — por eso el JSON de la ficha lleva `pago.datosDeCuenta`
    // aunque `paymentSource` sea 'prompt'.
    ficha: JSON.stringify({
      pago: { formas: opts.formas ?? "Transferencia bancaria", datosDeCuenta: opts.datosDeCuenta },
    }),
  };
}

function historial(texto: string) {
  return [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }];
}

function queueTurnoBase(conv: unknown, profile: unknown, history: unknown[]) {
  selectQueue.push([conv], [profile], history, [], [], [], []);
}

describe("runAgentTurn: fidelidad de datos de cuenta (Fase 8C)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    notifyTeam.mockReset().mockResolvedValue({ sent: 0, failed: 0, detail: "ok" });
    catalogoDePedidosMock.mockReset().mockResolvedValue([]);
    catalogoDeMock.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("cuenta citada correctamente -> una sola llamada, sin corrección", async () => {
    const conv = conversacion("org_1", "cv_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { paymentSource: "ficha", datosDeCuenta: "Bancolombia Ahorros 51400008565" }),
      historial("¿A qué cuenta transfiero?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Puedes transferir a la cuenta 51400008565 de Bancolombia." },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action?.action).toBe("reply");
  });

  it("6: payment_source='prompt' -> el guardarraíl igual detecta la cuenta alterada (no depende del flag)", async () => {
    const conv = conversacion("org_1", "cv_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { paymentSource: "prompt", datosDeCuenta: "Bancolombia Ahorros 51400008565" }),
      historial("¿A qué cuenta transfiero?")
    );
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        // Un dígito alterado: ...8565 -> ...8566
        data: { action: "reply", text: "Puedes transferir a la cuenta 51400008566 de Bancolombia." },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Puedes transferir a la cuenta 51400008565 de Bancolombia." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("reply");
    expect((action as { text: string }).text).toContain("51400008565");
  });

  it("7: dos organizaciones con cuentas distintas -> cada turno se compara SOLO contra la cuenta de su propia organización", async () => {
    // org_1: cita su propia cuenta bien -> no dispara.
    const conv1 = conversacion("org_1", "cv_org1");
    queueTurnoBase(
      conv1,
      perfil("org_1", { paymentSource: "ficha", datosDeCuenta: "Bancolombia Ahorros 51400008565" }),
      historial("¿A qué cuenta transfiero?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Puedes transferir a la cuenta 51400008565 de Bancolombia." },
      raw: "{}",
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action1 = await runAgentTurn(conv1.id);
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(action1?.action).toBe("reply");

    // org_2: tiene una cuenta COMPLETAMENTE distinta. Si por error se
    // comparara contra la de org_1, esta cita (correcta para org_2) se
    // marcaría como contradicción -> no debe pasar.
    const conv2 = conversacion("org_2", "cv_org2");
    queueTurnoBase(
      conv2,
      perfil("org_2", { paymentSource: "ficha", datosDeCuenta: "Nequi 3009998877" }),
      historial("¿A qué cuenta transfiero?")
    );
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "reply", text: "Puedes transferir por Nequi al 3009998877." },
      raw: "{}",
    });
    const action2 = await runAgentTurn(conv2.id);

    expect(chatJson).toHaveBeenCalledTimes(2); // 1 de org_1 + 1 de org_2, sin reintento
    expect(action2?.action).toBe("reply");
  });

  it("9: reintento/corrección -> el modelo corrige en el segundo intento y esa es la respuesta final", async () => {
    const conv = conversacion("org_1", "cv_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { paymentSource: "ficha", datosDeCuenta: "Bancolombia Ahorros 51400008565" }),
      historial("¿A qué cuenta transfiero?")
    );
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Puedes transferir a la cuenta 51400008560 de Bancolombia." },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Perdón, la cuenta correcta es 51400008565 de Bancolombia." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    const segundaLlamada = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    expect(segundaLlamada.at(-1)?.content).toMatch(/no coinciden con los datos reales/i);
    expect(action?.action).toBe("reply");
    expect((action as { text: string }).text).toContain("51400008565");
  });

  it("10: el modelo insiste tras la corrección -> escala a una persona (handoff), no se le entrega el dato incorrecto al cliente", async () => {
    const conv = conversacion("org_1", "cv_1");
    queueTurnoBase(
      conv,
      perfil("org_1", { paymentSource: "ficha", datosDeCuenta: "Bancolombia Ahorros 51400008565" }),
      historial("¿A qué cuenta transfiero?")
    );
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "reply", text: "Puedes transferir a la cuenta 51400008560 de Bancolombia." },
        raw: "{}",
      })
      .mockResolvedValueOnce({
        ok: true,
        // Sigue mal tras la corrección.
        data: { action: "reply", text: "Puedes transferir a la cuenta 51400008561 de Bancolombia." },
        raw: "{}",
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn(conv.id);

    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(action?.action).toBe("handoff");
    // El dato incorrecto nunca llega al cliente: la única salida insertada
    // (conversación de prueba) no debe llevar el número alterado.
    const salientes = inserted.filter(
      (i) => (i.values as { direction?: string }).direction === "out"
    );
    for (const s of salientes) {
      expect(String(s.values.text ?? "")).not.toMatch(/51400008560|51400008561/);
    }
  });
});
