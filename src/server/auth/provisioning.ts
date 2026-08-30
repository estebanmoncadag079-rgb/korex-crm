import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { arquitecturaAprobadaPara } from "@/server/auth/arquitectura";
import { verticalDe } from "@/server/vertical";

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
  /*
   * La arquitectura con la que nace TODO cliente nuevo — nunca decidida flag
   * por flag aquí. `arquitecturaAprobadaPara` es la única fuente de verdad
   * (compartida con `validarConfiguracionArquitectonica`): antes de esto,
   * este `insert` solo fijaba `appointmentsEnabled` y dejaba
   * `catalogSource`/`stateSource`/`paymentSource`/`consultasVerificadasEnabled`
   * en el valor más viejo de la columna, a la espera de que alguien los
   * encendiera a mano después (lo que le pasó a Malía con `stateSource`).
   */
  const vertical = verticalDe(input.needsAppointments ?? false);
  await tx.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId: input.organizationId,
    ...arquitecturaAprobadaPara(vertical),
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
}): Promise<{ userId: string; memberId: string }> {
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

  // El `memberId` se devuelve porque es lo que identifica a la cuenta en el
  // panel: sin él, la fila recién creada no se puede ni resetear ni borrar
  // hasta recargar la página.
  const db = getDb();
  const memberId = newId("organization");
  await db
    .insert(schema.member)
    .values({
      id: memberId,
      organizationId: input.organizationId,
      userId,
      role: input.role,
    })
    .onConflictDoNothing();

  return { userId, memberId };
}

export type ResetPasswordResult =
  | { ok: true; email: string; name: string }
  | { ok: false; reason: "not_found" | "is_platform_admin" };

/**
 * Le pone una contraseña nueva a la cuenta de un cliente que perdió la suya.
 *
 * Existe porque no hay ninguna otra salida: el login es correo y contraseña,
 * **no hay pantalla de "olvidé mi contraseña" ni servidor de correo** en la
 * instalación, así que hasta hoy un cliente bloqueado dependía de que alguien
 * entrara al servidor a reemplazarle el hash a mano. Un sábado por la noche,
 * eso es un negocio sin atender.
 *
 * Dos decisiones de seguridad:
 *
 * - **Solo cuentas de ese cliente.** El `memberId` se busca junto con su
 *   `organization_id`: pasar el identificador de una cuenta de otro negocio no
 *   encuentra nada, en vez de cambiarle la contraseña a un tercero.
 * - **Nunca a una cuenta de la agencia.** Este botón sirve para desbloquear
 *   clientes; si alguien llegara a robar una sesión de administrador, que no
 *   pueda además apoderarse de las cuentas internas.
 *
 * Se cierran las sesiones abiertas de esa cuenta: si el motivo real no fue un
 * olvido sino que alguien se metió, cambiar la clave sin echarlo lo dejaría
 * dentro.
 */
export async function resetAccountPassword(input: {
  organizationId: string;
  memberId: string;
  password: string;
}): Promise<ResetPasswordResult> {
  const db = getDb();

  const rows = await db
    .select({
      userId: schema.member.userId,
      email: schema.user.email,
      name: schema.user.name,
      platformRole: schema.user.platformRole,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(
      and(
        eq(schema.member.id, input.memberId),
        eq(schema.member.organizationId, input.organizationId)
      )
    )
    .limit(1);

  const account = rows[0];
  if (!account) return { ok: false, reason: "not_found" };
  if (account.platformRole === "superadmin") {
    return { ok: false, reason: "is_platform_admin" };
  }

  const ctx = await getAuth().$context;
  const hashed = await ctx.password.hash(input.password);
  await ctx.internalAdapter.updatePassword(account.userId, hashed);
  await ctx.internalAdapter.deleteUserSessions(account.userId);

  return { ok: true, email: account.email, name: account.name };
}

export type DeleteAccountResult =
  | { ok: true; email: string; name: string; freedEmail: boolean }
  | { ok: false; reason: "not_found" | "is_platform_admin" | "last_account" };

/**
 * Quita una cuenta de acceso de un cliente.
 *
 * Existe por el mismo motivo que `resetAccountPassword`: hasta el 15-ago-2026
 * no había forma de deshacer un alta. Una cuenta creada con el correo
 * equivocado se quedaba ahí para siempre —el 14-ago quedó una de pruebas como
 * *propietaria* de un cliente real—, y la única alternativa era entrar al
 * servidor a borrarla a mano.
 *
 * Las dos protecciones son las mismas del reseteo, y por las mismas razones:
 * solo cuentas **de ese cliente** (el `memberId` se busca junto con su
 * `organization_id`) y **nunca una cuenta de la agencia**.
 *
 * La tercera es propia: **no se puede borrar la última cuenta del cliente.**
 * Sin ella, un clic de más deja al negocio sin ninguna puerta de entrada y sin
 * forma de recuperarla —no hay pantalla de "olvidé mi contraseña"—. Las cuentas
 * de la agencia no cuentan como supervivientes: el cliente tiene que quedarse
 * con acceso **propio**. En la práctica obliga al orden correcto: primero se
 * crea la cuenta buena, después se borra la mala.
 *
 * **El correo se libera** cuando la cuenta no pertenece a ningún otro cliente:
 * se borra el usuario entero y el `ON DELETE CASCADE` se lleva credenciales,
 * membresías y sesiones. Si solo se quitara la membresía, el correo seguiría
 * ocupado y volver a darlo de alta fallaría con "ya existe una cuenta con ese
 * correo" — justo lo que se quiere hacer tras un alta equivocada. Si la persona
 * sí trabaja para otro cliente, se le retira únicamente este acceso.
 */
export async function deleteAccountFromOrganization(input: {
  organizationId: string;
  memberId: string;
}): Promise<DeleteAccountResult> {
  const db = getDb();

  const rows = await db
    .select({
      userId: schema.member.userId,
      email: schema.user.email,
      name: schema.user.name,
      platformRole: schema.user.platformRole,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(
      and(
        eq(schema.member.id, input.memberId),
        eq(schema.member.organizationId, input.organizationId)
      )
    )
    .limit(1);

  const account = rows[0];
  if (!account) return { ok: false, reason: "not_found" };
  if (account.platformRole === "superadmin") {
    return { ok: false, reason: "is_platform_admin" };
  }

  const delCliente = await db
    .select({
      id: schema.member.id,
      platformRole: schema.user.platformRole,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, input.organizationId));

  const quedan = delCliente.filter(
    (m) => m.id !== input.memberId && m.platformRole !== "superadmin"
  );
  if (quedan.length === 0) return { ok: false, reason: "last_account" };

  const enOtros = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, account.userId),
        ne(schema.member.organizationId, input.organizationId)
      )
    )
    .limit(1);

  if (enOtros[0]) {
    await db.delete(schema.member).where(eq(schema.member.id, input.memberId));
    // Trabaja para otro cliente: la cuenta sigue viva, pero la sesión abierta
    // todavía apunta a este tenant y hay que cortarla.
    const ctx = await getAuth().$context;
    await ctx.internalAdapter.deleteUserSessions(account.userId);
    return {
      ok: true,
      email: account.email,
      name: account.name,
      freedEmail: false,
    };
  }

  await db.delete(schema.user).where(eq(schema.user.id, account.userId));
  return {
    ok: true,
    email: account.email,
    name: account.name,
    freedEmail: true,
  };
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
