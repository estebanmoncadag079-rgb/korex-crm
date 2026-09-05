import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10N-A — idempotencia real (Postgres) de `notify_order`.
 *
 * El mock simula el comportamiento de un `UNIQUE(conversation_id,
 * idempotency_key)` real: la primera vez que una clave se inserta, la
 * fila "existe" (Set); un segundo intento con la MISMA clave se comporta
 * como `onConflictDoNothing()` en Postgres — no inserta nada, `.returning()`
 * llega vacío. Esto prueba la LÓGICA del mecanismo con la semántica exacta
 * del constraint; la prueba de concurrencia REAL contra Postgres (dos
 * transacciones a la vez, de verdad) vive en
 * `tests/integration/notify-order-idempotency.test.ts` y se salta sola si
 * no hay `TEST_DATABASE_URL` configurada — en este entorno no lo está, así
 * que esa parte transaccional real queda pendiente de ejecución, no se
 * afirma que corrió.
 *
 * Fase 10N-D (revisión pre-commit) — la clave se arma con los IDs de los
 * mensajes del cliente que disparan el cierre, NO con el `summary` libre
 * del modelo: ver el comentario de cabecera en
 * `src/server/ai/confirmacion-de-pedido.ts` (el texto libre no es estable
 * entre dos ejecuciones paralelas del mismo turno bajo la ventana de
 * carrera de `rescatarHuerfanos`; los IDs de fila sí lo son).
 */

const filasExistentes = new Map<string, { id: string }>();

/**
 * Fase 11-B — `registrarConfirmacionDePedido` ahora hace un `select()` de
 * respaldo cuando el `INSERT` choca (para devolver el `id` de la fila que
 * ya existía, necesario para el rastreo del aviso): el mock necesita
 * soportar ese segundo camino, no solo el `insert`.
 */
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const clave = `${values.conversationId}::${values.idempotencyKey}`;
            if (filasExistentes.has(clave)) return Promise.resolve([]);
            filasExistentes.set(clave, { id: values.id as string });
            return Promise.resolve([values]);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            // El mock no modela el `WHERE` real: siempre queda UNA fila por
            // conversación en `filasExistentes` en las pruebas de este
            // archivo, así que devolver la última basta.
            const ultima = [...filasExistentes.values()].at(-1);
            return Promise.resolve(ultima ? [ultima] : []);
          },
        }),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

beforeEach(() => {
  filasExistentes.clear();
});

describe("claveDeConfirmacionDePedido", () => {
  it("A: mismos IDs, distinto orden de llegada → misma clave (se ordenan antes de unir)", async () => {
    const { claveDeConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const a = claveDeConfirmacionDePedido(["msg_2", "msg_1"]);
    const b = claveDeConfirmacionDePedido(["msg_1", "msg_2"]);
    expect(a).toBe(b);
  });

  it("B: conjunto de mensajes distinto → clave distinta", async () => {
    const { claveDeConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    expect(claveDeConfirmacionDePedido(["msg_1"])).not.toBe(claveDeConfirmacionDePedido(["msg_2"]));
  });
});

describe("registrarConfirmacionDePedido: idempotencia vía UNIQUE(conversation_id, idempotency_key)", () => {
  it("1: confirmación normal → primera vez, se registra", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const r = await registrarConfirmacionDePedido({
      organizationId: "org_1",
      conversationId: "cv_1",
      messageIds: ["msg_1"],
    });
    expect(r.primeraVez).toBe(true);
  });

  it("2: doble llamada idéntica (mismos mensajes disparadores, misma conversación) → solo la primera cuenta", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const input = { organizationId: "org_1", conversationId: "cv_1", messageIds: ["msg_1"] };
    const primero = await registrarConfirmacionDePedido(input);
    const segundo = await registrarConfirmacionDePedido(input);
    expect(primero.primeraVez).toBe(true);
    expect(segundo.primeraVez).toBe(false);
  });

  it("3: retry tras timeout — a nivel de este mecanismo es exactamente una segunda llamada con los mismos mensajes disparadores, misma protección", async () => {
    // La clave es QUÉ mensaje del cliente dispara el cierre, no el motivo de
    // la repetición: un retry, un doble click o un segundo turno que decide
    // confirmar otra vez el MISMO pedido son indistinguibles a propósito.
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const input = { organizationId: "org_1", conversationId: "cv_1", messageIds: ["msg_1"] };
    await registrarConfirmacionDePedido(input);
    const retry = await registrarConfirmacionDePedido(input);
    expect(retry.primeraVez).toBe(false);
  });

  it("4: 'evento duplicado' — si algo más arriba llamara dos veces (no hay hoy ningún camino real que lo haga, ver la investigación de infraestructura), el UNIQUE igual protege", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const input = { organizationId: "org_1", conversationId: "cv_1", messageIds: ["msg_2"] };
    const [a, b] = await Promise.all([
      registrarConfirmacionDePedido(input),
      registrarConfirmacionDePedido(input),
    ]);
    // Simulado sobre un Set (JS de un solo hilo, no hay carrera real aquí) —
    // ver la nota de cabecera sobre qué prueba esto y qué no.
    expect([a.primeraVez, b.primeraVez].filter(Boolean)).toHaveLength(1);
  });

  it("5: dos 'solicitudes concurrentes' disparadas por LOS MISMOS mensajes → exactamente una gana (misma simulación que el caso 4). Este es exactamente el escenario real de rescatarHuerfanos: dos ejecuciones paralelas leen el MISMO pendiente de la base.", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const input = { organizationId: "org_1", conversationId: "cv_2", messageIds: ["msg_3"] };
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => registrarConfirmacionDePedido(input))
    );
    expect(resultados.filter((r) => r.primeraVez)).toHaveLength(1);
  });

  it("5b: dos ejecuciones paralelas cuyo modelo generó RESÚMENES DE TEXTO DISTINTOS para el mismo pedido siguen protegidas, porque la clave nunca depende del texto del modelo", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    // Mismo mensaje disparador ("msg_4"), pero conceptualmente cada llamada
    // representa una ejecución con un summary distinto del modelo — la
    // función ya no recibe el summary, solo los IDs, así que es imposible
    // que dos redacciones distintas produzcan claves distintas.
    const input = { organizationId: "org_1", conversationId: "cv_carrera", messageIds: ["msg_4"] };
    const [a, b] = await Promise.all([
      registrarConfirmacionDePedido(input),
      registrarConfirmacionDePedido(input),
    ]);
    expect([a.primeraVez, b.primeraVez].filter(Boolean)).toHaveLength(1);
  });

  it("6: pedido ya confirmado → una tercera, cuarta, etc. llamada NUNCA vuelve a confirmar", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const input = { organizationId: "org_1", conversationId: "cv_1", messageIds: ["msg_1"] };
    await registrarConfirmacionDePedido(input);
    for (let i = 0; i < 5; i++) {
      const r = await registrarConfirmacionDePedido(input);
      expect(r.primeraVez).toBe(false);
    }
  });

  it("7: error intermedio — un intento que se registra pero cuyo aviso posterior falla no vuelve a mandar el aviso en el reintento (por diseño: el registro ES la fuente de verdad, ver pipeline.ts)", async () => {
    // Este test documenta la decisión de diseño, no ejecuta notifyTeam: la
    // función registra ANTES de que el llamante intente avisar — eso se
    // prueba en `pipeline-confirmo-sin-cierre.test.ts` (el wiring real) y en
    // el propio código de `pipeline.ts` (comentario "Orden deliberado").
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const input = { organizationId: "org_1", conversationId: "cv_3", messageIds: ["msg_5"] };
    const primero = await registrarConfirmacionDePedido(input);
    expect(primero.primeraVez).toBe(true);
    // Un "retry tras el fallo del aviso" es, para este mecanismo, la MISMA
    // llamada otra vez — y ya no vuelve a contar como primera vez.
    const retryTrasFallo = await registrarConfirmacionDePedido(input);
    expect(retryTrasFallo.primeraVez).toBe(false);
  });

  it("8: dos confirmaciones DISTINTAS en la MISMA conversación (mensajes disparadores distintos) → independientes", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    const pedidoA = await registrarConfirmacionDePedido({
      organizationId: "org_1",
      conversationId: "cv_1",
      messageIds: ["msg_1"],
    });
    const pedidoB = await registrarConfirmacionDePedido({
      organizationId: "org_1",
      conversationId: "cv_1",
      messageIds: ["msg_6"],
    });
    expect(pedidoA.primeraVez).toBe(true);
    expect(pedidoB.primeraVez).toBe(true);
  });

  it("9: mismo mensaje disparador en distintas conversaciones (incluso de distintos tenants) → completamente aislados, ninguno bloquea al otro", async () => {
    const { registrarConfirmacionDePedido } = await import("@/server/ai/confirmacion-de-pedido");
    // Los IDs de mensaje son globalmente únicos en la base real (no se
    // repiten entre conversaciones); este caso prueba que aunque
    // coincidieran, el UNIQUE incluye conversation_id — el aislamiento no
    // depende solo de que los IDs no se repitan.
    const mismoId = ["msg_compartido"];
    const conv1 = await registrarConfirmacionDePedido({
      organizationId: "org_1",
      conversationId: "cv_org1",
      messageIds: mismoId,
    });
    const conv2 = await registrarConfirmacionDePedido({
      organizationId: "org_2",
      conversationId: "cv_org2",
      messageIds: mismoId,
    });
    expect(conv1.primeraVez).toBe(true);
    expect(conv2.primeraVez).toBe(true);
  });
});
