import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 3D: el endpoint PATCH /api/contacts/[id] es la única vía para
 * activar/desactivar el opt-out de marketing — mismo patrón ya usado para
 * `archived` (un booleano de entrada, el timestamp lo pone el servidor).
 *
 * El aislamiento multi-tenant NO se prueba mockeando `scoped()` con un
 * "acepta lo que sea": se simula un STORE con contactos de dos
 * organizaciones y se confirma que el WHERE real (organización + id)
 * nunca deja que una sesión de A toque una fila de B.
 */

type Row = {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  waUserId: string | null;
  notes: string | null;
  archivedAt: Date | null;
  marketingOptOut: boolean;
  marketingOptOutAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let STORE: Row[] = [];
let sessionOrgId = "org_a";

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({
    organizationId: sessionOrgId,
    userId: "u1",
    role: "owner",
    platformRole: null,
    impersonating: false,
  }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

// Solo `eq` se reemplaza (único combinador que usa el PATCH real, sobre
// `schema.contact.id`) — el resto de drizzle-orm queda intacto.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (_col: unknown, val: string) => ({ __eqVal: val }) };
});

vi.mock("@/lib/db/tenant", () => ({
  scoped: (
    _col: unknown,
    organizationId: string,
    ...conds: Array<{ __eqVal?: string } | undefined>
  ) => ({
    organizationId,
    id: conds.find((c) => c && "__eqVal" in c)?.__eqVal,
  }),
}));

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    getDb: () => ({
      update: () => ({
        set: (values: Partial<Row>) => ({
          where: (cond: { organizationId: string; id?: string }) => ({
            returning: async () => {
              const idx = STORE.findIndex(
                (r) => r.organizationId === cond.organizationId && r.id === cond.id
              );
              if (idx === -1) return [];
              STORE[idx] = { ...STORE[idx], ...values } as Row;
              return [STORE[idx]];
            },
          }),
        }),
      }),
    }),
  };
});

function fila(over: Partial<Row>): Row {
  return {
    id: "ct_1",
    organizationId: "org_a",
    name: "Valentina",
    phone: "573001112233",
    waUserId: null,
    notes: null,
    archivedAt: null,
    marketingOptOut: false,
    marketingOptOutAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

function patchRequest(body: Record<string, unknown>): Request {
  return new Request("http://local/api/contacts/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/contacts/[id]: opt-out de marketing", () => {
  beforeEach(() => {
    sessionOrgId = "org_a";
    STORE = [
      fila({ id: "ct_a1", organizationId: "org_a" }),
      fila({ id: "ct_b1", organizationId: "org_b", name: "Cliente de B" }),
    ];
  });

  it("A — contacto recién creado: marketingOptOut es false por defecto", async () => {
    const { serializeContact } = await import("@/server/contacts");
    expect(serializeContact(fila({}))).toMatchObject({
      marketingOptOut: false,
      marketingOptOutAt: null,
    });
  });

  it("B — activar: false → true, y marketingOptOutAt queda con la fecha actual", async () => {
    const { PATCH } = await import("@/app/api/contacts/[id]/route");
    const res = await PATCH(patchRequest({ marketingOptOut: true }), {
      params: Promise.resolve({ id: "ct_a1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contact: { marketingOptOut: boolean; marketingOptOutAt: string | null } };
    expect(body.contact.marketingOptOut).toBe(true);
    expect(body.contact.marketingOptOutAt).not.toBeNull();
  });

  it("C — desactivar: true → false, y marketingOptOutAt vuelve a null", async () => {
    STORE[0]!.marketingOptOut = true;
    STORE[0]!.marketingOptOutAt = new Date("2026-08-01");

    const { PATCH } = await import("@/app/api/contacts/[id]/route");
    const res = await PATCH(patchRequest({ marketingOptOut: false }), {
      params: Promise.resolve({ id: "ct_a1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contact: { marketingOptOut: boolean; marketingOptOutAt: string | null } };
    expect(body.contact.marketingOptOut).toBe(false);
    expect(body.contact.marketingOptOutAt).toBeNull();
  });

  it("H — actualización parcial: cambiar solo las notas no toca el opt-out existente", async () => {
    STORE[0]!.marketingOptOut = true;
    STORE[0]!.marketingOptOutAt = new Date("2026-08-01");

    const { PATCH } = await import("@/app/api/contacts/[id]/route");
    const res = await PATCH(patchRequest({ notes: "nueva nota" }), {
      params: Promise.resolve({ id: "ct_a1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contact: { notes: string | null; marketingOptOut: boolean; marketingOptOutAt: string | null };
    };
    expect(body.contact.notes).toBe("nueva nota");
    expect(body.contact.marketingOptOut).toBe(true);
    expect(body.contact.marketingOptOutAt).not.toBeNull();
  });

  it("G/I — una sesión de la organización A nunca puede modificar un contacto de B", async () => {
    sessionOrgId = "org_a";
    const { PATCH } = await import("@/app/api/contacts/[id]/route");
    const res = await PATCH(patchRequest({ marketingOptOut: true }), {
      params: Promise.resolve({ id: "ct_b1" }),
    });
    expect(res.status).toBe(404);
    // La fila de B queda intacta — el intento de A nunca la tocó.
    expect(STORE.find((r) => r.id === "ct_b1")!.marketingOptOut).toBe(false);
  });

  it("G — la organización B, en su propia sesión, sí puede modificar su propio contacto", async () => {
    sessionOrgId = "org_b";
    const { PATCH } = await import("@/app/api/contacts/[id]/route");
    const res = await PATCH(patchRequest({ marketingOptOut: true }), {
      params: Promise.resolve({ id: "ct_b1" }),
    });
    expect(res.status).toBe(200);
    expect(STORE.find((r) => r.id === "ct_b1")!.marketingOptOut).toBe(true);
    // Y A sigue sin verse afectada.
    expect(STORE.find((r) => r.id === "ct_a1")!.marketingOptOut).toBe(false);
  });
});
