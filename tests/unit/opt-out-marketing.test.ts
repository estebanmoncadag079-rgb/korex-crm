import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Fase 3D (auditoría de campañas, 1-sep-2026): la barrera de opt-out de
 * marketing, construida ANTES de que exista cualquier envío real (Fase 3G).
 * Ningún test de este archivo toca WhatsApp, `sendTemplate()` ni ninguna
 * cola — solo la regla de elegibilidad y su consulta.
 */

describe("esElegibleParaMarketing: regla pura de elegibilidad", () => {
  it("un contacto normal (no archivado, sin opt-out) es elegible", async () => {
    const { esElegibleParaMarketing } = await import("@/server/contacts");
    expect(
      esElegibleParaMarketing({ archivedAt: null, marketingOptOut: false })
    ).toBe(true);
  });

  it("un contacto archivado nunca es elegible, tenga o no opt-out", async () => {
    const { esElegibleParaMarketing } = await import("@/server/contacts");
    expect(
      esElegibleParaMarketing({ archivedAt: new Date(), marketingOptOut: false })
    ).toBe(false);
    expect(
      esElegibleParaMarketing({ archivedAt: new Date(), marketingOptOut: true })
    ).toBe(false);
  });

  it("un contacto con opt-out nunca es elegible, esté o no archivado", async () => {
    const { esElegibleParaMarketing } = await import("@/server/contacts");
    expect(
      esElegibleParaMarketing({ archivedAt: null, marketingOptOut: true })
    ).toBe(false);
  });
});

/* ============================================================
 * contactosElegiblesParaMarketing(): el WHERE real que llega a Postgres.
 *
 * Igual que tests/unit/tenant.test.ts: se deja `scoped()` REAL (sin mock) y
 * se inspecciona el SQL generado con PgDialect — así se prueba lo que de
 * verdad se le manda a la base, no solo con qué argumentos se llamó a un
 * mock.
 * ============================================================ */

let capturedWhere: SQL | undefined;
const rowsToReturn = vi.fn<() => unknown[]>(() => []);

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (cond: SQL) => {
            capturedWhere = cond;
            const rows = rowsToReturn();
            // Thenable + `.limit()`: `contactosElegiblesParaMarketing` hace
            // `await ...where(...)` directo, pero `getContactById` (usado
            // por `tieneOptOutDeMarketing`) encadena `.limit(1)` — el mismo
            // mock debe servir a las dos formas de la cadena.
            const chain = Promise.resolve(rows) as Promise<unknown[]> & {
              limit: (n: number) => Promise<unknown[]>;
            };
            chain.limit = () => Promise.resolve(rows);
            return chain;
          },
        }),
      }),
    }),
  };
});

describe("contactosElegiblesParaMarketing: construye el filtro correcto", () => {
  beforeEach(() => {
    capturedWhere = undefined;
    rowsToReturn.mockReset().mockReturnValue([]);
  });

  it("el WHERE real exige organización, no archivado y sin opt-out", async () => {
    const { contactosElegiblesParaMarketing } = await import("@/server/contacts");
    await contactosElegiblesParaMarketing("org_a");

    expect(capturedWhere).toBeDefined();
    const query = new PgDialect().sqlToQuery(capturedWhere!);
    expect(query.sql).toContain("organization_id");
    expect(query.sql).toContain("archived_at");
    expect(query.sql).toContain("marketing_opt_out");
    expect(query.sql.toLowerCase()).toContain("is null"); // archivedAt
    expect(query.params).toContain("org_a");
    expect(query.params).toContain(false); // marketingOptOut = false
  });

  it("dos organizaciones distintas generan WHERE con su propio organizationId — nunca se cruzan", async () => {
    const { contactosElegiblesParaMarketing } = await import("@/server/contacts");

    await contactosElegiblesParaMarketing("org_a");
    const queryA = new PgDialect().sqlToQuery(capturedWhere!);
    expect(queryA.params).toContain("org_a");
    expect(queryA.params).not.toContain("org_b");

    await contactosElegiblesParaMarketing("org_b");
    const queryB = new PgDialect().sqlToQuery(capturedWhere!);
    expect(queryB.params).toContain("org_b");
    expect(queryB.params).not.toContain("org_a");
  });

  it("organizationId vacío lanza — nunca se puede construir una audiencia sin tenant", async () => {
    const { contactosElegiblesParaMarketing } = await import("@/server/contacts");
    await expect(contactosElegiblesParaMarketing("")).rejects.toThrow(/sin tenant/);
  });

  it("devuelve exactamente las filas que la base entrega, si tienen un canal real", async () => {
    const fila = { id: "ct_1", organizationId: "org_a", marketingOptOut: false, phone: "573001112233", waUserId: null };
    rowsToReturn.mockReturnValue([fila]);
    const { contactosElegiblesParaMarketing } = await import("@/server/contacts");
    const resultado = await contactosElegiblesParaMarketing("org_a");
    expect(resultado).toEqual([fila]);
  });

  /**
   * Fase 10E — sin esto, un contacto sin ningún canal real pasaba la
   * elegibilidad y `resolveRecipient()` fallaba recién en el worker de
   * campañas, que revierte el job a `pending` SIN marcarlo `failed` (esa
   * rama es solo para precondiciones, no para respuestas del proveedor) —
   * el mismo recipient se reclamaba una y otra vez sin poder cerrarse
   * nunca. El filtro aquí, antes de crear el `campaign_recipient`, es lo
   * que lo cierra de raíz.
   */
  it("un contacto SIN teléfono ni waUserId (sin canal real) queda excluido, aunque la base lo devuelva", async () => {
    const sinCanal = { id: "ct_sin_canal", organizationId: "org_a", marketingOptOut: false, phone: null, waUserId: null };
    const conTelefono = { id: "ct_1", organizationId: "org_a", marketingOptOut: false, phone: "573001112233", waUserId: null };
    const conWaUserId = { id: "ct_2", organizationId: "org_a", marketingOptOut: false, phone: null, waUserId: "CO.abc123" };
    rowsToReturn.mockReturnValue([sinCanal, conTelefono, conWaUserId]);
    const { contactosElegiblesParaMarketing } = await import("@/server/contacts");
    const resultado = await contactosElegiblesParaMarketing("org_a");
    expect(resultado.map((r) => (r as { id: string }).id).sort()).toEqual(["ct_1", "ct_2"]);
  });
});

describe("tieneCanalUtilizable: regla pura", () => {
  it("teléfono solo, waUserId solo, o ambos → true", async () => {
    const { tieneCanalUtilizable } = await import("@/server/contacts");
    expect(tieneCanalUtilizable({ phone: "573001112233", waUserId: null })).toBe(true);
    expect(tieneCanalUtilizable({ phone: null, waUserId: "CO.abc" })).toBe(true);
    expect(tieneCanalUtilizable({ phone: "573001112233", waUserId: "CO.abc" })).toBe(true);
  });

  it("ninguno de los dos, o solo espacios en blanco → false", async () => {
    const { tieneCanalUtilizable } = await import("@/server/contacts");
    expect(tieneCanalUtilizable({ phone: null, waUserId: null })).toBe(false);
    expect(tieneCanalUtilizable({ phone: "   ", waUserId: "" })).toBe(false);
  });
});

/* ============================================================
 * tieneOptOutDeMarketing(): la segunda barrera (sin consumidor todavía,
 * lista para cuando exista el motor de envío en la Fase 3G).
 * ============================================================ */

describe("tieneOptOutDeMarketing: relee el estado actual, no confía en un snapshot", () => {
  beforeEach(() => {
    capturedWhere = undefined;
    rowsToReturn.mockReset().mockReturnValue([]);
  });

  it("contacto con opt-out en la base → true", async () => {
    rowsToReturn.mockReturnValue([
      { id: "ct_1", organizationId: "org_a", marketingOptOut: true },
    ]);
    const { tieneOptOutDeMarketing } = await import("@/server/contacts");
    expect(await tieneOptOutDeMarketing("org_a", "ct_1")).toBe(true);
  });

  it("contacto sin opt-out en la base → false", async () => {
    rowsToReturn.mockReturnValue([
      { id: "ct_1", organizationId: "org_a", marketingOptOut: false },
    ]);
    const { tieneOptOutDeMarketing } = await import("@/server/contacts");
    expect(await tieneOptOutDeMarketing("org_a", "ct_1")).toBe(false);
  });

  it("contacto inexistente → true (fail-closed: nunca enviar si no se puede confirmar)", async () => {
    rowsToReturn.mockReturnValue([]);
    const { tieneOptOutDeMarketing } = await import("@/server/contacts");
    expect(await tieneOptOutDeMarketing("org_a", "ct_fantasma")).toBe(true);
  });
});
