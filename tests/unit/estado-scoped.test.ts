import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

/**
 * Fase 10X — hallazgo de la auditoría transversal de multi-tenant:
 * `leerEstado`/`borrarEstado` (src/server/orders/estado.ts) hacían
 * `WHERE conversationId = X` sin `organizationId`. Hoy no es explotable (el
 * único llamador real, `pipeline.ts`, siempre deriva `conversationId` de una
 * fila ya verificada por organización), pero es el patrón exacto que la
 * Constitución III prohíbe: nada impide que un llamador futuro lo use sin
 * verificar antes la organización. `organizationId` es OPCIONAL a propósito
 * (compatibilidad con `scripts/probar-estado.ts`, fuera del gate de
 * typecheck — no se toca sin poder ejecutarlo contra la base real); cuando
 * se pasa, la query queda `scoped()` de verdad.
 */

const selectQueue: unknown[][] = [];
const deletedWhere: unknown[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = (...args: unknown[]) => {
    if (m === "where") deletedWhere.push(args[0]);
    return chain;
  };
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    delete: () => thenableChain([]),
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

const ESTADO = { schema_version: 1, paso: "1", items: [], datos: {}, confirmado: false };

describe("leerEstado / borrarEstado — Fase 10X: scoping opcional pero real", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    deletedWhere.length = 0;
  });

  it("con organizationId, la lectura pasa por scoped() con el organizationId correcto", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([{ estado: ESTADO }]);

    const { leerEstado } = await import("@/server/orders/estado");
    const r = await leerEstado("cv_1", "org_1");

    expect(r).toEqual(ESTADO);
    expect(scopedSpy).toHaveBeenCalledWith(
      schema.conversationState.organizationId,
      "org_1",
      expect.anything()
    );
  });

  it("Fase 10R — BUG REAL corregido: una fila corrupta (sin items/datos) NO tumba el turno, se trata como 'sin estado'", async () => {
    selectQueue.push([{ estado: { schema_version: 1 } }]); // sin items, sin datos

    const { leerEstado } = await import("@/server/orders/estado");
    const r = await leerEstado("cv_1", "org_1");

    // Antes: se devolvía tal cual, y comoTexto() reventaba en estado.items.filter().
    expect(r).toBeNull();
  });

  it("Fase 10R: una fila con 'items' que no es array también se trata como corrupta, no como válida", async () => {
    selectQueue.push([{ estado: { schema_version: 1, items: "no soy un array", datos: {} } }]);

    const { leerEstado } = await import("@/server/orders/estado");
    expect(await leerEstado("cv_1", "org_1")).toBeNull();
  });

  it("sin organizationId (compatibilidad con scripts/probar-estado.ts), NO llama a scoped() y sigue funcionando igual que antes", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([{ estado: ESTADO }]);

    const { leerEstado } = await import("@/server/orders/estado");
    const r = await leerEstado("cv_1");

    expect(r).toEqual(ESTADO);
    expect(scopedSpy).not.toHaveBeenCalled();
  });

  it("borrarEstado con organizationId también queda scoped()", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([]); // leerEstado interno (anterior) -> nada guardado

    const { borrarEstado } = await import("@/server/orders/estado");
    await borrarEstado("cv_1", { actor: "pipeline", proceso: "reinicio", organizationId: "org_1" });

    expect(scopedSpy).toHaveBeenCalledWith(
      schema.conversationState.organizationId,
      "org_1",
      expect.anything()
    );
  });
});
