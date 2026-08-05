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
      serviceId: "svc_1",
      slots: [
        { fecha: "07/08/2026", hora: "15:00" },
        { fecha: "07/08/2026", hora: "16:00" },
      ],
    });

    expect(borrados).toHaveLength(1); // lo ofrecido antes ya no vale
    expect(insertados[0]).toHaveLength(2);
  });

  it("sin horarios que ofrecer, solo borra y no inserta nada", async () => {
    const { registrarOfrecidos } = await import("@/server/appointments/queries");

    await registrarOfrecidos({ ...base, serviceId: "svc_1", slots: [] });

    expect(borrados).toHaveLength(1);
    expect(insertados).toHaveLength(0);
  });
});
