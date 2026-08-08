import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El calendario pide su día al servidor en vez de filtrar en el navegador.
 *
 * Antes recibía la lista general —limitada a 200 filas y ordenada de la más
 * futura a la más vieja— y se quedaba con las del día pintado. Al saltar a un
 * día lejano con el selector de fecha, ese día podía salir **vacío teniendo
 * citas**: simplemente no venía en las 200. Un día entero siempre cabe.
 */

let filas: unknown[] = [];
const wheres: unknown[] = [];

function cadena(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin"]) c[m] = () => c;
  c.where = (w: unknown) => {
    wheres.push(w);
    return c;
  };
  c.orderBy = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => cadena(filas) }),
  schema: new Proxy(
    {},
    {
      get: (_t, tabla) =>
        new Proxy({}, { get: (_t2, col) => `${String(tabla)}.${String(col)}` }),
    }
  ),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: (...a: unknown[]) => a }));

describe("las citas de un día concreto", () => {
  beforeEach(() => {
    vi.resetModules();
    filas = [];
    wheres.length = 0;
  });

  it("devuelve las del día pedido", async () => {
    filas = [
      { id: "apt_1", serviceName: "Manicure", startsAt: new Date("2026-08-12T14:00:00Z") },
    ];
    const { citasDelDia } = await import("@/server/appointments/queries");

    const r = await citasDelDia("org_salon", "12/08/2026");
    expect(r).toHaveLength(1);
    expect(wheres).toHaveLength(1); // consultó, no filtró en memoria
  });

  /**
   * Incluye las canceladas a propósito: la vista las distingue, y esconderlas
   * haría creer que ese hueco nunca se ocupó.
   */
  it("no filtra por estado: eso lo decide quien pinta", async () => {
    filas = [
      { id: "apt_1", status: "pendiente" },
      { id: "apt_2", status: "cancelada" },
    ];
    const { citasDelDia } = await import("@/server/appointments/queries");

    const r = await citasDelDia("org_salon", "12/08/2026");
    expect(r).toHaveLength(2);
  });

  it("una fecha inválida devuelve vacío sin consultar la base", async () => {
    const { citasDelDia } = await import("@/server/appointments/queries");

    const r = await citasDelDia("org_salon", "no-es-fecha");
    expect(r).toEqual([]);
    expect(wheres).toHaveLength(0);
  });
});
