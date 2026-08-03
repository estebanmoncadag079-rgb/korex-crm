import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getOrCreateContact debe identificar al contacto por `waUserId` cuando no
 * hay teléfono (cliente con nombre de usuario de WhatsApp, 2026), sin
 * inventar ni exigir un teléfono, y sin duplicar el contacto en cada mensaje
 * nuevo de la misma persona (índice de conflicto correcto según el caso).
 */

const inserted: { values: unknown; target: unknown }[] = [];
let insertReturns: unknown[] = [];
let selectQueue: unknown[][] = [];

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoNothing: (opts: { target: unknown }) => ({
          returning: () => {
            inserted.push({ values, target: opts?.target });
            return Promise.resolve(insertReturns);
          },
        }),
      }),
    }),
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }),
  }),
  schema: {
    contact: {
      organizationId: "contact.organizationId",
      phone: "contact.phone",
      waUserId: "contact.waUserId",
      archivedAt: "contact.archivedAt",
    },
  },
}));

describe("contactos identificados solo por nombre de usuario de WhatsApp", () => {
  beforeEach(() => {
    inserted.length = 0;
    insertReturns = [];
    selectQueue = [];
  });

  it("crea el contacto con phone null cuando solo llega waUserId", async () => {
    insertReturns = [
      {
        id: "ct_1",
        organizationId: "org_1",
        phone: null,
        waUserId: "CO.abc123",
        name: "CO.abc123",
        archivedAt: null,
      },
    ];

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    const { contact, isNew } = await getOrCreateContact("org_1", {
      phone: null,
      waUserId: "CO.abc123",
    });

    expect(isNew).toBe(true);
    expect(contact.phone).toBeNull();
    expect(contact.waUserId).toBe("CO.abc123");
    // el conflicto se resuelve por el índice de wa_user_id, no el de teléfono
    expect(inserted[0]?.target).toEqual([
      "contact.organizationId",
      "contact.waUserId",
    ]);
    expect(inserted[0]?.values).toMatchObject({
      organizationId: "org_1",
      phone: null,
      waUserId: "CO.abc123",
    });
  });

  it("si ya existe, lo encuentra por waUserId en vez de duplicarlo", async () => {
    insertReturns = []; // conflicto: el insert no devuelve fila
    selectQueue.push([
      {
        id: "ct_1",
        organizationId: "org_1",
        phone: null,
        waUserId: "CO.abc123",
        name: "Cliente",
        archivedAt: null,
      },
    ]);

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    const { contact, isNew } = await getOrCreateContact("org_1", {
      phone: null,
      waUserId: "CO.abc123",
    });

    expect(isNew).toBe(false);
    expect(contact.id).toBe("ct_1");
  });

  it("con teléfono, el conflicto se sigue resolviendo por el índice de teléfono", async () => {
    insertReturns = [
      {
        id: "ct_2",
        organizationId: "org_1",
        phone: "573001112233",
        waUserId: null,
        name: "Cliente",
        archivedAt: null,
      },
    ];

    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    await getOrCreateContact("org_1", {
      phone: "573001112233",
      waUserId: null,
    });

    expect(inserted[0]?.target).toEqual([
      "contact.organizationId",
      "contact.phone",
    ]);
  });

  it("sin phone ni waUserId, lanza en vez de crear un contacto fantasma", async () => {
    const { getOrCreateContact } = await import("@/server/inbox/ingest");
    await expect(
      getOrCreateContact("org_1", { phone: null, waUserId: null })
    ).rejects.toThrow();
  });
});
