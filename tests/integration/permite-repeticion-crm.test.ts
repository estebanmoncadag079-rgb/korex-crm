import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { compararFila, type Fila } from "@/server/ai/generador/comparar-fila";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * `permiteRepeticion` se configura desde el CRM (17-ago-2026).
 *
 * Hasta hoy la única forma de cambiar si un grupo admite repetir la misma
 * opción era `pnpm repeticion`, un script contra producción. Eso rompe la meta
 * del proyecto —**un negocio nuevo se configura desde el CRM, sin scripts ni
 * intervención técnica**— y es lo que cierra `server/catalog/grupos.ts`.
 *
 * Va en integración porque lo que hay que demostrar es justo lo que no existe
 * fuera de Postgres: que **el cambio persiste**, que **no cruza de una
 * organización a otra** y que **el catálogo que lee el agente refleja el valor
 * nuevo** sin que nadie regenere nada.
 */

const F = {
  orgA: "org_test_rep_a",
  orgB: "org_test_rep_b",
  duenaA: "duena.rep.a@ejemplo-test.com",
  duenaB: "duena.rep.b@ejemplo-test.com",
  clave: "ClaveDeTest123",
};

/** Un catálogo cualquiera, con un grupo que pide más opciones de las que hay. */
const CATALOGO = [
  "🥨 Caja pequeña — $10.000",
  "🥨 Caja grande — $50.000",
].join("\n");

const VARIANTES = "SALSAS: 🍯 AREQUIPE · 🍫 CHOCOLATE · 🐄 LECHERA";

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;
let orgA: string;
let orgB: string;

async function orgDe(email: string): Promise<string> {
  const filas = (await db.execute(sql`
    SELECT m.organization_id AS id FROM member m
      JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return filas[0]!.id;
}

/** La fila ENTERA del grupo, para poder compararla antes y después. */
async function filaDelGrupo(id: string): Promise<Fila> {
  const filas = (await db.execute(sql`
    SELECT * FROM product_option_group WHERE id = ${id}
  `)) as unknown as Fila[];
  return filas[0]!;
}

describe.skipIf(!hayBase)("permiteRepeticion desde el CRM (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Test A",
      slug: F.orgA,
      ownerName: "Dueña A",
      ownerEmail: F.duenaA,
      password: F.clave,
    });
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Test B",
      slug: F.orgB,
      ownerName: "Dueña B",
      ownerEmail: F.duenaB,
      password: F.clave,
    });
    orgA = await orgDe(F.duenaA);
    orgB = await orgDe(F.duenaB);

    const leido = m.catalogo.leerCatalogoDeTexto(CATALOGO, VARIANTES);
    await m.catalogo.escribirCatalogo(orgA, leido);
    await m.catalogo.escribirCatalogo(orgB, leido);
  }, 120_000);

  afterAll(async () => {
    for (const email of [F.duenaA, F.duenaB]) {
      await db.execute(sql`
        DELETE FROM organization WHERE id IN (
          SELECT m.organization_id FROM member m
            JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email}
        )
      `);
      await db.execute(sql`DELETE FROM "user" WHERE email = ${email}`);
    }
  }, 60_000);

  it("la pantalla ve producto, grupo, mínimo, máximo y cuántas opciones hay", async () => {
    const grupos = await m.catalogoGrupos.listarGruposDeOpciones(orgA);
    expect(grupos.length).toBeGreaterThan(0);
    for (const g of grupos) {
      // Nombres, no ids: la pantalla es para una persona del negocio.
      expect(g.producto).toBeTruthy();
      expect(g.nombre).toBeTruthy();
      expect(typeof g.minimo).toBe("number");
      expect(typeof g.maximo).toBe("number");
      expect(typeof g.opciones).toBe("number");
      expect(typeof g.permiteRepeticion).toBe("boolean");
    }
    const salsas = grupos.find((g) => /salsa/i.test(g.nombre));
    expect(salsas?.opciones).toBe(3); // las tres del texto de arriba
  }, 60_000);

  it("cambiar permiteRepeticion persiste, y NO toca nada más de la fila", async () => {
    const [grupo] = await m.catalogoGrupos.listarGruposDeOpciones(orgA);
    const antes = await filaDelGrupo(grupo!.id);

    const devuelto = await m.catalogoGrupos.actualizarPermiteRepeticion(
      orgA,
      grupo!.id,
      !grupo!.permiteRepeticion,
      "user:test"
    );
    expect(devuelto?.permiteRepeticion).toBe(!grupo!.permiteRepeticion);

    const despues = await filaDelGrupo(grupo!.id);
    expect(despues.permite_repeticion).toBe(!grupo!.permiteRepeticion);

    /*
     * Fila COMPLETA, no una lista de campos (regla del 15-ago-2026,
     * `68-UN-DUENO-POR-DATO.md`): si esta función tocara de paso el mínimo, el
     * máximo o el nombre del grupo, esto lo caza aunque nadie lo hubiera
     * previsto.
     */
    const diff = compararFila(antes, despues, ["permite_repeticion"]);
    expect(diff.noDeclarados).toEqual([]);
    expect(diff.ok).toBe(true);
  }, 60_000);

  it("el catálogo que lee el agente refleja el valor nuevo, sin regenerar nada", async () => {
    const [grupo] = await m.catalogoGrupos.listarGruposDeOpciones(orgA);

    await m.catalogoGrupos.actualizarPermiteRepeticion(orgA, grupo!.id, true, "user:test");
    const conRepeticion = await m.catalogoQueries.catalogoDePedidos(orgA);
    expect(
      conRepeticion.flatMap((p) => p.grupos).find((g) => g.id === grupo!.id)
        ?.permiteRepeticion
    ).toBe(true);

    await m.catalogoGrupos.actualizarPermiteRepeticion(orgA, grupo!.id, false, "user:test");
    const sinRepeticion = await m.catalogoQueries.catalogoDePedidos(orgA);
    expect(
      sinRepeticion.flatMap((p) => p.grupos).find((g) => g.id === grupo!.id)
        ?.permiteRepeticion
    ).toBe(false);
  }, 60_000);

  it("🔴 una organización NO puede cambiar el grupo de otra", async () => {
    const [deA] = await m.catalogoGrupos.listarGruposDeOpciones(orgA);
    await m.catalogoGrupos.actualizarPermiteRepeticion(orgA, deA!.id, false, "user:test");
    const antes = await filaDelGrupo(deA!.id);

    // B tiene su propio catálogo y conoce el id de A: aun así, no lo toca.
    const intento = await m.catalogoGrupos.actualizarPermiteRepeticion(
      orgB,
      deA!.id,
      true,
      "user:intruso"
    );

    expect(intento).toBeNull(); // ni siquiera confirma que exista
    const despues = await filaDelGrupo(deA!.id);
    expect(despues.permite_repeticion).toBe(false);
    expect(compararFila(antes, despues, []).noDeclarados).toEqual([]);
  }, 60_000);

  it("una organización tampoco LEE los grupos de la otra", async () => {
    const deA = await m.catalogoGrupos.listarGruposDeOpciones(orgA);
    const deB = await m.catalogoGrupos.listarGruposDeOpciones(orgB);
    const idsDeB = new Set(deB.map((g) => g.id));
    expect(deA.every((g) => !idsDeB.has(g.id))).toBe(true);
    expect(deA.length).toBeGreaterThan(0);
    expect(deB.length).toBeGreaterThan(0);
  }, 60_000);
});
