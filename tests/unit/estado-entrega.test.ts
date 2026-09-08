import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

/**
 * Fase 10V-X — pruebas unitarias de bajo nivel para `leerEntregaVerificada`/
 * `guardarEntregaVerificada` (src/server/orders/estado.ts): la verificación
 * de domicilio persistida ENTRE turnos, reutilizando la misma fila de
 * `conversation_state` que ya existía para el Fase 2, pero de forma
 * independiente de `state_source` (ver el comentario de esas dos funciones).
 *
 * Los escenarios de pipeline completo (consultar_domicilio → notify_order
 * varios turnos después, cambio de zona, recogida, multi-tenant end-to-end,
 * concurrencia simulada) están en `pipeline-domicilio-persistente.test.ts`;
 * aquí se prueban las dos funciones EN AISLAMIENTO, mismo patrón que
 * `estado-scoped.test.ts` y `estado-concurrencia-pipeline.test.ts`.
 */

const selectQueue: unknown[][] = [];
let returningRows: unknown[] = [{ conversationId: "cv_1" }];
const insertedValues: Record<string, unknown>[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values);
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
          returning: () => Promise.resolve(returningRows),
          then: (resolve: (v: unknown) => void) => Promise.resolve(returningRows).then(resolve),
        };
        return chain;
      },
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

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => ({ __scoped: conds }),
}));

const ENTREGA_KACHIPAY = {
  tipo: "domicilio" as const,
  zonaId: "dz_1",
  zonaNombre: "Kachipay",
  feeCents: 1200000,
  verificadoEnMensajeId: "m1",
  verificadoEn: "2026-09-04T10:00:00.000Z",
};

beforeEach(() => {
  selectQueue.length = 0;
  insertedValues.length = 0;
  returningRows = [{ conversationId: "cv_1" }];
});

describe("leerEntregaVerificada", () => {
  it("sin fila guardada, devuelve null (nunca inventa una tarifa)", async () => {
    selectQueue.push([]);
    const { leerEntregaVerificada } = await import("@/server/orders/estado");
    expect(await leerEntregaVerificada("cv_1", "org_1")).toBeNull();
  });

  it("con una fila guardada, devuelve exactamente el sub-objeto `entrega` persistido", async () => {
    selectQueue.push([
      {
        estado: {
          schema_version: 5,
          items: [],
          datos: {},
          entrega: ENTREGA_KACHIPAY,
        },
        version: 3,
      },
    ]);
    const { leerEntregaVerificada } = await import("@/server/orders/estado");
    expect(await leerEntregaVerificada("cv_1", "org_1")).toEqual(ENTREGA_KACHIPAY);
  });

  it("una fila guardada SIN `entrega` (un negocio que nunca verificó domicilio) devuelve null, no explota", async () => {
    selectQueue.push([
      { estado: { schema_version: 5, items: [], datos: {} }, version: 1 },
    ]);
    const { leerEntregaVerificada } = await import("@/server/orders/estado");
    expect(await leerEntregaVerificada("cv_1", "org_1")).toBeNull();
  });

  it("Fase 10X, mismo criterio: la lectura queda scoped() por organizationId", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([]);

    const { leerEntregaVerificada } = await import("@/server/orders/estado");
    await leerEntregaVerificada("cv_1", "org_1");

    expect(scopedSpy).toHaveBeenCalledWith(
      schema.conversationState.organizationId,
      "org_1",
      expect.anything()
    );
  });
});

describe("guardarEntregaVerificada", () => {
  it("sin fila previa, crea una desde estadoVacio() con la entrega puesta", async () => {
    selectQueue.push([]); // leerFilaDeEstado interno: nada guardado todavía
    selectQueue.push([]); // guardarEstado lee "anterior" para el registro de cambios

    const { guardarEntregaVerificada } = await import("@/server/orders/estado");
    const r = await guardarEntregaVerificada({
      conversationId: "cv_1",
      organizationId: "org_1",
      entrega: ENTREGA_KACHIPAY,
      actor: "pipeline",
      proceso: "consultar_domicilio",
    });

    expect(r).toEqual({ ok: true });
    expect(insertedValues).toHaveLength(1);
    const guardado = insertedValues[0]!.estado as { entrega: unknown; items: unknown[] };
    expect(guardado.entrega).toEqual(ENTREGA_KACHIPAY);
    expect(guardado.items).toEqual([]); // no inventó ningún pedido
  });

  it("con fila previa (items/datos de un pedido real), preserva TODO lo demás — nunca pisa el pedido por guardar la tarifa", async () => {
    const estadoPrevio = {
      schema_version: 5,
      items: [
        {
          ofrecible: { id: "p1", nombre: "Pavé Cremoso" },
          cantidad: 1,
          seleccion: [],
          totalCents: 1800000,
        },
      ],
      datos: { telefono: "3001234567" },
      paso: "esperando confirmación",
      confirmado: false,
      totalCents: null,
    };
    selectQueue.push([{ estado: estadoPrevio, version: 2 }]); // leerFilaDeEstado interno
    selectQueue.push([{ estado: estadoPrevio }]); // guardarEstado lee "anterior"

    const { guardarEntregaVerificada } = await import("@/server/orders/estado");
    await guardarEntregaVerificada({
      conversationId: "cv_1",
      organizationId: "org_1",
      entrega: ENTREGA_KACHIPAY,
      actor: "pipeline",
      proceso: "consultar_domicilio",
    });

    const guardado = insertedValues[0]!.estado as typeof estadoPrevio & { entrega: unknown };
    expect(guardado.items).toEqual(estadoPrevio.items);
    expect(guardado.datos).toEqual(estadoPrevio.datos);
    expect(guardado.entrega).toEqual(ENTREGA_KACHIPAY);
  });

  it("`entrega: null` invalida/borra la verificación conocida, sin tocar lo demás", async () => {
    const estadoPrevio = {
      schema_version: 5,
      items: [],
      datos: {},
      paso: "sin pedido",
      confirmado: false,
      totalCents: null,
      entrega: ENTREGA_KACHIPAY,
    };
    selectQueue.push([{ estado: estadoPrevio, version: 4 }]);
    selectQueue.push([{ estado: estadoPrevio }]);

    const { guardarEntregaVerificada } = await import("@/server/orders/estado");
    await guardarEntregaVerificada({
      conversationId: "cv_1",
      organizationId: "org_1",
      entrega: null,
      actor: "pipeline",
      proceso: "pedido_confirmado",
    });

    const guardado = insertedValues[0]!.estado as { entrega: unknown };
    expect(guardado.entrega).toBeNull();
  });

  it("lee su PROPIA versión justo antes de escribir — nunca una capturada al principio del turno", async () => {
    // Fase 10V-X: si esto usara una versión vieja, una escritura de en medio
    // del turno (como la de consultar_domicilio) perdería carreras contra
    // escrituras que ni siquiera han pasado todavía. Se verifica que
    // guardarEntregaVerificada hace su PROPIO select() antes de escribir,
    // en vez de depender de un valor pasado desde fuera (no hay parámetro
    // `versionEsperada` en su firma — lo calcula internamente).
    selectQueue.push([{ estado: { schema_version: 5, items: [], datos: {} }, version: 9 }]);
    selectQueue.push([{ estado: { schema_version: 5, items: [], datos: {} } }]);

    const { guardarEntregaVerificada } = await import("@/server/orders/estado");
    await guardarEntregaVerificada({
      conversationId: "cv_1",
      organizationId: "org_1",
      entrega: ENTREGA_KACHIPAY,
      actor: "pipeline",
      proceso: "consultar_domicilio",
    });

    // No hay forma directa de leer el `where` del onConflictDoUpdate en este
    // mock (no lo modela), pero si `leerFilaDeEstado` no se hubiera llamado
    // de nuevo, `selectQueue` seguiría con 2 elementos sin consumir.
    expect(selectQueue).toHaveLength(0);
  });

  it("BUG REAL evitado: si la fila cambió entre la lectura y la escritura (carrera perdida), devuelve {ok:false} y NO lanza", async () => {
    selectQueue.push([{ estado: { schema_version: 5, items: [], datos: {} }, version: 5 }]);
    selectQueue.push([{ estado: { schema_version: 5, items: [], datos: {} } }]);
    returningRows = []; // simula que el WHERE version=5 ya no coincidió (CAS perdido)

    const { guardarEntregaVerificada } = await import("@/server/orders/estado");
    const r = await guardarEntregaVerificada({
      conversationId: "cv_1",
      organizationId: "org_1",
      entrega: ENTREGA_KACHIPAY,
      actor: "pipeline",
      proceso: "consultar_domicilio",
    });

    expect(r).toEqual({ ok: false });
  });

  it("multi-tenant: la escritura también queda scoped() por organizationId (vía leerFilaDeEstado)", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([]);
    selectQueue.push([]);

    const { guardarEntregaVerificada } = await import("@/server/orders/estado");
    await guardarEntregaVerificada({
      conversationId: "cv_1",
      organizationId: "org_2",
      entrega: ENTREGA_KACHIPAY,
      actor: "pipeline",
      proceso: "consultar_domicilio",
    });

    expect(scopedSpy).toHaveBeenCalledWith(
      schema.conversationState.organizationId,
      "org_2",
      expect.anything()
    );
  });
});
