import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6B — entrega confiable de la notificación de `book_appointment`,
 * mismo diseño que `notificacion-pedido-confiable.test.ts` (Fase 11-B,
 * pedidos), clonado para citas: `confirmacion-de-cita.ts` clonaba la
 * idempotencia de `confirmacion-de-pedido.ts` (Fase 10N-A/D) pero se
 * escribió ANTES de que la Fase 11-B existiera, así que nunca replicó la
 * separación entre "la cita quedó registrada" y "el equipo recibió el
 * aviso" — hasta esta reconciliación (auditoría de Fase 6A, hallazgo ALTO).
 *
 * `intentarNotificarCita` es el intento real (usado tanto la primera vez,
 * desde `avisarYConfirmar` en `pipeline.ts`, como en cada reintento), y
 * `reintentarNotificacionesDeCitaPendientes` es el barrido periódico que
 * encuentra lo que quedó pendiente/fallido/huérfano.
 */

const notifyTeam = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeam(...a),
}));

/**
 * Mismo truco que en el análogo de pedidos: `eq(...)` y `sql\`...\`` reales
 * construyen objetos opacos de Drizzle — se reemplazan por marcadores
 * inspeccionables para que el mock de `db.update/execute` de abajo pueda
 * distinguir QUÉ consulta es sin reimplementar Drizzle ni Postgres.
 */
vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...real,
    eq: (col: unknown, val: unknown) => ({ __eqCol: col, __eqVal: val }),
    and: (...conds: unknown[]) => ({ __and: conds }),
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
  conversationId: string;
  idempotencyKey: string;
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
     * Dos formas DISTINTAS de `db.execute(sql\`...\`)` pasan por aquí:
     * `reclamarNotificacionDeCita` (un `UPDATE` atómico de UNA fila por
     * `id`) y `reintentarNotificacionesDeCitaPendientes` (un `SELECT` de
     * solo lectura, sin tocar nada). Se distinguen por el texto de la
     * consulta — igual que Postgres las trataría de forma distinta.
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
        // reclamarNotificacionDeCita: UPDATE ... WHERE id = ${id} AND (...) RETURNING id
        const id = query.__sqlValues[0] as string;
        const f = filas.get(id);
        const ahora = Date.now();
        if (!f || !esElegible(f, ahora)) return Promise.resolve([]);
        f.notifyStatus = "enviando";
        f.notifyAttempts += 1;
        f.updatedAt = ahora;
        return Promise.resolve([{ id: f.id }]);
      }

      // reintentarNotificacionesDeCitaPendientes: SELECT de solo lectura,
      // nunca muta nada — el claim real ocurre después, uno por uno.
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
    id: "apbc_1",
    organizationId: "org_1",
    conversationId: "cv_1",
    idempotencyKey: "hash1",
    summary: "Corte de cabello · 10/09/2026 10:00 · Laura",
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

describe("intentarNotificarCita: el intento real, con la máquina de estados", () => {
  it("1: envío exitoso -> notifyStatus='enviado'", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "enviado a 1 número(s)" });

    const { intentarNotificarCita } = await import("@/server/ai/confirmacion-de-cita");
    const r = await intentarNotificarCita({
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

    const { intentarNotificarCita } = await import("@/server/ai/confirmacion-de-cita");
    await intentarNotificarCita({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(filas.get(f.id)!.notifyStatus).toBe("fallo_recuperable");
  });

  it("3: excepción durante el envío -> notifyStatus='fallo_recuperable', NUNCA se queda trabado en 'enviando', y NO lanza", async () => {
    const f = fila();
    filas.set(f.id, f);
    notifyTeam.mockRejectedValue(new Error("timeout de red"));

    const { intentarNotificarCita } = await import("@/server/ai/confirmacion-de-cita");
    const r = await intentarNotificarCita({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });

    expect(r.sent).toBe(0);
    expect(filas.get(f.id)!.notifyStatus).toBe("fallo_recuperable");
  });
});

describe("reintentarNotificacionesDeCitaPendientes: el barrido periódico (worker.ts)", () => {
  it("4: una notificación fallida se reintenta con EL MISMO contenido, y esta vez se entrega -> la cita no pierde su aviso", async () => {
    const f = fila({ notifyStatus: "fallo_recuperable", notifyAttempts: 1 });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "enviado a 1 número(s)" });

    const { reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const n = await reintentarNotificacionesDeCitaPendientes();

    expect(n).toBe(1);
    expect(notifyTeam).toHaveBeenCalledWith(
      expect.objectContaining({ summary: f.summary, customerPhone: f.customerPhone })
    );
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("5: crash entre persistencia e intento (fila trabada en 'enviando' hace más de 5 min) -> el barrido la reclama y reintenta", async () => {
    const f = fila({
      notifyStatus: "enviando",
      notifyAttempts: 1,
      updatedAt: Date.now() - 10 * 60_000,
    });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const n = await reintentarNotificacionesDeCitaPendientes();

    expect(n).toBe(1);
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("BUG evitado: un 'enviando' RECIENTE (intento genuinamente en vuelo) NO se reintenta todavía", async () => {
    const f = fila({ notifyStatus: "enviando", notifyAttempts: 1, updatedAt: Date.now() });
    filas.set(f.id, f);

    const { reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const n = await reintentarNotificacionesDeCitaPendientes();

    expect(n).toBe(0);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("6: tope de intentos -> deja de reintentar sola una fila que ya agotó sus intentos", async () => {
    const f = fila({ notifyStatus: "fallo_recuperable", notifyAttempts: 5 });
    filas.set(f.id, f);

    const { reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const n = await reintentarNotificacionesDeCitaPendientes();

    expect(n).toBe(0);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("Laboratorio: una conversación is_test nunca se reintenta de verdad (nunca debía salir nada)", async () => {
    const f = fila({ notifyStatus: "pendiente", isTest: true });
    filas.set(f.id, f);

    const { reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const n = await reintentarNotificacionesDeCitaPendientes();

    expect(n).toBe(0);
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it("7: dos citas independientes pendientes -> el barrido las procesa a ambas, cada una con su propio contenido (sin mezclarlas)", async () => {
    const a = fila({ id: "apbc_a", summary: "Corte — Laura", customerPhone: "573000000001" });
    const b = fila({ id: "apbc_b", summary: "Manicure — Karen", customerPhone: "573000000002" });
    filas.set(a.id, a);
    filas.set(b.id, b);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const n = await reintentarNotificacionesDeCitaPendientes();

    expect(n).toBe(2);
    expect(notifyTeam).toHaveBeenCalledWith(expect.objectContaining({ summary: "Corte — Laura" }));
    expect(notifyTeam).toHaveBeenCalledWith(expect.objectContaining({ summary: "Manicure — Karen" }));
    expect(filas.get("apbc_a")!.notifyStatus).toBe("enviado");
    expect(filas.get("apbc_b")!.notifyStatus).toBe("enviado");
  });
});

/**
 * Mismo criterio que "Fase urgente" en el análogo de pedidos: el claim
 * atómico (`reclamarNotificacionDeCita`) es la MISMA función que usan tanto
 * el primer intento (`intentarNotificarCita`, llamado desde `pipeline.ts`)
 * como el barrido de reintentos (`reintentarNotificacionesDeCitaPendientes`,
 * desde `worker.ts`) — nunca dos lógicas de claim distintas.
 */
describe("Claim atómico bajo concurrencia real (pipeline vs worker, retry)", () => {
  it("PARTE A: 3 procesos simultáneos reclamando LA MISMA confirmación -> el proveedor externo se llama EXACTAMENTE una vez", async () => {
    const f = fila({ id: "apbc_concurrente" });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { intentarNotificarCita } = await import("@/server/ai/confirmacion-de-cita");
    const entrada = {
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    };

    const [a, b, c] = await Promise.all([
      intentarNotificarCita(entrada),
      intentarNotificarCita(entrada),
      intentarNotificarCita(entrada),
    ]);

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    const resultados = [a, b, c];
    expect(resultados.filter((r) => r.estado === "enviado")).toHaveLength(1);
    expect(resultados.filter((r) => r.estado === "ya_reclamado")).toHaveLength(2);
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("PARTE B: pipeline (primer intento) y worker (retry) procesan la MISMA confirmación a la vez -> solo uno envía, el otro pierde el claim y se detiene", async () => {
    const f = fila({ id: "apbc_pipeline_vs_worker" });
    filas.set(f.id, f);
    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });

    const { intentarNotificarCita, reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );

    const [resultadoPipeline, notificacionesDelWorker] = await Promise.all([
      intentarNotificarCita({
        id: f.id,
        organizationId: f.organizationId,
        summary: f.summary!,
        customerPhone: f.customerPhone,
      }),
      reintentarNotificacionesDeCitaPendientes(),
    ]);

    expect(notifyTeam).toHaveBeenCalledTimes(1);
    const pipelineGano = resultadoPipeline.estado === "enviado";
    const workerProceso = notificacionesDelWorker > 0;
    expect(pipelineGano && workerProceso).toBe(false);
    expect(pipelineGano || workerProceso).toBe(true);
    expect(filas.get(f.id)!.notifyStatus).toBe("enviado");
  });

  it("PARTE C (fallo parcial y reintento): primer intento falla de forma recuperable -> queda fallo_recuperable; el retry SÍ puede reclamar y enviar; un intento simultáneo al retry NO puede", async () => {
    const f = fila({ id: "apbc_retry" });
    filas.set(f.id, f);

    notifyTeam.mockResolvedValueOnce({ sent: 0, failed: 1, detail: "timeout" });
    const { intentarNotificarCita, reintentarNotificacionesDeCitaPendientes } = await import(
      "@/server/ai/confirmacion-de-cita"
    );
    const primerIntento = await intentarNotificarCita({
      id: f.id,
      organizationId: f.organizationId,
      summary: f.summary!,
      customerPhone: f.customerPhone,
    });
    expect(primerIntento.estado).toBe("fallo_recuperable");
    expect(filas.get(f.id)!.notifyStatus).toBe("fallo_recuperable");

    notifyTeam.mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
    const [retryDelWorker, intentoSimultaneo] = await Promise.all([
      reintentarNotificacionesDeCitaPendientes(),
      intentarNotificarCita({
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
