import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * Eliminar una cuenta de acceso desde el panel, contra Postgres real
 * (15-ago-2026).
 *
 * Va aquí y no en las unitarias porque lo que hay que demostrar es lo que pasa
 * **en la base**: que el `ON DELETE CASCADE` se lleva credenciales y sesiones,
 * y sobre todo que el correo queda libre para volver a usarlo. Un doble no
 * probaría ninguna de las dos cosas.
 *
 * Existe porque hasta hoy un alta equivocada no se podía deshacer: el 14-ago
 * una cuenta de pruebas se quedó como *propietaria* de un cliente real y hubo
 * que entrar al servidor a borrarla a mano.
 */

const F = {
  orgA: "org_test_del_a",
  orgB: "org_test_del_b",
  duenaA: "duena.del.a@ejemplo-test.com",
  duenaB: "duena.del.b@ejemplo-test.com",
  emailAdmin: "agencia.del@ejemplo-test.com",
  sobrante: "sobrante.del@ejemplo-test.com",
  compartida: "compartida.del@ejemplo-test.com",
  clave: "ClaveDeTest123",
};

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;
let orgA: string;
let orgB: string;
let orgAdmin: string;
let miembroDuenaA: string;
let miembroAdmin: string;

async function orgDe(email: string): Promise<string> {
  const filas = (await db.execute(sql`
    SELECT m.organization_id AS id FROM member m
      JOIN "user" u ON u.id = m.user_id
     WHERE u.email = ${email} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return filas[0]!.id;
}

async function memberIdDe(email: string): Promise<string> {
  const filas = (await db.execute(sql`
    SELECT m.id FROM member m
      JOIN "user" u ON u.id = m.user_id
     WHERE u.email = ${email} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return filas[0]!.id;
}

/**
 * Dar de alta también consume el rate-limit (FR-062: 10 intentos por IP cada
 * 10 minutos) y esta prueba crea varias cuentas desde la misma máquina. Sin
 * vaciarlo antes de cada alta, la suite se bloquea a sí misma y el fallo
 * ("Demasiados intentos") parece del código cuando es de la prueba.
 */
async function crearCuenta(input: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  role: "owner" | "member";
}) {
  await db.execute(sql`DELETE FROM rate_limit_hit`);
  return m.provisioning.createAccountInOrganization(input);
}

async function existeUsuario(email: string): Promise<boolean> {
  const filas = (await db.execute(sql`
    SELECT count(*)::int AS n FROM "user" WHERE email = ${email}
  `)) as unknown as Array<{ n: number }>;
  return filas[0]!.n > 0;
}

describe.skipIf(!hayBase)("eliminar una cuenta de acceso (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();

    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Del A",
      slug: F.orgA,
      ownerName: "Dueña A",
      ownerEmail: F.duenaA,
      password: F.clave,
    });
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Del B",
      slug: F.orgB,
      ownerName: "Dueña B",
      ownerEmail: F.duenaB,
      password: F.clave,
    });
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Agencia Del",
      ownerName: "Admin Agencia",
      ownerEmail: F.emailAdmin,
      password: F.clave,
    });

    orgA = await orgDe(F.duenaA);
    orgB = await orgDe(F.duenaB);
    orgAdmin = await orgDe(F.emailAdmin);
    miembroDuenaA = await memberIdDe(F.duenaA);
    miembroAdmin = await memberIdDe(F.emailAdmin);

    await db.execute(sql`
      UPDATE "user" SET platform_role = 'superadmin' WHERE email = ${F.emailAdmin}
    `);
  }, 120_000);

  afterAll(async () => {
    for (const email of [
      F.duenaA,
      F.duenaB,
      F.emailAdmin,
      F.sobrante,
      F.compartida,
    ]) {
      await db.execute(sql`
        DELETE FROM organization WHERE id IN (
          SELECT m.organization_id FROM member m
            JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email}
        )
      `);
      await db.execute(sql`DELETE FROM "user" WHERE email = ${email}`);
    }
  }, 60_000);

  it("borra la cuenta y deja el correo libre para volver a usarlo", async () => {
    // El caso real: se dio de alta con el correo equivocado. Si solo se quitara
    // la membresía, el correo seguiría ocupado y volver a crearla fallaría con
    // "ya existe una cuenta con ese correo".
    const { memberId } = await crearCuenta({
      organizationId: orgA,
      name: "Cuenta Sobrante",
      email: F.sobrante,
      password: F.clave,
      role: "owner",
    });

    const res = await m.provisioning.deleteAccountFromOrganization({
      organizationId: orgA,
      memberId,
    });

    expect(res).toMatchObject({ ok: true, email: F.sobrante, freedEmail: true });
    expect(await existeUsuario(F.sobrante)).toBe(false);

    const credenciales = (await db.execute(sql`
      SELECT count(*)::int AS n FROM account WHERE user_id NOT IN (
        SELECT id FROM "user"
      )
    `)) as unknown as Array<{ n: number }>;
    expect(credenciales[0]!.n).toBe(0);

    // Y el correo se puede reutilizar de inmediato.
    const otra = await crearCuenta({
      organizationId: orgA,
      name: "Cuenta Buena",
      email: F.sobrante,
      password: F.clave,
      role: "owner",
    });
    expect(otra.memberId).toBeTruthy();
    await m.provisioning.deleteAccountFromOrganization({
      organizationId: orgA,
      memberId: otra.memberId,
    });
  }, 60_000);

  it("NO borra la última cuenta del cliente", async () => {
    // Sin esta guarda, un clic de más deja al negocio sin ninguna puerta de
    // entrada y sin forma de recuperarla: no hay "olvidé mi contraseña".
    const res = await m.provisioning.deleteAccountFromOrganization({
      organizationId: orgA,
      memberId: miembroDuenaA,
    });

    expect(res).toEqual({ ok: false, reason: "last_account" });
    expect(await existeUsuario(F.duenaA)).toBe(true);
  }, 60_000);

  it("NO alcanza a la cuenta de otro cliente", async () => {
    // El memberId viaja desde el navegador: sin comprobar a qué organización
    // pertenece, un identificador ajeno borraría la cuenta de otro negocio.
    const miembroB = await memberIdDe(F.duenaB);

    const res = await m.provisioning.deleteAccountFromOrganization({
      organizationId: orgA,
      memberId: miembroB,
    });

    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(await existeUsuario(F.duenaB)).toBe(true);
  }, 60_000);

  it("NO alcanza a una cuenta de la agencia", async () => {
    const res = await m.provisioning.deleteAccountFromOrganization({
      organizationId: orgAdmin,
      memberId: miembroAdmin,
    });

    expect(res).toEqual({ ok: false, reason: "is_platform_admin" });
    expect(await existeUsuario(F.emailAdmin)).toBe(true);
  }, 60_000);

  it("a quien trabaja para dos clientes solo le quita este acceso", async () => {
    const { memberId, userId } = await crearCuenta({
      organizationId: orgA,
      name: "Trabaja En Dos",
      email: F.compartida,
      password: F.clave,
      role: "member",
    });
    await db.execute(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES ('mem_test_del_compartida', ${orgB}, ${userId}, 'member')
    `);

    const res = await m.provisioning.deleteAccountFromOrganization({
      organizationId: orgA,
      memberId,
    });

    expect(res).toMatchObject({ ok: true, freedEmail: false });
    // La persona sigue existiendo y conserva el otro cliente.
    expect(await existeUsuario(F.compartida)).toBe(true);
    const restantes = (await db.execute(sql`
      SELECT m.organization_id AS id FROM member m
        JOIN "user" u ON u.id = m.user_id WHERE u.email = ${F.compartida}
    `)) as unknown as Array<{ id: string }>;
    expect(restantes.map((r) => r.id)).toEqual([orgB]);
  }, 60_000);
});
