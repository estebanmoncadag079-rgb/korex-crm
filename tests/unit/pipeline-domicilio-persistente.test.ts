import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10V-X — cierra la brecha real: un cliente verifica la tarifa de
 * domicilio en un turno (`consultar_domicilio`) y confirma el pedido varios
 * turnos después — el backend ya no depende de que el modelo "recuerde"
 * reverificar en el turno de cierre. Los 10 escenarios obligatorios de la
 * fase, contra el pipeline completo.
 *
 * `leerEntregaVerificada`/`guardarEntregaVerificada` (orders/estado.ts) se
 * mockean con un Map en memoria — la persistencia REAL entre turnos ya está
 * probada a nivel de Postgres/CAS en `estado-entrega.test.ts`; aquí lo que
 * se prueba es que `pipeline.ts` las usa correctamente: cuándo lee, cuándo
 * escribe, cuándo invalida.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const notifyTeam = vi.fn();
const contactPhoneOf = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
  contactPhoneOf: (...a: unknown[]) => contactPhoneOf(...a),
}));

const zonasDeEntregaQuery = vi.fn();
vi.mock("@/server/delivery/zonas", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/delivery/zonas")>();
  return {
    ...original,
    zonasDeEntregaQuery: (...args: unknown[]) => zonasDeEntregaQuery(...args),
  };
});

/**
 * La verificación de domicilio persistida, en memoria, por
 * `organizationId:conversationId` — un stand-in fiel del comportamiento
 * REAL de `leerEntregaVerificada`/`guardarEntregaVerificada` (que a su vez
 * ya se prueban contra un mock de Postgres en `estado-entrega.test.ts`),
 * sin arrastrar aquí el mock de bajo nivel de `onConflictDoUpdate`.
 */
type Entrega = {
  tipo: "domicilio" | "recogida";
  zonaId: string | null;
  zonaNombre: string | null;
  feeCents: number | null;
  verificadoEnMensajeId: string | null;
  verificadoEn: string;
};
const entregaStore = new Map<string, Entrega | null>();
vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    leerEntregaVerificada: async (conversationId: string, organizationId: string) =>
      entregaStore.get(`${organizationId}:${conversationId}`) ?? null,
    guardarEntregaVerificada: async (entrada: {
      conversationId: string;
      organizationId: string;
      entrega: Entrega | null;
    }) => {
      // Un pequeño respiro asíncrono real, para que la prueba de
      // concurrencia (escenario 7) pueda intercalar de verdad dos
      // escrituras en vuelo en vez de resolver siempre en el mismo orden
      // en que se llamaron.
      await new Promise((r) => setTimeout(r, 0));
      entregaStore.set(`${entrada.organizationId}:${entrada.conversationId}`, entrada.entrega);
      return { ok: true };
    },
  };
});

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
    contactId: `ct_${id}`,
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil(organizationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `agp_${organizationId}`,
    organizationId,
    enabled: true,
    appointmentsEnabled: false,
    deliverySource: "tabla",
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: "08:00",
    hoursClose: "23:00",
    hoursDays: "1,2,3,4,5,6,7",
    ...overrides,
  };
}

function msg(id: string, direction: "in" | "out", text: string) {
  return { id, direction, text, createdAt: new Date() };
}

/**
 * `runAgentTurn` pide el historial `orderBy(desc(createdAt))` y lo revierte
 * en el sitio — se escribe aquí en orden cronológico y se invierte antes de
 * entregarlo, mismo criterio que el resto de la suite.
 */
function queueTurno(
  conv: ReturnType<typeof conversacion>,
  prof: ReturnType<typeof perfil>,
  history: ReturnType<typeof msg>[],
  zonas: unknown[]
) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push([conv], [prof], copia, [], [], []);
  zonasDeEntregaQuery.mockResolvedValueOnce(zonas);
}

const ZONA_KACHIPAY = { id: "dz_1", nombre: "Kachipay", feeCents: 1200000 };
const ZONA_CENTRO = { id: "dz_2", nombre: "Centro", feeCents: 500000 };

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  notifyTeam.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  contactPhoneOf.mockReset().mockResolvedValue(null);
  zonasDeEntregaQuery.mockReset();
  selectQueue.length = 0;
  entregaStore.clear();
});

describe("Fase 10V-X: verificación de domicilio persistida entre turnos", () => {
  it("1: consulta domicilio -> varios mensajes -> confirma el pedido: preserva la tarifa correcta sin reverificar", async () => {
    const conv = conversacion("org_1", "cv_1");
    const prof = perfil("org_1");

    // Turno 1: el cliente pregunta, el modelo verifica.
    queueTurno(conv, prof, [msg("m1", "in", "cuanto es el domicilio a Kachipay?")], [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const respuesta1 = { action: "reply", text: "El domicilio a Kachipay es $12.000." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValueOnce({ ok: true, data: respuesta1, raw: JSON.stringify(respuesta1) });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);
    expect(entregaStore.get("org_1:cv_1")).toMatchObject({ tipo: "domicilio", feeCents: 1200000 });

    // Turno 2, varios mensajes después: el cliente confirma. El modelo NO
    // vuelve a llamar consultar_domicilio — se apoya en lo ya verificado.
    queueTurno(
      conv,
      prof,
      [
        msg("m1", "in", "cuanto es el domicilio a Kachipay?"),
        msg("m2", "out", "El domicilio a Kachipay es $12.000."),
        msg("m3", "in", "Quiero 1 Pavé Cremoso"),
        msg("m4", "out", "1 Pavé Cremoso — $18.000. 💰 Total: $30.000 (con domicilio). ¿Confirmas?"),
        msg("m5", "in", "Confirmo"),
      ],
      [ZONA_KACHIPAY]
    );
    const cierre = {
      action: "notify_order",
      summary: "1 Pavé Cremoso — $18.000. Domicilio a Kachipay: $12.000. Total: $30.000.",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: JSON.stringify(cierre) });

    const action = await runAgentTurn(conv.id);

    expect(action?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining("$12.000") })
    );
  });

  it("2: cambio de zona invalida la tarifa anterior — la vieja ya no sirve, la nueva sí", async () => {
    const conv = conversacion("org_1", "cv_2");
    const prof = perfil("org_1");

    queueTurno(conv, prof, [msg("m1", "in", "cuanto a Kachipay?")], [ZONA_KACHIPAY]);
    const consultaA = { action: "consultar_domicilio", zona: "Kachipay" };
    const replyA = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaA, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: replyA, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);
    expect(entregaStore.get("org_1:cv_2")).toMatchObject({ feeCents: 1200000 });

    // El cliente cambia de zona; el modelo reverifica (como pide el contrato).
    queueTurno(conv, prof, [msg("m2", "in", "mejor mandalo a Centro")], [ZONA_CENTRO]);
    const consultaB = { action: "consultar_domicilio", zona: "Centro" };
    const replyB = { action: "reply", text: "$5.000 a Centro." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaB, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: replyB, raw: "" });
    await runAgentTurn(conv.id);
    expect(entregaStore.get("org_1:cv_2")).toMatchObject({ feeCents: 500000, zonaNombre: "Centro" });

    // La tarifa VIEJA (Kachipay, $12.000) ya no es válida: si el cierre la
    // usa sin reverificar, se rechaza — nunca "gana" solo porque se
    // verificó alguna vez en esta conversación.
    queueTurno(
      conv,
      prof,
      [
        msg("m2b", "out", "💰 Total: $22.000. ¿Confirmas?"),
        msg("m3", "in", "Confirmo"),
      ],
      [ZONA_CENTRO]
    );
    const cierreConTarifaVieja = {
      action: "notify_order",
      summary: "Total con domicilio a Kachipay: $12.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 1200000,
      totalCents: 2200000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: cierreConTarifaVieja, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: cierreConTarifaVieja, raw: "" }); // insiste tras la corrección
    const resultado = await runAgentTurn(conv.id);
    expect(resultado?.action).toBe("handoff");
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining("$12.000") })
    );

    // La tarifa NUEVA (Centro, $5.000) sí se acepta sin reverificar.
    queueTurno(
      conv,
      prof,
      [
        msg("m2b", "out", "💰 Total: $22.000. ¿Confirmas?"),
        msg("m4", "in", "Confirmo"),
      ],
      [ZONA_CENTRO]
    );
    const cierreConTarifaNueva = {
      action: "notify_order",
      summary: "Total con domicilio a Centro: $5.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 500000,
      totalCents: 1500000,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierreConTarifaNueva, raw: "" });
    const resultado2 = await runAgentTurn(conv.id);
    expect(resultado2?.action).toBe("notify_order");
  });

  it("3 y 4: domicilio <-> recogida — la tarifa vieja nunca se arrastra en ninguna de las dos direcciones", async () => {
    const conv = conversacion("org_1", "cv_3");
    const prof = perfil("org_1");

    queueTurno(conv, prof, [msg("m1", "in", "cuanto a Kachipay?")], [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const reply1 = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply1, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    // El cliente cambia de opinión: pasa a recoger.
    queueTurno(conv, prof, [msg("m2", "in", "mejor paso yo por el pedido")], [ZONA_KACHIPAY]);
    const consultaRecogida = { action: "consultar_domicilio", zona: "recogida", recogida: true };
    const reply2 = { action: "reply", text: "Perfecto, lo dejamos en recogida." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaRecogida, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply2, raw: "" });
    await runAgentTurn(conv.id);
    expect(entregaStore.get("org_1:cv_3")).toMatchObject({ tipo: "recogida", feeCents: null });

    // 3: si el cierre intenta sumar la tarifa VIEJA de domicilio pese a
    // estar en recogida, se rechaza — nunca se suma sola.
    queueTurno(
      conv,
      prof,
      [msg("m2b", "out", "💰 Total: $22.000. ¿Confirmas?"), msg("m3", "in", "Confirmo")],
      [ZONA_KACHIPAY]
    );
    const cierreConDomicilioViejo = {
      action: "notify_order",
      summary: "Total con domicilio: $12.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 1200000,
      totalCents: 2200000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: cierreConDomicilioViejo, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: cierreConDomicilioViejo, raw: "" });
    const resultado = await runAgentTurn(conv.id);
    expect(resultado?.action).toBe("handoff");
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining("$12.000") })
    );

    // 4: el cliente vuelve a pedir domicilio — exige reverificación
    // estructurada, no basta con "ya lo habíamos dicho antes".
    queueTurno(conv, prof, [msg("m4", "in", "mejor sí, envíalo a Kachipay")], [ZONA_KACHIPAY]);
    const consultaOtraVez = { action: "consultar_domicilio", zona: "Kachipay" };
    const reply3 = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaOtraVez, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply3, raw: "" });
    await runAgentTurn(conv.id);
    expect(entregaStore.get("org_1:cv_3")).toMatchObject({ tipo: "domicilio", feeCents: 1200000 });
  });

  it("5: el modelo propone $8.000 pero el backend tiene $12.000 verificado — el $8.000 nunca llega al equipo", async () => {
    const conv = conversacion("org_1", "cv_5");
    const prof = perfil("org_1");

    queueTurno(conv, prof, [msg("m1", "in", "cuanto a Kachipay?")], [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const reply1 = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply1, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    queueTurno(
      conv,
      prof,
      [msg("m1b", "out", "💰 Total: $22.000. ¿Confirmas?"), msg("m2", "in", "Confirmo")],
      [ZONA_KACHIPAY]
    );
    const cierreEquivocado = {
      action: "notify_order",
      summary: "Total con domicilio: $8.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 800000,
      totalCents: 1800000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: cierreEquivocado, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: cierreEquivocado, raw: "" });

    const resultado = await runAgentTurn(conv.id);

    expect(resultado?.action).toBe("handoff");
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining("$8.000") })
    );
  });

  it("6: dos organizaciones nunca comparten zonas ni tarifas verificadas", async () => {
    const convA = conversacion("org_A", "cv_a");
    const profA = perfil("org_A");
    const convB = conversacion("org_B", "cv_b");
    const profB = perfil("org_B");
    const ZONA_A = { id: "dz_a", nombre: "Centro", feeCents: 500000 };
    const ZONA_B = { id: "dz_b", nombre: "Centro", feeCents: 900000 }; // mismo nombre, tarifa DISTINTA

    queueTurno(convA, profA, [msg("m1", "in", "cuanto a Centro?")], [ZONA_A]);
    const consultaA = { action: "consultar_domicilio", zona: "Centro" };
    const replyA = { action: "reply", text: "$5.000 a Centro." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaA, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: replyA, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(convA.id);

    queueTurno(convB, profB, [msg("m1", "in", "cuanto a Centro?")], [ZONA_B]);
    const consultaB = { action: "consultar_domicilio", zona: "Centro" };
    const replyB = { action: "reply", text: "$9.000 a Centro." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaB, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: replyB, raw: "" });
    await runAgentTurn(convB.id);

    expect(entregaStore.get("org_A:cv_a")).toMatchObject({ feeCents: 500000 });
    expect(entregaStore.get("org_B:cv_b")).toMatchObject({ feeCents: 900000 });

    // El cierre de A con la tarifa de B (900000) debe rechazarse: nunca ve
    // la verificación de otra organización.
    queueTurno(
      convA,
      profA,
      [msg("m1b", "out", "💰 Total: $19.000. ¿Confirmas?"), msg("m2", "in", "Confirmo")],
      [ZONA_A]
    );
    const cierreConTarifaAjena = {
      action: "notify_order",
      summary: "Total con domicilio: $9.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 900000,
      totalCents: 1900000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: cierreConTarifaAjena, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: cierreConTarifaAjena, raw: "" });
    const resultado = await runAgentTurn(convA.id);
    expect(resultado?.action).toBe("handoff");
  });

  it("7: si dos escrituras compiten por la misma verificación, una carrera perdida no corrompe el estado ni tumba el turno", async () => {
    const conv = conversacion("org_1", "cv_7");
    const prof = perfil("org_1");

    /**
     * La atomicidad REAL del CAS (dos escrituras concurrentes, una gana)
     * ya está probada contra el mock de Postgres en `estado-entrega.test.ts`
     * ("carrera perdida... devuelve {ok:false} y NO lanza"). Lo que se
     * prueba AQUÍ es la integración con `pipeline.ts` — mismo riesgo real
     * que documenta `rescatarHuerfanos` (cola.ts): si la escritura de ESTE
     * turno pierde la carrera porque otro worker ya escribió una
     * verificación más nueva para la misma conversación, el turno no debe
     * caerse NI pisar esa verificación más nueva con la suya, más vieja.
     */
    entregaStore.set("org_1:cv_7", {
      tipo: "domicilio",
      zonaId: "dz_2",
      zonaNombre: "Centro",
      feeCents: 500000,
      verificadoEnMensajeId: "otro_worker",
      verificadoEn: new Date().toISOString(),
    });
    const estadoMod = await import("@/server/orders/estado");
    vi.spyOn(estadoMod, "guardarEntregaVerificada").mockResolvedValueOnce({ ok: false });

    queueTurno(conv, prof, [msg("mA", "in", "cuanto a Kachipay?")], [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const reply = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const r1 = await runAgentTurn(conv.id);

    // El turno no se cae pese a perder la carrera de escritura.
    expect(r1?.action).toBe("reply");

    // El estado NO se pisó: sigue siendo el del worker que sí ganó la
    // carrera (Centro, $5.000) — nunca queda en un valor a medias ni en
    // el de la escritura que perdió (Kachipay, $12.000).
    const final = entregaStore.get("org_1:cv_7");
    expect(final).toMatchObject({ tipo: "domicilio", zonaNombre: "Centro", feeCents: 500000 });

    // Un cierre posterior que use la tarifa que SÍ quedó persistida
    // (la del worker que ganó) se acepta con normalidad — el estado es
    // consistente y legible, no basura.
    chatJson.mockReset();
    queueTurno(
      conv,
      prof,
      [msg("mCa", "out", "💰 Total: $15.000. ¿Confirmas?"), msg("mC", "in", "Confirmo")],
      [ZONA_CENTRO]
    );
    const cierre = {
      action: "notify_order",
      summary: "Total con domicilio: $5.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 500000,
      totalCents: 1500000,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });
    const resultadoCierre = await runAgentTurn(conv.id);
    expect(resultadoCierre?.action).toBe("notify_order");
  });

  it("8: pedido confirmado -> un pedido NUEVO en la misma conversación no hereda la tarifa vieja sin revalidar", async () => {
    const conv = conversacion("org_1", "cv_8");
    const prof = perfil("org_1");

    queueTurno(conv, prof, [msg("m1", "in", "cuanto a Kachipay?")], [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const reply1 = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply1, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);

    queueTurno(
      conv,
      prof,
      [msg("m1b", "out", "💰 Total: $22.000. ¿Confirmas?"), msg("m2", "in", "Confirmo")],
      [ZONA_KACHIPAY]
    );
    const cierre1 = {
      action: "notify_order",
      summary: "Pedido 1 — total con domicilio: $12.000",
      subtotalCents: 1000000,
      deliveryFeeCents: 1200000,
      totalCents: 2200000,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre1, raw: "" });
    const resultado1 = await runAgentTurn(conv.id);
    expect(resultado1?.action).toBe("notify_order");
    // El pedido cerró: la verificación que lo respaldaba deja de ser válida.
    expect(entregaStore.get("org_1:cv_8")).toBeNull();

    // Un pedido nuevo, en la MISMA conversación (el cliente vuelve horas
    // después), que intente cerrar con la tarifa vieja SIN reverificar,
    // se rechaza — nunca se asume que la verificación de un pedido
    // anterior sigue sirviendo para uno distinto.
    queueTurno(
      conv,
      prof,
      [
        msg("m2b", "out", "💰 Total: $17.000. ¿Confirmas?"),
        msg("m3", "in", "Quiero otro pedido, a Kachipay también, confirmo"),
      ],
      [ZONA_KACHIPAY]
    );
    const cierre2 = {
      action: "notify_order",
      summary: "Pedido 2 — total con domicilio: $12.000",
      subtotalCents: 500000,
      deliveryFeeCents: 1200000,
      totalCents: 1700000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: cierre2, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: cierre2, raw: "" });
    const resultado2 = await runAgentTurn(conv.id);
    expect(resultado2?.action).toBe("handoff");
  });

  it("9: compatibilidad — delivery_source='prompt' sigue exactamente igual, sin ninguna verificación estructurada", async () => {
    const conv = conversacion("org_9", "cv_9");
    const prof = perfil("org_9", { deliverySource: "prompt" });

    queueTurno(
      conv,
      prof,
      [
        msg("m0", "out", "💰 Total: $10.000 (con domicilio). ¿Confirmas?"),
        msg("m1", "in", "Confirmo mi pedido con domicilio"),
      ],
      []
    );
    const cierre = {
      action: "notify_order",
      summary: "Total con domicilio: $10.000 (a mano, sin tabla de zonas)",
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierre, raw: "" });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const resultado = await runAgentTurn(conv.id);

    // Sin delivery_source='tabla', ni siquiera se toca `entregaStore`.
    expect(resultado?.action).toBe("notify_order");
    expect(entregaStore.has("org_9:cv_9")).toBe(false);
  });

  it("10: preguntar la tarifa por curiosidad, sin pedir nunca domicilio, no contamina un pedido de recogida posterior", async () => {
    const conv = conversacion("org_1", "cv_10");
    const prof = perfil("org_1");

    // Pregunta puramente informativa: nunca llega a pedir nada.
    queueTurno(conv, prof, [msg("m1", "in", "oye, solo por curiosidad, cuanto cobran a Kachipay?")], [
      ZONA_KACHIPAY,
    ]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const reply1 = { action: "reply", text: "$12.000 a Kachipay." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: "" })
      .mockResolvedValueOnce({ ok: true, data: reply1, raw: "" });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn(conv.id);
    expect(entregaStore.get("org_1:cv_10")).toMatchObject({ feeCents: 1200000 });

    // Mucho después, un pedido real de RECOGIDA — sin mencionar domicilio
    // para nada, `deliveryFeeCents` ausente tal como pide el contrato.
    queueTurno(
      conv,
      prof,
      [
        msg("m1b", "out", "💰 Total: $18.000. ¿Confirmas?"),
        msg("m2", "in", "Confirmo, paso a recoger 1 Pavé Cremoso"),
      ],
      [ZONA_KACHIPAY]
    );
    const cierrePickup = {
      action: "notify_order",
      summary: "1 Pavé Cremoso — $18.000. Recoge en el local.",
      subtotalCents: 1800000,
      totalCents: 1800000,
    };
    chatJson.mockResolvedValueOnce({ ok: true, data: cierrePickup, raw: "" });

    const resultado = await runAgentTurn(conv.id);

    // La zona verificada por curiosidad NUNCA debe forzar "domicilio no
    // verificado" sobre un pedido que jamás lo pidió.
    expect(resultado?.action).toBe("notify_order");
    expect(notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.not.stringContaining("12.000") })
    );
  });
});
