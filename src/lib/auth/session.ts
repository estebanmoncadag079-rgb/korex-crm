import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { findMembership, resolveMembership } from "@/server/auth/on-signup";

export type PlatformRole = "superadmin" | null;

export type SessionContext = {
  userId: string;
  /** Organización cuyos datos ve y modifica esta petición (el tenant activo). */
  organizationId: string;
  /** Rol dentro de esa organización: owner | member. */
  role: string;
  /** Rol de plataforma del usuario (agencia), independiente del tenant. */
  platformRole: PlatformRole;
  /** true si un superadmin está viendo la organización de un cliente. */
  impersonating: boolean;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Rol de plataforma del usuario (NULL para clientes y su equipo). */
async function getPlatformRole(userId: string): Promise<PlatformRole> {
  const db = getDb();
  const rows = await db
    .select({ platformRole: schema.user.platformRole })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return rows[0]?.platformRole ?? null;
}

async function organizationExists(organizationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return Boolean(rows[0]);
}

/**
 * Sesión + organización activa para route handlers y server components.
 *
 * El tenant activo sale de `session.activeOrganizationId`, pero SIEMPRE se
 * revalida contra la BD: un usuario normal solo entra donde tiene membresía;
 * un superadmin de la plataforma puede entrar en cualquier organización
 * (queda marcado como `impersonating`). Sin membresía ni permiso, se cae de
 * vuelta a su propia organización — nunca a la de otro.
 */
export async function requireSession(): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();

  const userId = session.user.id;
  const platformRole = await getPlatformRole(userId);
  const requested = session.session.activeOrganizationId ?? null;

  if (requested) {
    const membership = await findMembership(userId, requested);
    if (membership) {
      return {
        userId,
        organizationId: membership.organizationId,
        role: membership.role,
        platformRole,
        impersonating: false,
      };
    }
    // Superadmin dentro de la organización de un cliente: acceso de
    // propietario para poder operar y configurar en su nombre.
    if (platformRole === "superadmin" && (await organizationExists(requested))) {
      return {
        userId,
        organizationId: requested,
        role: "owner",
        platformRole,
        impersonating: true,
      };
    }
  }

  // La membresía en BD es la fuente de verdad (la sesión puede crearse antes
  // de que exista, durante el registro inicial).
  const own = await resolveMembership(userId);
  if (!own) throw new UnauthorizedError("Sesión sin organización activa");
  return {
    userId,
    organizationId: own.organizationId,
    role: own.role,
    platformRole,
    impersonating: false,
  };
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

/**
 * Cambia el tenant activo de la sesión en curso (panel de agencia).
 * Devuelve false si la sesión ya no existe.
 */
export async function setActiveOrganization(
  organizationId: string
): Promise<boolean> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return false;
  const db = getDb();
  await db
    .update(schema.session)
    .set({ activeOrganizationId: organizationId, updatedAt: new Date() })
    .where(eq(schema.session.id, session.session.id));
  return true;
}
