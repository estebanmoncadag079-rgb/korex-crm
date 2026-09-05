import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 11-B — entrega confiable de la notificación de pedido.
 *
 * Separa "el pedido quedó registrado" (siempre cierto desde el `INSERT`,
 * ya probado en `confirmacion-de-pedido.test.ts`) de "el aviso al equipo
 * se entregó de verdad" (`orderConfirmation.notifyStatus`, probado aquí):
 * `intentarNotificarPedido` es el intento real (usado tanto la primera vez
 * como en cada reintento), y `reintentarNotificacionesPendientes` es el
 * barrido periódico que encuentra lo que quedó pendiente/fallido/huérfano.
 */

const notifyTeam = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
}));

/**
 * `eq(schema.orderConfirmation.id, id)` y `sql\`...\`` reales construyen
 * objetos opacos de Drizzle — se reemplazan por marcadores inspeccionables
 * (todo lo demás real, vía `importOriginal`) para que el mock de
 * `db.update/execute` de abajo pueda distinguir QUÉ consulta es (el claim
 * atómico de una fila vs. la lectura de candidatos, ahora dos formas
 * distintas de `db.execute`) sin reimplementar Drizzle ni Postgres.
 */
vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...real,
    eq: (col: unknown, val: unknown) => ({ __eqCol: col, __eqVal: val }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        __sqlText: strings.join("?"),
        __sqlValues: values,
      }),
      real.sql
    ),
  };
});

/** Una fila en memoria por id — suficiente para probar las transiciones sin un Postgres real. */
type Fila = {
  id: string;
  organizationId: string;
  summary: string | null;
  customerPhone: string | null;
  notifyStatus: string;
  notifyAttempts: number;
  isTest: boolean;
  updatedAt: number; // epoch ms, para simular "huérfano hace tiempo"
};
const filas = new Map<string, Fila>();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: (condicion: { __eqVal?: string }) => {
          const objetivo = condicion?.__eqVal;
          const fila = objetivo ? filas.get(objetivo) : undefined;
          if (fila) Object.assign(fila, valores, { updatedAt: Date.now() });
          return Promise.resolve();
        },
      }),
    }),
    /**
     * Dos formas DISTINTAS de `db.execute(sql\`...\`)` pasan por aquí ahora
     * (Fase urgente, 4-sep-2026 — antes había una sola, el claim en
     * bloque): `reclamarNotificacion` (un `UPDATE` atómico de UNA fila por
     * `id`) y `reintentarNotificacionesPendientes` (un `SELECT` de solo
     * lectura, sin tocar nada). Se distinguen por el texto de la consulta
     * — igual que Postgres las trataría de forma distinta.
     */
    execute: (query: { __sqlText: string; __sqlValues: unknown[] }) => {
      const texto = query.__sqlText.trim();
      const esElegible = (f: Fila, ahora: number) => {
        if (f.isTest) return false;
        if (f.notifyAttempts >= 5) return false;
        if (f.notifyStatus === "pendiente" || f.notifyStatus === "fallo_recuperable") return true;
        if (f.notifyStatus === "enviando" && ahora - f.updatedAt > 5 * 60_000) return true;
        return false;
      };

      if (texto.startsWith("UPDATE")) {
        // reclamarNotificacion: UPDATE ... WHERE id = ${id} AND (...) RETURNING id
        const id = query.__sqlValues[0] as string;
        const f = filas.get(id);
        const ahora = Date.now();
        if (!f || !esElegible(f, ahora)) return Promise.resolve([]);
        f.notifyStatus = "enviando";
        f.notifyAttempts += 1;
        f.updatedAt = ahora;
        return Promise.resolve([{ id: f.id }]);
      }

      // reintentarNotificacionesPendientes: SELECT de solo lectura, nunca
      // muta nada — el claim real ocurre después, uno por uno.
      const ahora = Date.now();
      const candidatos = [...filas.values()].filter((f) => esElegible(f, ahora));
      return Promise.resolve(
        candidatos.map((f) => ({
          id: f.id,
          organization_id: f.organizationId,
          summary: f.summary,
          customer_phone: f.customerPhone,
        }))
      );
    },
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

function fila(overrides: Partial<Fila> = {}): Fila {
  const base: Fila = {
    id: "oc_1",
    organizationId: "org_1",
    summary: "1 Pavé Cremoso — $18.000",
    customerPhone: "573001112222",
    notifyStatus: "pendiente",
    notifyAttempts: 0,
    isTest: false,
    updatedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  notifyTeam.mockReset();
  filas.clear();
});

describe("intentarNotificarPedido: el intento real, con la máquina de estados", () => {
  it("1: envío exitoso -> notifyStatus='enviado', notifiedAt no es necesario probarlo aquí (basta el estado)", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "enviado a 1 número(s)" });

    const { intentarNotificarPedido } = await import("@/server/ai/confirmacion-de-pedido");
    const r = await intentarNotificarPedido({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(r.sent).toBe(1);
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("2: 0 envíos exitosos (sent=0) -> notifyStatus='fallo_recuperable', NUNCA 'enviado'", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 0, failed: 2, detail: "fallaron los 2" });

    const { intentarNotificarPedido } = await import("@/server/ai/confirmacion-de-pedido");
    await intentarNotificarPedido({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(filas.get(f.id)!.notifyStatus).toBe("fallo_recuperable");
  });

  it("3: éxito parcial (algunos números fallan, otros no) -> se cuenta como ENVIADO (sent>0 es la evidencia real de aceptación)", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 1, detail: "enviado a 1 de 2" });

    const { intentarNotificarPedido } = await import("@/server/ai/confirmacion-de-pedido");
    await intentarNotificarPedido({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("4: excepción durante el envío -> notifyStatus='fallo_recuperable', NUNCA se queda trabado en 'enviando', y NO lanza", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockRejectedValue(new Error("timeout de red"));

    const { intentarNotificarPedido } = await import("@/server/ai/confirmacion-de-pedido");
    const r = await intentarNotificarPedido({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(r.sent).toBe(0);
    expect(filas.get(f.id)!.notifyStatus).toBe("fallo_recuperable");
  });

  it("8 y 9: nunca marca 'entregado' solo porque se LLAMÓ a la función — sin evidencia real (sent=0), queda recuperable, no enviado", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 0, failed: 0, detail: "sin números de aviso configurados" });

    const { intentarNotificarPedido } = await import("@/server/ai/confirmacion-de-pedido");
    await intentarNotificarPedido({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(filas.get(f.id)!.notifyStatus).not.toBe("enviado");
  });
});

describe("reintentarNotificacionesPendientes: el barrido periódico (worker.ts)", () => {
  it("5 y 10: una notificación fallida se reintenta con EL MISMO contenido, y esta vez se entrega -> el pedido no pierde su aviso", async () => {
    const f = fila({ notifyStatus: "fallo_recuperable", notifyAttempts: 1 });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "enviado a 1 número(s)" });

    const { reintentarNotificacionesPendientes } = await import("@/server/ai/confirmacion-de-pedido");
    const n = await reintentarNotificacionesPendientes();

    expect(n).toBe(1);
    expect(notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ summary: f.summary, customerPhone: f.customerPhone })
    );
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("6: crash entre persistencia e intento (fila trabada en 'enviando' hace más de 5 min) -> el barrido la reclama y reintenta", async () => {
    const f = fila({
      notifyStatus: "enviando",
      notifyAttempts: 1,
      updatedAt: Date.now() - 10 * 60_000, // 10 min: más viejo que el margen de huérfano
    });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { reintentarNotificacionesPendientes } = await import("@/server/ai/confirmacion-de-pedido");
    const n = await reintentarNotificacionesPendientes();

    expect(n).toBe(1);
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("BUG evitado: un 'enviando' RECIENTE (intento genuinamente en vuelo) NO se reintenta todavía", async () => {
    const f = fila({ notifyStatus: "enviando", notifyAttempts: 1, updatedAt: Date.now() });
    filas.set(f.id, f);

    const { reintentarNotificacionesPendientes } = await import("@/server/ai/confirmacion-de-pedido");
    const n = await reintentarNotificacionesPendientes();

    expect(n).toBe(0);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("9: tope de intentos -> deja de reintentar sola una fila que ya agotó sus intentos (queda visible, no en bucle infinito)", async () => {
    const f = fila({ notifyStatus: "fallo_recuperable", notifyAttempts: 5 });
    filas.set(f.id, f);

    const { reintentarNotificacionesPendientes } = await import("@/server/ai/confirmacion-de-pedido");
    const n = await reintentarNotificacionesPendientes();

    expect(n).toBe(0);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("Laboratorio: una conversación is_test nunca se reintenta de verdad (nunca debía salir nada)", async () => {
    const f = fila({ notifyStatus: "pendiente", isTest: true });
    filas.set(f.id, f);

    const { reintentarNotificacionesPendientes } = await import("@/server/ai/confirmacion-de-pedido");
    const n = await reintentarNotificacionesPendientes();

    expect(n).toBe(0);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("7: dos pedidos independientes pendientes -> el barrido los procesa a ambos, cada uno con su propio contenido (sin mezclarlos)", async () => {
    const a = fila({ id: "oc_a", summary: "Pedido A — $10.000", customerPhone: "573000000001" });
    const b = fila({ id: "oc_b", summary: "Pedido B — $20.000", customerPhone: "573000000002" });
    filas.set(a.id, a);
    filas.set(b.id, b);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { reintentarNotificacionesPendientes } = await import("@/server/ai/confirmacion-de-pedido");
    const n = await reintentarNotificacionesPendientes();

    expect(n).toBe(2);
    expect(notifyTeam).toHaveBeenCalledWith(expect.objectContaining({ summary: "Pedido A — $10.000" }));
    expect(notifyTeam).toHaveBeenCalledWith(expect.objectContaining({ summary: "Pedido B — $20.000" }));
    expect(filas.get("oc_a")!.notifyStatus).toBe("enviado");
    expect(filas.get("oc_b")!.notifyStatus).toBe("enviado");
  });
});

/**
 * Fase urgente (4-sep-2026) — PARTE 6/7/8 del encargo: el claim atómico
 * (`reclamarNotificacion`) es la MISMA función que usan tanto el primer
 * intento (`intentarNotificarPedido` llamado desde `pipeline.ts`) como el
 * barrido de reintentos (`reintentarNotificacionesPendientes`, desde
 * `worker.ts`) — nunca dos lógicas de claim distintas. Estas pruebas
 * verifican el EFECTO EXTERNO real (cuántas veces se llamó `notifyTeam`,
 * el "proveedor"), no solo el estado final guardado en la fila.
 */
describe("Fase urgente: claim atómico bajo concurrencia real (3 procesos, pipeline vs worker, retry)", () => {
  it("PARTE 6: 3 procesos simultáneos reclamando LA MISMA confirmación -> el proveedor externo se llama EXACTAMENTE una vez", async () => {
    const f = fila({ id: "oc_concurrente" });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { intentarNotificarPedido } = await import("@/server/ai/confirmacion-de-pedido");
    const entrada = {
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    };

    // Proceso A, Proceso B, Proceso C — los 3 intentan reclamar la MISMA
    // fila al mismo tiempo (Promise.all: las 3 llamadas están en vuelo
    // antes de que ninguna termine).
    const [a, b, c] = await Promise.all([
      intentarNotificarPedido(entrada),
      intentarNotificarPedido(entrada),
      intentarNotificarPedido(entrada),
    ]);

    // El efecto externo real: nunca 2, nunca 3 — exactamente 1.
    expect(notifyTeam).toHaveBeenCalledTimes(1);

    // Solo uno de los 3 obtuvo el claim y pudo enviar; los otros dos
    // perdieron la carrera y NUNCA llamaron al proveedor.
    const resultados = [a, b, c];
    expect(resultados.filter((r) => r.estado === "enviado")).toHaveLength(1);
    expect(resultados.filter((r) => r.estado === "ya_reclamado")).toHaveLength(2);

    // Estado final coherente: la fila terminó 'enviado', no a medias.
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("PARTE 7: pipeline (primer intento) y worker (retry) procesan la MISMA confirmación a la vez -> solo uno envía, el otro pierde el claim y se detiene", async () => {
    // Fila recién registrada por el pipeline (INSERT con notify_status
    // default 'pendiente') — el escenario real: el turno que la creó está
    // a punto de llamar a intentarNotificarPedido, pero el barrido
    // periódico del worker corre justo en ese instante y la ve pendiente.
    const f = fila({ id: "oc_pipeline_vs_worker" });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { intentarNotificarPedido, reintentarNotificacionesPendientes } = await import(
      "@/server/ai/confirmacion-de-pedido"
    );

    // "Pipeline" = la llamada directa que hace pipeline.ts al cerrar el
    // pedido. "Worker" = el barrido periódico, que en su primer paso SOLO
    // lee candidatos (sin mutar) y luego reclama uno por uno — se simula
    // aquí llamando ambos caminos concurrentemente.
    const [resultadoPipeline, notificacionesDelWorker] = await Promise.all([
      intentarNotificarPedido({
        id: f.id,
        organizationId: f.organizationId,
        summary: f.summary!,
        customerPhone: f.customerPhone,
      }),
      reintentarNotificacionesPendientes(),
    ]);

    expect(notifyTeam).toHaveBeenCalledTimes(1);

    // O ganó el pipeline (el worker no encontró nada que procesar porque ya
    // estaba tomado) o ganó el worker (el pipeline perdió el claim) — pero
    // NUNCA los dos a la vez.
    const pipelineGano = resultadoPipeline.estado === "enviado";
    const workerProceso = notificacionesDelWorker > 0;
    expect(pipelineGano && workerProceso).toBe(false);
    expect(pipelineGano || workerProceso).toBe(true);

    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("PARTE 8: primer intento falla de forma recuperable -> queda fallo_recuperable; el retry SÍ puede reclamar y enviar; un intento simultáneo al retry NO puede", async () => {
    const f = fila({ id: "oc_retry" });
    filas.set(f.id, f);

    // Primer intento: falla de forma recuperable (sent=0).
    notifyTeam.mockResolvedValueOnce({ sent: 0, failed: 1, detail: "timeout" });
    const { intentarNotificarPedido, reintentarNotificacionesPendientes } = await import(
      "@/server/ai/confirmacion-de-pedido"
    );
    const primerIntento = await intentarNotificarPedido({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });
    expect(primerIntento.estado).toBe("fallo_recuperable");
    expect(filas.get(f.id)!.notifyStatus).toBe("fallo_recuperable");

    // El retry del worker, y un intento simultáneo directo a la misma
    // fila, compiten por el mismo claim.
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    const [retryDelWorker, intentoSimultaneo] = await Promise.all([
      reintentarNotificacionesPendientes(),
      intentarNotificarPedido({
        id: f.id,
        organizationId: f.organizationId,
        summary: f.summary!,
        customerPhone: f.customerPhone,
      }),
    ]);

    expect(notifyTeam).toHaveBeenCalledTimes(2); // 1 del primer intento fallido + 1 del que ganó esta vez
    const workerGano = retryDelWorker > 0;
    const simultaneoGano = intentoSimultaneo.estado === "enviado";
    expect(workerGano && simultaneoGano).toBe(false);
    expect(workerGano || simultaneoGano).toBe(true);
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });
});
