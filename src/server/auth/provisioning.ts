import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getAuth, runInternalSignup } from "@/lib/auth";

/**
 * Alta de organizaciones (tenants). Una organización = un cliente de la
 * agencia: sus contactos, conversaciones, embudo y agente viven aisladas por
 * `organization_id` (Constitución III), así que dar de alta un cliente es
 * exactamente crear su organización sembrada + su cuenta propietaria.
 */

/**
 * Etapas sembradas del pipeline (US2).
 *
 * El ancla `lost` se llama **"Por recuperar"** y no "Perdido" (9-ago-2026):
 * ahí caen solos los leads que llevan dos días sin responder
 * (`DIAS_PARA_ENFRIAR`), y casi ninguno está perdido de verdad — son gente a la
 * que hay que ir a buscar. El nombre es solo una etiqueta que cada cliente
 * puede cambiar desde el tablero; la lógica mira `kind`.
 */
export const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Por recuperar", kind: "lost" },
];

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Inserta la organización con su embudo y su perfil de agente vacío. */
export async function provisionOrganization(
  tx: Tx,
  input: {
    organizationId: string;
    name: string;
    slug: string;
    /** true = vertical de citas (peluquería, estética…) en vez de pedidos. */
    needsAppointments?: boolean;
  }
): Promise<void> {
  await tx.insert(schema.organization).values({
    id: input.organizationId,
    name: input.name,
    slug: input.slug,
  });
  await tx.insert(schema.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId: input.organizationId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  await tx.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId: input.organizationId,
    appointmentsEnabled: input.needsAppointments ?? false,
  });
}

export class ProvisioningError extends Error {
  code: "duplicate_email" | "duplicate_slug" | "invalid";

  constructor(code: ProvisioningError["code"], message: string) {
    super(message);
    this.name = "ProvisioningError";
    this.code = code;
  }
}

/** Slug normalizado y único (sufijo numérico si ya existe). */
export async function uniqueSlug(base: string): Promise<string> {
  const db = getDb();
  const normalized =
    base
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cliente";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? normalized : `${normalized}-${i + 1}`;
    const taken = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, candidate))
      .limit(1);
    if (!taken[0]) return candidate;
  }
  throw new ProvisioningError("duplicate_slug", "No se pudo generar un slug libre");
}

/**
 * Crea una cuenta de acceso y la hace miembro de una organización existente.
 * Sin correos ni invitaciones (Constitución II): la contraseña temporal se
 * entrega a mano y el usuario la cambia después.
 */
export async function createAccountInOrganization(input: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  role: "owner" | "member";
}): Promise<{ userId: string }> {
  const auth = getAuth();
  let userId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: input.name,
          email: input.email,
          password: input.password,
        },
      })
    );
    userId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      throw new ProvisioningError(
        "duplicate_email",
        "Ya existe una cuenta con ese correo"
      );
    }
    throw new ProvisioningError("invalid", message);
  }

  const db = getDb();
  await db
    .insert(schema.member)
    .values({
      id: newId("organization"),
      organizationId: input.organizationId,
      userId,
      role: input.role,
    })
    .onConflictDoNothing();

  return { userId };
}

/**
 * Da de alta un cliente completo: organización sembrada + cuenta propietaria.
 *
 * Si la cuenta falla (correo repetido), la organización recién creada se
 * elimina para no dejar tenants huérfanos.
 */
export async function createClientWithOwner(input: {
  organizationName: string;
  slug?: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  needsAppointments?: boolean;
}): Promise<{ organizationId: string; userId: string; slug: string }> {
  const db = getDb();
  const slug = await uniqueSlug(input.slug || input.organizationName);
  const organizationId = newId("organization");

  await db.transaction(async (tx) => {
    await provisionOrganization(tx, {
      organizationId,
      name: input.organizationName,
      slug,
      needsAppointments: input.needsAppointments,
    });
  });

  try {
    const { userId } = await createAccountInOrganization({
      organizationId,
      name: input.ownerName,
      email: input.ownerEmail,
      password: input.password,
      role: "owner",
    });
    return { organizationId, userId, slug };
  } catch (err) {
    // Rollback manual: el alta del usuario vive fuera de la transacción
    // (Better Auth abre su propia conexión).
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, organizationId));
    throw err;
  }
}
