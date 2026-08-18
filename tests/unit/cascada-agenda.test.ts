import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cascada de agenda: pasar el día de una especialista a otra, o liberarlo.
 * Herramienta de administración pedida por el dueño al entrar el primer
 * cliente real de citas (7-ago-2026).
 *
 * Lo que estas pruebas protegen es la regla dura: **una cita no se mueve a
 * ciegas**. Si la otra persona no atiende ese servicio, o ya tiene ese hueco
 * ocupado, la cita se queda donde está y sale reportada — dejar a dos
 * clientas a la misma hora con la misma persona es peor que avisar de un
 * choque.
 */

type Fila = Record<string, unknown>;

let citasDelDia: Fila[] = [];
let serviciosQueAtiende: { serviceId: string }[] = [];
let solapamientos: Fila[] = [];
const updates: { set: Fila }[] = [];

/** Cada `select` consume la siguiente respuesta de la cola. */
let colaSelect: unknown[][] = [];

function cadena(filas: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c;
  c.limit = () => Promise.resolve(filas);
  (c as { then: unknown }).then = (r: (v: unknown) => void) =>
    Promise.resolve(filas).then(r);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => cadena(colaSelect.shift() ?? []),
    update: () => ({
      set: (set: Fila) => ({
        where: () => {
          updates.push({ set });
          return Promise.resolve([]);
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tabla) =>
        new Proxy({}, { get: (_t2, col) => `${String(tabla)}.${String(col)}` }),
    }
  ),
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: (...a: unknown[]) => a }));

const CITA_A = {
  id: "apt_1",
  contactId: "ct_1",
  serviceId: "svc_manicure",
  serviceName: "Manicure",
  durationMin: 45,
  contactName: "Tatiana",
  startsAt: new Date("2026-08-10T14:00:00Z"),
  endsAt: new Date("2026-08-10T14:45:00Z"),
};
const CITA_B = {
  id: "apt_2",
  contactId: "ct_2",
  serviceId: "svc_corte",
  serviceName: "Corte de cabello",
  durationMin: 30,
  contactName: "Marcela",
  startsAt: new Date("2026-08-10T16:00:00Z"),
  endsAt: new Date("2026-08-10T16:30:00Z"),
};

const BASE = {
  organizationId: "org_salon",
  staffOrigenId: "stf_laura",
  staffDestinoId: "stf_camila",
  fecha: "10/08/2026",
};

describe("reasignar la agenda de una especialista", () => {
  beforeEach(() => {
    vi.resetModules();
    updates.length = 0;
    colaSelect = [];
    citasDelDia = [];
    serviciosQueAtiende = [];
    solapamientos = [];
  });

  it("mueve las citas cuando la otra persona las atiende y tiene el hueco libre", async () => {
    citasDelDia = [CITA_A, CITA_B];
    serviciosQueAtiende = [{ serviceId: "svc_manicure" }, { serviceId: "svc_corte" }];
    // agenda, servicios adicionales (ninguno: las dos son de un solo servicio), atiende, 2 chequeos de solape
    colaSelect = [citasDelDia, [], serviciosQueAtiende, [], []];

    const { reasignarAgenda } = await import("@/server/appointments/queries");
    const r = await reasignarAgenda(BASE);

    expect(r.aplicadas).toHaveLength(2);
    expect(r.conflictos).toHaveLength(0);
    expect(updates).toHaveLength(2);
    expect(updates[0]?.set).toMatchObject({ resourceId: "stf_camila" });
  });

  it("NO mueve una cita de un servicio que la otra no atiende", async () => {
    citasDelDia = [CITA_A, CITA_B];
    serviciosQueAtiende = [{ serviceId: "svc_manicure" }]; // Camila no hace cortes
    colaSelect = [citasDelDia, [], serviciosQueAtiende, []];

    const { reasignarAgenda } = await import("@/server/appointments/queries");
    const r = await reasignarAgenda(BASE);

    expect(r.aplicadas.map((c) => c.id)).toEqual(["apt_1"]);
    expect(r.conflictos).toHaveLength(1);
    expect(r.conflictos[0]?.cita.id).toBe("apt_2");
    expect(r.conflictos[0]?.motivo).toContain("no atiende");
    expect(updates).toHaveLength(1); // solo se tocó la que sí podía
  });

  it("NO pisa un hueco que la otra ya tiene ocupado", async () => {
    citasDelDia = [CITA_A];
    serviciosQueAtiende = [{ serviceId: "svc_manicure" }];
    solapamientos = [{ id: "apt_otra" }];
    colaSelect = [citasDelDia, [], serviciosQueAtiende, solapamientos];

    const { reasignarAgenda } = await import("@/server/appointments/queries");
    const r = await reasignarAgenda(BASE);

    expect(r.aplicadas).toHaveLength(0);
    expect(r.conflictos[0]?.motivo).toContain("ya tiene otra cita");
    expect(updates).toHaveLength(0); // nada se movió
  });

  it("sin citas ese día no hace nada", async () => {
    colaSelect = [[], []];

    const { reasignarAgenda } = await import("@/server/appointments/queries");
    const r = await reasignarAgenda(BASE);

    expect(r.aplicadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  /**
   * 18-ago-2026: el caso real que motivó esta corrección. "Diwpower +
   * Tradicionales" (manos y pies) solo comprobaba `serviceId` — el
   * principal — así que se podía reasignar a alguien que solo atendía
   * Diwpower, dejando los pies sin quién los hiciera.
   */
  it("NO mueve una visita multiservicio si la otra persona no atiende TODOS sus servicios", async () => {
    const visita = {
      id: "apt_3",
      contactId: "ct_3",
      serviceId: "svc_diwpower",
      serviceName: "Diwpower",
      durationMin: 90,
      contactName: "Valentina",
      startsAt: new Date("2026-08-10T14:30:00Z"),
      endsAt: new Date("2026-08-10T16:30:00Z"),
    };
    citasDelDia = [visita];
    // Camila atiende Diwpower, pero no Tradicionales.
    const serviciosDeLaVisita = [
      { appointmentId: "apt_3", serviceId: "svc_diwpower", serviceName: "Diwpower" },
      { appointmentId: "apt_3", serviceId: "svc_tradicionales", serviceName: "Tradicionales" },
    ];
    serviciosQueAtiende = [{ serviceId: "svc_diwpower" }];
    colaSelect = [citasDelDia, serviciosDeLaVisita, serviciosQueAtiende];

    const { reasignarAgenda } = await import("@/server/appointments/queries");
    const r = await reasignarAgenda(BASE);

    expect(r.aplicadas).toHaveLength(0);
    expect(r.conflictos).toHaveLength(1);
    expect(r.conflictos[0]?.motivo).toContain("Tradicionales");
    expect(updates).toHaveLength(0);
  });

  it("SÍ mueve una visita multiservicio cuando la otra persona atiende TODOS sus servicios", async () => {
    const visita = {
      id: "apt_3",
      contactId: "ct_3",
      serviceId: "svc_diwpower",
      serviceName: "Diwpower",
      durationMin: 90,
      contactName: "Valentina",
      startsAt: new Date("2026-08-10T14:30:00Z"),
      endsAt: new Date("2026-08-10T16:30:00Z"),
    };
    citasDelDia = [visita];
    const serviciosDeLaVisita = [
      { appointmentId: "apt_3", serviceId: "svc_diwpower", serviceName: "Diwpower" },
      { appointmentId: "apt_3", serviceId: "svc_tradicionales", serviceName: "Tradicionales" },
    ];
    serviciosQueAtiende = [{ serviceId: "svc_diwpower" }, { serviceId: "svc_tradicionales" }];
    colaSelect = [citasDelDia, serviciosDeLaVisita, serviciosQueAtiende, []]; // + chequeo de solape

    const { reasignarAgenda } = await import("@/server/appointments/queries");
    const r = await reasignarAgenda(BASE);

    expect(r.aplicadas).toHaveLength(1);
    expect(r.conflictos).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });
});

describe("liberar el día de una especialista", () => {
  beforeEach(() => {
    vi.resetModules();
    updates.length = 0;
    colaSelect = [];
  });

  it("cancela todas sus citas activas de ese día", async () => {
    colaSelect = [[CITA_A, CITA_B]];

    const { liberarAgenda } = await import("@/server/appointments/queries");
    const r = await liberarAgenda({
      organizationId: "org_salon",
      staffId: "stf_laura",
      fecha: "10/08/2026",
    });

    expect(r.aplicadas).toHaveLength(2);
    expect(updates).toHaveLength(2);
    expect(updates[0]?.set).toMatchObject({ status: "cancelada" });
    // Devuelve las citas para poder avisarle a cada clienta.
    expect(r.aplicadas.map((c) => c.contactId)).toEqual(["ct_1", "ct_2"]);
  });

  it("una fecha inválida no cancela nada", async () => {
    const { liberarAgenda } = await import("@/server/appointments/queries");
    const r = await liberarAgenda({
      organizationId: "org_salon",
      staffId: "stf_laura",
      fecha: "no-es-fecha",
    });

    expect(r.aplicadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
