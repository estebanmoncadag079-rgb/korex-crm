import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El calendario pide su día al servidor en vez de filtrar en el navegador.
 *
 * Antes recibía la lista general —limitada a 200 filas y ordenada de la más
 * futura a la más vieja— y se quedaba con las del día pintado. Al saltar a un
 * día lejano con el selector de fecha, ese día podía salir **vacío teniendo
 * citas**: simplemente no venía en las 200. Un día entero siempre cabe.
 */

/** Cada `select` consume la siguiente respuesta de la cola. */
let colaSelect: unknown[][] = [];
const wheres: unknown[] = [];

function cadena(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "orderBy"]) c[m] = () => c;
  c.where = (w: unknown) => {
    wheres.push(w);
    return c;
  };
  // `listAppointments` encadena `.limit(200)` tras `.orderBy()`; `citasDelDia`
  // no llama `.limit` y espera el resultado directo — `c` sirve para las dos.
  c.limit = () => Promise.resolve(rows);
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => cadena(colaSelect.shift() ?? []) }),
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
    colaSelect = [];
    wheres.length = 0;
  });

  it("devuelve las del día pedido", async () => {
    colaSelect = [
      [{ id: "apt_1", serviceName: "Manicure", startsAt: new Date("2026-08-12T14:00:00Z") }],
      [], // serviciosDeCitas: sin filas adicionales para esta cita
    ];
    const { citasDelDia } = await import("@/server/appointments/queries");

    const r = await citasDelDia("org_salon", "12/08/2026");
    expect(r).toHaveLength(1);
    expect(wheres).toHaveLength(2); // consultó el día y los servicios adicionales, no filtró en memoria
  });

  /**
   * Incluye las canceladas a propósito: la vista las distingue, y esconderlas
   * haría creer que ese hueco nunca se ocupó.
   */
  it("no filtra por estado: eso lo decide quien pinta", async () => {
    colaSelect = [
      [
        { id: "apt_1", status: "pendiente" },
        { id: "apt_2", status: "cancelada" },
      ],
      [],
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

  /**
   * 18-ago-2026: una visita con varios servicios ("manos y pies") solo
   * mostraba el principal en el calendario, aunque la reserva y el bloque de
   * tiempo ya estaban completos — la clienta se lo dijo al agente, el agente
   * lo agendó bien, y el calendario mentía por omisión. Caso real reportado
   * por el dueño el mismo día que se prendió el agente de Lashes Valen.
   */
  it("una visita con varios servicios los trae TODOS, no solo el principal", async () => {
    colaSelect = [
      [
        {
          id: "apt_1",
          serviceName: "Diwpower",
          startsAt: new Date("2026-08-19T14:30:00Z"),
          endsAt: new Date("2026-08-19T16:30:00Z"),
        },
      ],
      [
        { appointmentId: "apt_1", serviceName: "Diwpower" },
        { appointmentId: "apt_1", serviceName: "Tradicionales" },
      ],
    ];
    const { citasDelDia } = await import("@/server/appointments/queries");

    const r = await citasDelDia("org_salon", "19/08/2026");
    expect(r[0]?.serviceNames).toEqual(["Diwpower", "Tradicionales"]);
  });

  it("una visita de un solo servicio trae serviceNames con ese único servicio", async () => {
    colaSelect = [[{ id: "apt_1", serviceName: "Manicure" }], []];
    const { citasDelDia } = await import("@/server/appointments/queries");

    const r = await citasDelDia("org_salon", "12/08/2026");
    expect(r[0]?.serviceNames).toEqual(["Manicure"]);
  });
});

describe("listAppointments (la lista general del panel)", () => {
  beforeEach(() => {
    vi.resetModules();
    colaSelect = [];
    wheres.length = 0;
  });

  it("también trae TODOS los servicios de cada visita: misma máquina que citasDelDia", async () => {
    colaSelect = [
      [{ id: "apt_1", serviceName: "Diwpower" }],
      [
        { appointmentId: "apt_1", serviceName: "Diwpower" },
        { appointmentId: "apt_1", serviceName: "Tradicionales" },
      ],
    ];
    const { listAppointments } = await import("@/server/appointments/queries");

    const r = await listAppointments("org_salon");
    expect(r[0]?.serviceNames).toEqual(["Diwpower", "Tradicionales"]);
  });
});
