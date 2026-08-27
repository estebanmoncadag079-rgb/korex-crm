import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Solo se agenda un horario que el agente haya ofrecido" (5-ago-2026).
 *
 * `crearCita` ya comprueba que el hueco esté libre, pero eso no impide
 * reservar uno que nunca se ofreció: el caso real es una fecha relativa mal
 * entendida ("el miércoles", "mañana en la tarde", ver 19-CITAS.md) que cae
 * por casualidad en un hueco libre. Idea tomada de `offered_slots` de
 * `nea-agent`.
 */

let filas: { fecha: string; hora: string }[] = [];
const borrados: unknown[] = [];
const insertados: unknown[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => Promise.resolve(filas) }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        borrados.push(w);
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertados.push(v);
        return Promise.resolve();
      },
    }),
  }),
  schema: {
    offeredSlot: {
      organizationId: "offered_slot.organization_id",
      conversationId: "offered_slot.conversation_id",
      serviceId: "offered_slot.service_id",
      fecha: "offered_slot.fecha",
      hora: "offered_slot.hora",
    },
  },
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: (...a: unknown[]) => a }));

const base = { organizationId: "org_1", conversationId: "cv_1" };

describe("solo se agenda lo que se ofreció", () => {
  beforeEach(() => {
    filas = [];
    borrados.length = 0;
    insertados.length = 0;
  });

  it("acepta un horario que sí estaba entre los ofrecidos", async () => {
    filas = [
      { fecha: "07/08/2026", hora: "15:00" },
      { fecha: "07/08/2026", hora: "16:00" },
    ];
    const { estaEntreLosOfrecidos } = await import("@/server/appointments/queries");

    const r = await estaEntreLosOfrecidos({ ...base, fecha: "07/08/2026", hora: "16:00" });
    expect(r.ok).toBe(true);
  });

  /**
   * El caso que motiva todo: se ofreció el viernes y el modelo termina
   * agendando el miércoles porque interpretó mal "el miércoles". El hueco
   * puede estar libre — por eso `crearCita` sola no lo atrapa.
   */
  it("rechaza un horario que nunca se ofreció, y devuelve los que sí", async () => {
    filas = [{ fecha: "07/08/2026", hora: "15:00" }];
    const { estaEntreLosOfrecidos } = await import("@/server/appointments/queries");

    const r = await estaEntreLosOfrecidos({ ...base, fecha: "05/08/2026", hora: "15:00" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ofrecidos).toEqual([{ fecha: "07/08/2026", hora: "15:00" }]);
  });

  it("distingue la hora además de la fecha", async () => {
    filas = [{ fecha: "07/08/2026", hora: "15:00" }];
    const { estaEntreLosOfrecidos } = await import("@/server/appointments/queries");

    const r = await estaEntreLosOfrecidos({ ...base, fecha: "07/08/2026", hora: "18:00" });
    expect(r.ok).toBe(false);
  });

  /**
   * Sin nada ofrecido se deja pasar A PROPÓSITO: el cliente que pide día y
   * hora concretos y el agente agenda directo es un camino que hoy funciona,
   * y `crearCita` lo valida igual contra la disponibilidad real.
   */
  it("sin horarios ofrecidos, deja pasar (el camino directo sigue vivo)", async () => {
    filas = [];
    const { estaEntreLosOfrecidos } = await import("@/server/appointments/queries");

    const r = await estaEntreLosOfrecidos({ ...base, fecha: "07/08/2026", hora: "15:00" });
    expect(r.ok).toBe(true);
  });

  it("registrar lo ofrecido borra lo anterior antes de guardar", async () => {
    const { registrarOfrecidos } = await import("@/server/appointments/queries");

    await registrarOfrecidos({
      ...base,
      serviceIds: ["svc_1"],
      slots: [
        { fecha: "07/08/2026", hora: "15:00" },
        { fecha: "07/08/2026", hora: "16:00" },
      ],
    });

    expect(borrados).toHaveLength(1); // lo ofrecido antes ya no vale
    expect(insertados[0]).toHaveLength(2);
  });

  /**
   * Confirmación por servicio (docs/korexia/149): con varios servicios en la
   * misma visita se guarda una fila por CADA combinación (slot × servicio),
   * para poder comprobar después que la combinación agendada es la que se
   * consultó junta — no solo el primer servicio, como guardaba antes.
   */
  it("con varios servicios guarda una fila por combinación (slot × servicio)", async () => {
    const { registrarOfrecidos } = await import("@/server/appointments/queries");

    await registrarOfrecidos({
      ...base,
      serviceIds: ["svc_1", "svc_2"],
      slots: [
        { fecha: "07/08/2026", hora: "15:00" },
        { fecha: "07/08/2026", hora: "16:00" },
      ],
    });

    const filasInsertadas = insertados[0] as {
      serviceId: string;
      fecha: string;
      hora: string;
    }[];
    // 2 servicios × 2 horarios = 4 filas.
    expect(filasInsertadas).toHaveLength(4);
    // Cada horario aparece con AMBOS servicios.
    const porHorario = filasInsertadas.filter(
      (f) => f.fecha === "07/08/2026" && f.hora === "15:00"
    );
    expect(porHorario.map((f) => f.serviceId).sort()).toEqual(["svc_1", "svc_2"]);
  });

  it("sin horarios que ofrecer, solo borra y no inserta nada", async () => {
    const { registrarOfrecidos } = await import("@/server/appointments/queries");

    await registrarOfrecidos({ ...base, serviceIds: ["svc_1"], slots: [] });

    expect(borrados).toHaveLength(1);
    expect(insertados).toHaveLength(0);
  });

  it("sin servicios que ofrecer, solo borra y no inserta nada", async () => {
    const { registrarOfrecidos } = await import("@/server/appointments/queries");

    await registrarOfrecidos({
      ...base,
      serviceIds: [],
      slots: [{ fecha: "07/08/2026", hora: "15:00" }],
    });

    expect(borrados).toHaveLength(1);
    expect(insertados).toHaveLength(0);
  });

  /**
   * `serviciosOfrecidosPara` devuelve los ids DISTINCT registrados para una
   * fecha+hora exactas: es lo que `book_appointment` compara contra la
   * combinación que el modelo intenta agendar (docs/korexia/149).
   */
  it("serviciosOfrecidosPara devuelve los ids distintos de ese horario", async () => {
    // El mock de select devuelve `filas` tal cual; para esta consulta son
    // filas con `serviceId` (con un duplicado, para probar el DISTINCT).
    filas = [
      { serviceId: "svc_1" },
      { serviceId: "svc_2" },
      { serviceId: "svc_1" },
    ] as unknown as { fecha: string; hora: string }[];
    const { serviciosOfrecidosPara } = await import("@/server/appointments/queries");

    const ids = await serviciosOfrecidosPara("org_1", "cv_1", "07/08/2026", "15:00");
    expect(ids.sort()).toEqual(["svc_1", "svc_2"]);
  });

  it("serviciosOfrecidosPara devuelve vacío cuando no hay registro para ese horario", async () => {
    filas = [];
    const { serviciosOfrecidosPara } = await import("@/server/appointments/queries");

    const ids = await serviciosOfrecidosPara("org_1", "cv_1", "07/08/2026", "15:00");
    expect(ids).toEqual([]);
  });
});
