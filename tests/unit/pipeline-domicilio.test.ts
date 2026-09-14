import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10N-J — reproduce el incidente real de Kachipay contra el pipeline
 * completo: al cliente le dijeron "$12.000" de domicilio, y el resumen del
 * MISMO pedido cerró con "$8.000" y un total que no cuadraba. Prueba que
 * ahora es estructuralmente imposible que eso pase inadvertido: el modelo
 * DEBE verificar la tarifa con `consultar_domicilio`, y si el cierre
 * (`notify_order`, campos estructurados O el `summary` en prosa) contradice
 * lo verificado, el turno se rehace o se deriva a una persona — nunca sale
 * tal cual hacia el equipo.
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
          /**
           * Fase 10V-X — `guardarEntregaVerificada` (llamada por
           * `consultar_domicilio` en el pipeline) pasa por `guardarEstado`,
           * que usa `onConflictDoUpdate`. No se simula ninguna carrera
           * perdida aquí: siempre "gana" la escritura, que es lo que este
           * archivo necesita para probar el mecanismo de verificación en sí,
           * no la concurrencia (esa vive en `estado-entrega.test.ts`).
           */
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

const CONVERSATION = {
  id: "cv_pedidos",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};

/** Negocio de pedidos con delivery_source='tabla' — la bandera que enciende todo este mecanismo. */
const PROFILE = {
  id: "agp_1",
  organizationId: "org_1",
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
};

/** El resumen ya mostrado en un turno anterior — pasa el guardarraíl "notify_order sin resumen previo" (TIENE_TOTAL). */
const RESUMEN_PREVIO = [
  { id: "m1", direction: "in", text: "quiero un pavé para Kachipay, cuanto es el domicilio?", createdAt: new Date() },
  {
    id: "m2",
    direction: "out",
    text: "1 Pavé Cremoso — $18.000. 💰 *Total: $30.000* (con domicilio). ¿Confirmas?",
    createdAt: new Date(),
  },
  { id: "m3", direction: "in", text: "Confirmo", createdAt: new Date() },
];

/**
 * `runAgentTurn` pide el historial `orderBy(desc(createdAt))` y lo revierte
 * en el sitio — ver el mismo comentario en `pipeline-confirmo-sin-cierre.test.ts`.
 * Se escribe aquí en orden cronológico y se invierte antes de entregarlo.
 */
function queueTurno(history: Array<Record<string, unknown>>, zonas: unknown[]) {
  const copia = history.map((m) => ({ ...m })).reverse();
  selectQueue.push([CONVERSATION], [PROFILE], copia, [], [], []);
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
});

describe("consultar_domicilio: resuelve la tarifa real contra delivery_zone", () => {
  it("A: pregunta por Kachipay -> el sistema verifica $12.000 y el reply del modelo lo usa correctamente", async () => {
    queueTurno(
      [
        { id: "m1", direction: "in", text: "cuanto es el domicilio a Kachipay?", createdAt: new Date() },
      ],
      [ZONA_KACHIPAY]
    );
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const respuesta = { action: "reply", text: "El domicilio a Kachipay es $12.000." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValueOnce({ ok: true, data: respuesta, raw: JSON.stringify(respuesta) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(respuesta);
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("F: zona desconocida -> el sistema NO inventa una tarifa, el modelo debe preguntar/derivar", async () => {
    queueTurno(
      [{ id: "m1", direction: "in", text: "cuanto es el domicilio a Marte?", createdAt: new Date() }],
      [ZONA_KACHIPAY]
    );
    const consulta = { action: "consultar_domicilio", zona: "Marte" };
    const respuesta = { action: "reply", text: "Voy a confirmar el valor del domicilio a esa zona, dame un momento." };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValueOnce({ ok: true, data: respuesta, raw: JSON.stringify(respuesta) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_pedidos");

    // El mensaje inyectado al modelo debe decir explícitamente que no invente.
    const infoInyectada = chatJson.mock.calls[0]![1] as Array<{ content: string }>;
    expect(String(infoInyectada.at(-1)?.content ?? "")).toMatch(/no inventes/i);
  });
});

describe("notify_order: el pedido usa EXACTAMENTE la tarifa verificada — el incidente de Kachipay ya no puede pasar", () => {
  it("reproduce el incidente EXACTO ($12.000 dicho, $8.000 en el cierre) — el guardarraíl lo detecta y rehace el turno con el número correcto", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const cierreMalo = {
      action: "notify_order",
      summary: "1 Pavé — $18.000. Domicilio: $8.000. Total: $26.000",
      farewell: "¡Listo!",
      subtotalCents: 1800000,
      deliveryFeeCents: 800000, // el número equivocado real del incidente
      totalCents: 2600000,
    };
    const cierreBueno = {
      action: "notify_order",
      summary: "1 Pavé — $18.000. Domicilio: $12.000. Total: $30.000",
      farewell: "¡Listo!",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValueOnce({ ok: true, data: cierreMalo, raw: JSON.stringify(cierreMalo) })
      .mockResolvedValueOnce({ ok: true, data: cierreBueno, raw: JSON.stringify(cierreBueno) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(cierreBueno);
    // El equipo NUNCA recibió el resumen con el número equivocado.
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: cierreMalo.summary })
    );
    expect(notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ summary: cierreBueno.summary })
    );
  });

  it("si insiste con el número equivocado, deriva a una persona — NUNCA sale hacia el equipo", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const cierreMalo = {
      action: "notify_order",
      summary: "Domicilio: $8.000. Total: $26.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 800000,
      totalCents: 2600000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValue({ ok: true, data: cierreMalo, raw: JSON.stringify(cierreMalo) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action?.action).toBe("handoff");
    expect(notifyTeam).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: cierreMalo.summary })
    );
  });

  it("13: la invariante total=subtotal+domicilio también se exige aunque deliveryFeeCents esté bien", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const totalMalo = {
      action: "notify_order",
      summary: "Domicilio: $12.000. Total: $26.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000, // correcto
      totalCents: 2600000, // NO es 1.800.000 + 1.200.000
    };
    const totalBueno = {
      ...totalMalo,
      summary: "Domicilio: $12.000. Total: $30.000",
      totalCents: 3000000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValueOnce({ ok: true, data: totalMalo, raw: JSON.stringify(totalMalo) })
      .mockResolvedValueOnce({ ok: true, data: totalBueno, raw: JSON.stringify(totalBueno) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(totalBueno);
  });

  it("D: cambia de zona A a zona B EN EL MISMO TURNO — el cierre usa la última zona verificada, nunca la primera", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY, ZONA_CENTRO]);
    const consultaKachipay = { action: "consultar_domicilio", zona: "Kachipay" };
    const consultaCentro = { action: "consultar_domicilio", zona: "Centro" }; // el cliente cambió de dirección
    const cierre = {
      action: "notify_order",
      summary: "Domicilio a Centro: $5.000. Total: $23.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 500000,
      totalCents: 2300000,
    };
    chatJson
      .mockResolvedValueOnce({ ok: true, data: consultaKachipay, raw: JSON.stringify(consultaKachipay) })
      .mockResolvedValueOnce({ ok: true, data: consultaCentro, raw: JSON.stringify(consultaCentro) })
      .mockResolvedValueOnce({ ok: true, data: cierre, raw: JSON.stringify(cierre) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(cierre);
    expect(chatJson).toHaveBeenCalledTimes(3);
  });

  it("domicilio no-verificado en este turno (aunque se haya verificado en un turno anterior de la conversación) -> se exige reverificar, nunca se confía en la memoria del modelo", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    // El modelo va DIRECTO a notify_order, sin llamar consultar_domicilio en
    // este turno — aunque el número sea, por casualidad, el correcto.
    const cierreSinVerificar = {
      action: "notify_order",
      summary: "Domicilio: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
    };
    chatJson.mockResolvedValue({ ok: true, data: cierreSinVerificar, raw: JSON.stringify(cierreSinVerificar) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    // Sin resultadoZona de este turno, el guardarraíl lo rechaza igual — y
    // como insiste (mockResolvedValue, no Once), termina derivado.
    expect(action?.action).toBe("handoff");
  });

  it("G: pedido SIN domicilio (recogida en el local) — deliveryFeeCents null, total=subtotal, sin fricción", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    const cierre = {
      action: "notify_order",
      summary: "1 Pavé — $18.000. Recoges en el local. Total: $18.000",
      subtotalCents: 1800000,
      deliveryFeeCents: null,
      totalCents: 1800000,
    };
    chatJson.mockResolvedValue({ ok: true, data: cierre, raw: JSON.stringify(cierre) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(cierre);
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  /**
   * MALIA, 14-sep-2026, 11:06. Una clienta escribió "Para pedirte uno y paso
   * a recogerlo". El modelo registró la recogida, el backend le respondió
   * "Registrado: este pedido es de recogida", y el modelo la volvió a
   * registrar. Y otra vez. Agotó las dos consultas del turno y el pipeline
   * derivó sin más: cuatro minutos y medio de espera para leer "te comunico
   * con una persona", cuando no faltaba ningún dato para seguir.
   *
   * Dos cosas cambiaron: repetir una consulta ya no devuelve el mismo eco
   * (que ya se había ignorado una vez), y agotar el presupuesto ya no
   * significa abandonar sin intentar — como en todos los demás guardarraíles.
   */
  it("el modelo repite la misma consulta hasta agotar el turno: se le corrige y CONTESTA, no se deriva", async () => {
    queueTurno(
      [{ id: "m1", direction: "in", text: "Para pedirte uno y paso a recogerlo", createdAt: new Date() }],
      [ZONA_KACHIPAY]
    );
    const recogida = { action: "consultar_domicilio", zona: "recogida", recogida: true };
    const respuesta = {
      action: "reply",
      text: "¡Listo! Lo dejamos para recoger en el local 🏠 ¿Qué sabor quieres?",
    };
    chatJson
      // pide recogida…
      .mockResolvedValueOnce({ ok: true, data: recogida, raw: JSON.stringify(recogida) })
      // …y la vuelve a pedir (aquí recibe la corrección, no el mismo dato)
      .mockResolvedValueOnce({ ok: true, data: recogida, raw: JSON.stringify(recogida) })
      // …e insiste una tercera vez: se agotan las consultas del turno
      .mockResolvedValueOnce({ ok: true, data: recogida, raw: JSON.stringify(recogida) })
      // el rescate: con la corrección final sí contesta al cliente
      .mockResolvedValueOnce({ ok: true, data: respuesta, raw: JSON.stringify(respuesta) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(respuesta);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("si ni con la corrección sale del bucle, ahí sí lo toma una persona", async () => {
    queueTurno(
      [{ id: "m1", direction: "in", text: "paso a recogerlo", createdAt: new Date() }],
      [ZONA_KACHIPAY]
    );
    const recogida = { action: "consultar_domicilio", zona: "recogida", recogida: true };
    // Insiste siempre, incluso tras la corrección final.
    chatJson.mockResolvedValue({ ok: true, data: recogida, raw: JSON.stringify(recogida) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual({ action: "handoff", reason: "error" });
  });

  /**
   * MALIA, 14-sep-2026: 4 de las 8 derivaciones de tres horas fueron esto —
   * el modelo cerrando un pedido con una tarifa de domicilio que nunca
   * consultó. El testigo es el pedido de $48.000 de Brenda (12-sep): la zona
   * "Versalles" estaba en la tabla a $8.000, exactamente lo que el bot cobró,
   * pero nadie la había verificado.
   *
   * El guardarraíl hacía bien en bloquear. Lo que estaba mal era la salida:
   * la corrección le pedía "usa la cifra verificada" cuando no existía
   * ninguna, y si el modelo hacía lo correcto —consultar— el pipeline lo
   * trataba como un cierre fallido y derivaba igual.
   */
  it("cierra cobrando un domicilio que nunca verificó: se le pide consultar, consulta, y el pedido se cierra con la tarifa real", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    const cierreSinVerificar = {
      action: "notify_order",
      summary: "1 Pavé — $18.000. Domicilio: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
    };
    // Lo que le pedimos que haga, y que antes castigábamos:
    const consulta = { action: "consultar_domicilio", zona: "Kachipay" };
    const cierreBueno = { ...cierreSinVerificar };
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: cierreSinVerificar,
        raw: JSON.stringify(cierreSinVerificar),
      })
      .mockResolvedValueOnce({ ok: true, data: consulta, raw: JSON.stringify(consulta) })
      .mockResolvedValueOnce({ ok: true, data: cierreBueno, raw: JSON.stringify(cierreBueno) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    // El pedido se cierra — antes esto terminaba en handoff.
    expect(action).toEqual(cierreBueno);
    expect(notifyTeam).toHaveBeenCalled();
    // Y la zona quedó verificada de verdad contra la tabla.
    expect(zonasDeEntregaQuery).toHaveBeenCalled();
  });

  it("si tras pedirle que verifique sigue sin hacerlo, el candado NO se abre", async () => {
    queueTurno(RESUMEN_PREVIO, [ZONA_KACHIPAY]);
    const cierreSinVerificar = {
      action: "notify_order",
      summary: "1 Pavé — $18.000. Domicilio: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
    };
    // Insiste en cerrar sin consultar nada.
    chatJson.mockResolvedValue({
      ok: true,
      data: cierreSinVerificar,
      raw: JSON.stringify(cierreSinVerificar),
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    // El pedido NO se registra: la acción final es handoff, no notify_order.
    // (`notifyTeam` sí se llama, pero para avisar al equipo de la derivación.)
    expect(action).toEqual({ action: "handoff", reason: "error" });
  });

  it("negocio con delivery_source='prompt' (comportamiento de siempre) — notify_order sin campos estructurados pasa exactamente igual que antes", async () => {
    const profileViejo = { ...PROFILE, deliverySource: "prompt" };
    selectQueue.push([CONVERSATION], [profileViejo], [...RESUMEN_PREVIO].reverse(), [], [], []);
    const cierre = {
      action: "notify_order",
      summary: "1 Pavé — $18.000. Domicilio: $12.000. Total: $30.000",
      farewell: "¡Listo!",
    };
    chatJson.mockResolvedValue({ ok: true, data: cierre, raw: JSON.stringify(cierre) });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_pedidos");

    expect(action).toEqual(cierre);
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(zonasDeEntregaQuery).not.toHaveBeenCalled();
  });
});
