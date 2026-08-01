import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Vista de un cliente (tenant) para el panel de agencia. */
export type ClientSummary = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  accounts: number;
  conversations: number;
  unread: number;
  agentEnabled: boolean;
  phone: string | null;
  connectionStatus: "connected" | "reconnect_required" | null;
  /** true = el cliente trajo su propia cuenta de YCloud (no gasta cupo de la agencia). */
  ownAccount: boolean;
  /** true = vertical de citas (peluquería, estética…) en vez de pedidos. */
  appointmentsEnabled: boolean;
};

/**
 * Lista todas las organizaciones con sus métricas de cabecera.
 *
 * Es la ÚNICA lectura de la app que cruza tenants a propósito: solo la
 * alcanza el superadmin de la plataforma (gate en la capa de API) y no expone
 * contenido de conversaciones, solo conteos.
 */
export async function listClients(): Promise<ClientSummary[]> {
  const db = getDb();

  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt,
      agentEnabled: schema.agentProfile.enabled,
      appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
      phone: schema.metaCredentials.displayPhoneNumber,
      connectionStatus: schema.metaCredentials.status,
      // Señal de cuenta propia: el secreto de webhook solo se rellena cuando el
      // cliente trae su cuenta (cifrar el token vacío también produce datos,
      // así que ese campo no sirve de indicador). La credencial no sale de la BD.
      ownAccountSecret: schema.metaCredentials.webhookSecretCipher,
    })
    .from(schema.organization)
    .leftJoin(
      schema.agentProfile,
      eq(schema.agentProfile.organizationId, schema.organization.id)
    )
    .leftJoin(
      schema.metaCredentials,
      eq(schema.metaCredentials.organizationId, schema.organization.id)
    )
    .orderBy(desc(schema.organization.createdAt));

  const accounts = await db
    .select({
      organizationId: schema.member.organizationId,
      n: count(),
    })
    .from(schema.member)
    .groupBy(schema.member.organizationId);

  const conversations = await db
    .select({
      organizationId: schema.conversation.organizationId,
      n: count(),
      unread: sql<number>`coalesce(sum(${schema.conversation.unreadCount}), 0)`,
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.isTest, false))
    .groupBy(schema.conversation.organizationId);

  const accountsBy = new Map(accounts.map((r) => [r.organizationId, r.n]));
  const convBy = new Map(
    conversations.map((r) => [r.organizationId, { n: r.n, unread: Number(r.unread) }])
  );

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    createdAt: o.createdAt.toISOString(),
    accounts: accountsBy.get(o.id) ?? 0,
    conversations: convBy.get(o.id)?.n ?? 0,
    unread: convBy.get(o.id)?.unread ?? 0,
    agentEnabled: o.agentEnabled ?? false,
    phone: o.phone,
    connectionStatus: o.connectionStatus,
    ownAccount: Boolean(o.ownAccountSecret),
    appointmentsEnabled: o.appointmentsEnabled ?? false,
  }));
}

/** Cuentas de acceso de una organización (para el detalle del cliente). */
export async function listClientAccounts(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.member.id,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
      platformRole: schema.user.platformRole,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, organizationId));
}

export async function findOrganization(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** Organización propia del superadmin (su casa: la más antigua donde es miembro). */
export async function findHomeOrganizationId(
  userId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId)))
    .orderBy(schema.member.createdAt, schema.member.id)
    .limit(1);
  return rows[0]?.organizationId ?? null;
}
