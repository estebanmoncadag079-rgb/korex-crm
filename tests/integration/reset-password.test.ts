import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * Cambiar la contraseña de un cliente desde el panel, contra Postgres real
 * (10-ago-2026).
 *
 * Va aquí y no en las unitarias por dos motivos: el hash lo genera Better Auth
 * con su propio algoritmo —un doble probaría el doble— y lo único que demuestra
 * de verdad que funcionó es **entrar con la contraseña nueva**.
 *
 * Existe porque no hay recuperación por correo en esta instalación: sin este
 * camino, un cliente bloqueado dependía de que alguien editara la base a mano.
 */

const F = {
  orgA: "org_test_reset_a",
  orgB: "org_test_reset_b",
  emailA: "duena.reset.a@ejemplo-test.com",
  emailB: "duena.reset.b@ejemplo-test.com",
  emailAdmin: "agencia.reset@ejemplo-test.com",
  vieja: "ClaveVieja123",
  nueva: "ClaveNueva456",
};

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;
/** memberId de cada cuenta: es lo que recibe el endpoint. */
let miembroA: string;
let miembroB: string;
let miembroAdmin: string;

async function memberIdDe(email: string): Promise<string> {
  const filas = (await db.execute(sql`
    SELECT m.id FROM member m
      JOIN "user" u ON u.id = m.user_id
     WHERE u.email = ${email} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return filas[0]!.id;
}

/**
 * Entra de verdad con esas credenciales. Es la única prueba real de que la
 * contraseña cambió: comparar hashes solo demostraría que se escribió algo.
 *
 * Antes de cada intento se vacía el registro del rate-limit. El login está
 * limitado a 10 intentos por IP cada 10 minutos (FR-062) y estas pruebas hacen
 * muchos más desde la misma máquina: sin esto se bloquean entre ellas y el
 * fallo parece del código cuando es de la prueba.
 */
async function puedeEntrar(email: string, password: string): Promise<boolean> {
  await db.execute(sql`DELETE FROM rate_limit_hit`);
  try {
    await m.auth.getAuth().api.signInEmail({ body: { email, password } });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hayBase)("cambiar la contraseña de un cliente (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();

    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Reset A",
      slug: F.orgA,
      ownerName: "Dueña A",
      ownerEmail: F.emailA,
      password: F.vieja,
    });
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Reset B",
      slug: F.orgB,
      ownerName: "Dueña B",
      ownerEmail: F.emailB,
      password: F.vieja,
    });
    await m.provisioning.createClientWithOwner({
      organizationName: "Agencia Reset",
      ownerName: "Admin Agencia",
      ownerEmail: F.emailAdmin,
      password: F.vieja,
    });

    miembroA = await memberIdDe(F.emailA);
    miembroB = await memberIdDe(F.emailB);
    miembroAdmin = await memberIdDe(F.emailAdmin);

    await db.execute(sql`
      UPDATE "user" SET platform_role = 'superadmin' WHERE email = ${F.emailAdmin}
    `);
  }, 120_000);

  afterAll(async () => {
    for (const email of [F.emailA, F.emailB, F.emailAdmin]) {
      await db.execute(sql`
        DELETE FROM organization WHERE id IN (
          SELECT m.organization_id FROM member m
            JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email}
        )
      `);
      await db.execute(sql`DELETE FROM "user" WHERE email = ${email}`);
    }
  }, 60_000);

  it("la contraseña nueva sirve para entrar y la vieja deja de servir", async () => {
    const orgId = (
      (await db.execute(sql`
        SELECT m.organization_id AS id FROM member m
          JOIN "user" u ON u.id = m.user_id WHERE u.email = ${F.emailA} LIMIT 1
      `)) as unknown as Array<{ id: string }>
    )[0]!.id;

    const res = await m.provisioning.resetAccountPassword({
      organizationId: orgId,
      memberId: miembroA,
      password: F.nueva,
    });

    expect(res.ok).toBe(true);
    expect(await puedeEntrar(F.emailA, F.nueva)).toBe(true);
    expect(await puedeEntrar(F.emailA, F.vieja)).toBe(false);
  }, 60_000);

  it("NO alcanza a la cuenta de otro cliente", async () => {
    // El memberId viaja desde el navegador: si el servidor no comprobara a qué
    // organización pertenece, cualquier identificador ajeno cambiaría la
    // contraseña de otro negocio.
    const orgA = (
      (await db.execute(sql`
        SELECT m.organization_id AS id FROM member m
          JOIN "user" u ON u.id = m.user_id WHERE u.email = ${F.emailA} LIMIT 1
      `)) as unknown as Array<{ id: string }>
    )[0]!.id;

    const res = await m.provisioning.resetAccountPassword({
      organizationId: orgA,
      memberId: miembroB,
      password: "OtraClave789",
    });

    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(await puedeEntrar(F.emailB, F.vieja)).toBe(true);
    expect(await puedeEntrar(F.emailB, "OtraClave789")).toBe(false);
  }, 60_000);

  it("NO alcanza a una cuenta de la agencia", async () => {
    // Este botón desbloquea clientes. Si alguien robara una sesión de
    // administrador, que no pueda además apoderarse de las cuentas internas.
    const orgAdmin = (
      (await db.execute(sql`
        SELECT m.organization_id AS id FROM member m
          JOIN "user" u ON u.id = m.user_id WHERE u.email = ${F.emailAdmin} LIMIT 1
      `)) as unknown as Array<{ id: string }>
    )[0]!.id;

    const res = await m.provisioning.resetAccountPassword({
      organizationId: orgAdmin,
      memberId: miembroAdmin,
      password: "ClaveRobada999",
    });

    expect(res).toEqual({ ok: false, reason: "is_platform_admin" });
    expect(await puedeEntrar(F.emailAdmin, F.vieja)).toBe(true);
  }, 60_000);

  it("cierra las sesiones que esa cuenta tuviera abiertas", async () => {
    // Si el motivo real no fue un olvido sino que alguien se metió, cambiar la
    // clave sin echarlo lo dejaría dentro.
    const orgId = (
      (await db.execute(sql`
        SELECT m.organization_id AS id FROM member m
          JOIN "user" u ON u.id = m.user_id WHERE u.email = ${F.emailB} LIMIT 1
      `)) as unknown as Array<{ id: string }>
    )[0]!.id;

    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.auth.getAuth().api.signInEmail({
      body: { email: F.emailB, password: F.vieja },
    });
    const antes = (await db.execute(sql`
      SELECT count(*)::int AS n FROM session s
        JOIN "user" u ON u.id = s.user_id WHERE u.email = ${F.emailB}
    `)) as unknown as Array<{ n: number }>;
    expect(antes[0]!.n).toBeGreaterThan(0);

    await m.provisioning.resetAccountPassword({
      organizationId: orgId,
      memberId: miembroB,
      password: "ClaveTrasSesion321",
    });

    const despues = (await db.execute(sql`
      SELECT count(*)::int AS n FROM session s
        JOIN "user" u ON u.id = s.user_id WHERE u.email = ${F.emailB}
    `)) as unknown as Array<{ n: number }>;
    expect(despues[0]!.n).toBe(0);
  }, 60_000);
});
