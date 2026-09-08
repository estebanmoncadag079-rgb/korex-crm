import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 11-A — `siguePoseyendoElTrabajo` (cola.ts) en aislamiento: el
 * mecanismo REAL de fencing, sin pasar por el pipeline completo (eso vive
 * en `worker-ownership-fencing.test.ts`, con `siguePoseyendoElTrabajo`
 * mockeada). Aquí se prueba que arma la consulta correcta y que su
 * "fuente de verdad" es el resultado de esa consulta, nunca una bandera en
 * memoria.
 */

const executeMock = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({ execute: (...a: unknown[]) => executeMock(...a) }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

beforeEach(() => {
  executeMock.mockReset();
});

describe("siguePoseyendoElTrabajo", () => {
  it("sin ownership (Laboratorio/scripts/pruebas) -> true SIN consultar la base", async () => {
    const { siguePoseyendoElTrabajo } = await import("@/server/ai/cola");
    const resultado = await siguePoseyendoElTrabajo(undefined);
    expect(resultado).toBe(true);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("la fila sigue con la misma generación y status='corriendo' -> true", async () => {
    executeMock.mockResolvedValue([{ "?column?": 1 }]);
    const { siguePoseyendoElTrabajo } = await import("@/server/ai/cola");
    const resultado = await siguePoseyendoElTrabajo({ jobId: "aj_1", generation: 3 });
    expect(resultado).toBe(true);
  });

  it("BUG REAL evitado: la fila ya no existe con esa generación (rescatada) -> false, no una excepción", async () => {
    executeMock.mockResolvedValue([]);
    const { siguePoseyendoElTrabajo } = await import("@/server/ai/cola");
    const resultado = await siguePoseyendoElTrabajo({ jobId: "aj_1", generation: 3 });
    expect(resultado).toBe(false);
  });

  it("nunca decide por una bandera en memoria: dos llamadas seguidas reflejan lo que la base devuelva CADA vez", async () => {
    const { siguePoseyendoElTrabajo } = await import("@/server/ai/cola");
    executeMock.mockResolvedValueOnce([{ "?column?": 1 }]);
    expect(await siguePoseyendoElTrabajo({ jobId: "aj_1", generation: 3 })).toBe(true);
    // La generación cambió EN LA BASE entre una llamada y la otra (otro
    // worker la reasignó) — la función lo refleja de inmediato, sin cache.
    executeMock.mockResolvedValueOnce([]);
    expect(await siguePoseyendoElTrabajo({ jobId: "aj_1", generation: 3 })).toBe(false);
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});
