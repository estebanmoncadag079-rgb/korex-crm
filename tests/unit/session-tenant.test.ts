import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aislamiento entre clientes en la sesión: el tenant activo que pide el
 * navegador SIEMPRE se revalida contra la BD. Un cliente solo entra donde
 * tiene membresía; solo el superadmin de la plataforma (la agencia) puede
 * entrar en la organización de otro, y queda marcado.
 */

type Membership = { userId: string; organizationId: string; role: string };

const state = {
  sessionUserId: "u_cliente",
  activeOrganizationId: null as string | null,
  platformRole: null as string | null,
  organizations: ["org_churra", "org_otro", "org_agencia"],
  memberships: [] as Membership[],
};

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => ({
        user: { id: state.sessionUserId },
        session: {
          id: "sess_1",
          activeOrganizationId: state.activeOrganizationId,
        },
      }),
    },
  }),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async () => {
            if (table.__table === "user") {
              return [{ platformRole: state.platformRole }];
            }
            if (table.__table === "organization") {
              // el filtro real es por id; el mock devuelve la existencia
              return state.organizations.length ? [{ id: "org" }] : [];
            }
            return [];
          },
        }),
      }),
    }),
  }),
  schema: {
    user: { __table: "user", id: "id", platformRole: "platform_role" },
    organization: { __table: "organization", id: "id" },
    session: { __table: "session", id: "id" },
  },
}));

vi.mock("@/server/auth/on-signup", () => ({
  findMembership: async (userId: string, organizationId: string) =>
    state.memberships.find(
      (m) => m.userId === userId && m.organizationId === organizationId
    ) ?? null,
  resolveMembership: async (userId: string) =>
    state.memberships.find((m) => m.userId === userId) ?? null,
}));

import { requireSession, UnauthorizedError } from "@/lib/auth/session";

beforeEach(() => {
  state.sessionUserId = "u_cliente";
  state.activeOrganizationId = null;
  state.platformRole = null;
  state.organizations = ["org_churra", "org_otro", "org_agencia"];
  state.memberships = [
    { userId: "u_cliente", organizationId: "org_churra", role: "owner" },
    { userId: "u_agencia", organizationId: "org_agencia", role: "owner" },
  ];
});

describe("organización activa de la sesión", () => {
  it("el cliente entra en su propia organización", async () => {
    state.activeOrganizationId = "org_churra";
    const session = await requireSession();
    expect(session.organizationId).toBe("org_churra");
    expect(session.role).toBe("owner");
    expect(session.impersonating).toBe(false);
  });

  it("un cliente NO puede activar la organización de otro: cae en la suya", async () => {
    state.activeOrganizationId = "org_otro";
    const session = await requireSession();
    expect(session.organizationId).toBe("org_churra");
    expect(session.impersonating).toBe(false);
    expect(session.platformRole).toBeNull();
  });

  it("sin organización activa, se usa su membresía", async () => {
    state.activeOrganizationId = null;
    const session = await requireSession();
    expect(session.organizationId).toBe("org_churra");
  });

  it("el superadmin entra en la organización de un cliente y queda marcado", async () => {
    state.sessionUserId = "u_agencia";
    state.platformRole = "superadmin";
    state.activeOrganizationId = "org_churra";

    const session = await requireSession();
    expect(session.organizationId).toBe("org_churra");
    expect(session.role).toBe("owner");
    expect(session.impersonating).toBe(true);
    expect(session.platformRole).toBe("superadmin");
  });

  it("el superadmin en su propia casa no cuenta como suplantación", async () => {
    state.sessionUserId = "u_agencia";
    state.platformRole = "superadmin";
    state.activeOrganizationId = "org_agencia";

    const session = await requireSession();
    expect(session.organizationId).toBe("org_agencia");
    expect(session.impersonating).toBe(false);
  });

  it("sin ninguna membresía → no autenticado", async () => {
    state.sessionUserId = "u_huerfano";
    state.activeOrganizationId = null;
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
