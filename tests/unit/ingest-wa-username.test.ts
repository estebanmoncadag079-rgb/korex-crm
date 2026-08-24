import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Identidad del contacto: teléfono, BSUID (nombre de usuario de WhatsApp,
 * 2026) o —lo normal— los dos a la vez.
 *
 * `getOrCreateContact` tiene que reconocer a la persona por CUALQUIERA de las
 * dos señales y rellenar la que llegue tarde. Antes elegía una sola de
 * antemano, y por eso el mismo cliente podía nacer dos veces cuando Meta
 * cambiaba de señal: historial partido y el agente saludándolo como
 * desconocido (ver docs/korexia/25-UPSTREAM-VOCERO.md).
 */

const inserted: unknown[] = [];
const updated: { id: unknown; set: Record<string, unknown> }[] = [];
let insertReturns: unknown[] = [];
/** Filas que devuelve cada `select` en orden (una entrada por llamada). */
let selectQueue: unknown[][] = [];

/** El candidato elegido, sobre el que el código aplica el `update`. */
let elegido: Record<string, unknown> = {};

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.orderBy = () => {
    elegido = (rows[0] ?? {}) as Record<string, unknown>;
    return Promise.resolve(rows);
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            inserted.push(values);
            return Promise.resolve(insertReturns);
          },
        }),
      }),
    }),
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (id: unknown) => ({
          returning: () => {
            updated.push({ id, set });
            return Promise.resolve([{ ...elegido, ...set }]);
          },
        }),
      }),
    }),
  }),
  schema: {
    contact: {
      organizationId: "contact.organizationId",
      phone: "contact.phone",
      waUserId: "contact.waUserId",
      archivedAt: "contact.archivedAt",
      createdAt: "contact.createdAt",
      id: "contact.id",
    },
  },
}));

const soloBsuid = {
  id: "ct_1",
  organizationId: "org_1",
  phone: null,
  waUserId: "CO.abc123",
  name: "Nathalia",
  archivedAt: null,
};

const soloTelefono = {
  id: "ct_2",
  organizationId: "org_1",
  phone: "573165345762",
  waUserId: null,
  name: "Heidy Chinguad",
  archivedAt: null,
};

describe("identidad del contacto: teléfono, BSUID o ambos", () => {
  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
    insertReturns = [];
    selectQueue = [];
    elegido = {};
  });

  it("crea el contacto con phone null cuando solo llega waUserId", async () => {
    selectQueue.push([]); // no existe todavía
    insertReturns = [{ ...soloBsuid, name: "CO.abc123" }];

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    const { contact, isNew } = await getOrCreateContact("org_1", {
      phone: null,
      waUserId: "CO.abc123",
    });

    expect(isNew).toBe(true);
    expect(contact.phone).toBeNull();
    expect(contact.waUserId).toBe("CO.abc123");
    expect(inserted[0]).toMatchObject({ phone: null, waUserId: "CO.abc123" });
  });

  it("si ya existe, lo encuentra por waUserId en vez de duplicarlo", async () => {
    selectQueue.push([soloBsuid]);

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    const { contact, isNew } = await getOrCreateContact("org_1", {
      phone: null,
      waUserId: "CO.abc123",
    });

    expect(isNew).toBe(false);
    expect(contact.id).toBe("ct_1");
    expect(inserted).toHaveLength(0);
  });

  /**
   * El caso real de Nathalia y Marii: quedaron guardadas SOLO por BSUID, sin
   * teléfono. Cuando Meta manda el evento con las dos señales, el teléfono
   * tiene que caer sobre el contacto que ya existe.
   */
  it("rellena el teléfono que faltaba en un contacto guardado solo por BSUID", async () => {
    selectQueue.push([soloBsuid]);

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    const { contact, isNew } = await getOrCreateContact("org_1", {
      phone: "573001112233",
      waUserId: "CO.abc123",
    });

    expect(isNew).toBe(false);
    expect(inserted).toHaveLength(0); // no duplica
    expect(updated[0]?.set).toMatchObject({ phone: "573001112233" });
    expect(contact.phone).toBe("573001112233");
  });

  /**
   * El espejo, y el que previene el duplicado futuro: el contacto nació con
   * teléfono (Heidy) y ahora llega también su BSUID. Guardarlo AHORA es lo
   * que evita que nazca un contacto nuevo el día que Meta deje de mandar
   * `from`.
   */
  it("rellena el BSUID que faltaba en un contacto guardado solo por teléfono", async () => {
    selectQueue.push([soloTelefono]);

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    await getOrCreateContact("org_1", {
      phone: "573165345762",
      waUserId: "CO.1031124232991481",
    });

    expect(inserted).toHaveLength(0);
    expect(updated[0]?.set).toMatchObject({ waUserId: "CO.1031124232991481" });
  });

  it("no pisa una señal ya guardada ni escribe de más si no falta nada", async () => {
    selectQueue.push([{ ...soloTelefono, waUserId: "CO.viejo" }]);

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    await getOrCreateContact("org_1", {
      phone: "573165345762",
      waUserId: "CO.nuevo",
    });

    expect(updated).toHaveLength(0);
  });

  /**
   * Defensa por si ya existían duplicados de antes: se usa el más antiguo (el
   * que tiene el historial) y queda el aviso, en vez de mover mensajes,
   * conversaciones y citas por su cuenta.
   *
   * 🔴 Y sobre todo: **no intenta rellenar la señal que falta en el elegido
   * con un valor que ya es del OTRO candidato.** Antes de este arreglo
   * (24-ago-2026) sí lo intentaba — `UPDATE ... SET waUserId = 'CO.abc123'`
   * sobre `ct_2`, cuando esa señal ya era de `ct_1` — y contra la base real
   * eso chocaba con el índice único y tumbaba el webhook ENTERO: 87 eventos
   * en 18 días, 44 mensajes reales de clientas perdidos sin dejar una fila
   * (docs/korexia/126). Aquí, sin base real, se prueba que el código ya no
   * intenta ese `update`.
   */
  it("con dos contactos para la misma persona, usa el más antiguo, avisa y NO intenta rellenar con la señal del otro", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    selectQueue.push([soloTelefono, soloBsuid]); // ordenados por created_at

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    const { contact } = await getOrCreateContact("org_1", {
      phone: "573165345762", // ya es de soloTelefono (el elegido): no falta
      waUserId: "CO.abc123", // ya es de soloBsuid, NO del elegido: es el crash real
    });

    expect(contact.id).toBe("ct_2");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("MISMA PERSONA EN DOS CONTACTOS")
    );
    expect(updated).toHaveLength(0); // NINGÚN update — esto es lo que crasheaba
    warn.mockRestore();
  });

  it("reactiva un contacto archivado en vez de crear otro", async () => {
    selectQueue.push([{ ...soloTelefono, archivedAt: new Date() }]);

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    await getOrCreateContact("org_1", { phone: "573165345762", waUserId: null });

    expect(inserted).toHaveLength(0);
    expect(updated[0]?.set).toMatchObject({ archivedAt: null });
  });

  it("sin phone ni waUserId, lanza en vez de crear un contacto fantasma", async () => {
    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    await expect(
      getOrCreateContact("org_1", { phone: null, waUserId: null })
    ).rejects.toThrow();
  });
});
