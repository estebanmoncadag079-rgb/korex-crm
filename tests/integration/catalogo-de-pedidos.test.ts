import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * El catálogo de pedidos fuera del prompt (Fase 1, 15-ago-2026).
 *
 * Hasta hoy el menú de un negocio de pedidos vivía como TEXTO dentro de
 * `agent_profile.instructions`: cambiar un precio obligaba a regenerar el
 * prompt, y el mismo dato podía acabar en dos sitios a la vez. Ahora vive en
 * `product` y el pipeline lo renderiza fresco en cada turno — lo mismo que
 * citas hace desde el 13-ago (`docs/korexia/58-EL-CATALOGO-VIVE-EN-SERVICIOS.md`).
 *
 * Va en integración porque lo que hay que demostrar son las FK compuestas y el
 * aislamiento entre organizaciones, que no existen fuera de Postgres.
 */

const F = {
  orgA: "org_test_cat_a",
  orgB: "org_test_cat_b",
  duenaA: "duena.cat.a@ejemplo-test.com",
  duenaB: "duena.cat.b@ejemplo-test.com",
  clave: "ClaveDeTest123",
};

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

/** El catálogo tal cual lo escriben hoy los clientes en su ficha. */
const CATALOGO = [
  "🥨 Churrita — $10.000 (6 churros · 1 salsa)",
  "🥨 Besties — $20.000 (14 churros · 2 salsas)",
  "🥨 Mega Box — $50.000 (34 churros · 5 salsas)",
].join("\n");

const VARIANTES = [
  "SALSAS: 🍯 AREQUIPE · 🍫 CHOCOLATE · 🐄 LECHERA",
  "ADICIONES (opcionales): 🍫 Salsa de CHOCOLATE $2.000 · 💧 Botella de agua $2.000",
].join("\n");

describe.skipIf(!hayBase)("catálogo de pedidos en tablas (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Churrería Test A",
      slug: F.orgA,
      ownerName: "Dueña A",
      ownerEmail: F.duenaA,
      password: F.clave,
    });
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Churrería Test B",
      slug: F.orgB,
      ownerName: "Dueña B",
      ownerEmail: F.duenaB,
      password: F.clave,
    });
    orgA = await orgDe(F.duenaA);
    orgB = await orgDe(F.duenaB);
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

  it("lee el catálogo escrito a mano sin perder productos ni precios", () => {
    const leido = m.catalogo.leerCatalogoDeTexto(CATALOGO, VARIANTES);

    expect(leido.productos).toHaveLength(3);
    expect(leido.productos[0]!.nombre).toBe("Churrita");
    expect(leido.productos[0]!.precioCents).toBe(1_000_000); // $10.000
    expect(leido.productos[2]!.precioCents).toBe(5_000_000); // $50.000

    // Las adiciones con precio se leen como opciones que cuestan.
    const adiciones = leido.grupos.find((g) => /adicion/i.test(g.nombre));
    expect(adiciones?.minimo).toBe(0); // "(opcionales)" => no obligatorio
    expect(adiciones?.opciones.some((o) => o.precioExtraCents === 200_000)).toBe(true);

    // Las salsas incluidas no cuestan y son obligatorias.
    const salsas = leido.grupos.find((g) => /salsa/i.test(g.nombre));
    expect(salsas?.minimo).toBe(1);
    expect(salsas?.opciones.every((o) => o.precioExtraCents === 0)).toBe(true);
  });

  it("un producto sin precio queda en NULL, que no es lo mismo que gratis", () => {
    const leido = m.catalogo.leerCatalogoDeTexto("🥨 Torta por encargo", "");
    expect(leido.productos[0]!.precioCents).toBeNull();
    // Y el render lo dice en vez de callarse un precio de cero.
    const texto = m.catalogoRender.renderCatalogoDePedidos([
      {
        id: "x",
        nombre: "Torta por encargo",
        categoria: null,
        precioCents: null,
        descripcion: null,
        grupos: [],
      },
    ]);
    expect(texto).toContain("confirmar");
    expect(texto).not.toContain("$0");
  });

  it("escribir dos veces no duplica el catálogo", async () => {
    const leido = m.catalogo.leerCatalogoDeTexto(CATALOGO, VARIANTES);
    await m.catalogo.escribirCatalogo(orgA, leido);
    await m.catalogo.escribirCatalogo(orgA, leido);

    const productos = await m.catalogoQueries.catalogoDePedidos(orgA);
    expect(productos).toHaveLength(3);
  }, 60_000);

  it("el catálogo de un cliente NO se ve desde otro", async () => {
    const leido = m.catalogo.leerCatalogoDeTexto(CATALOGO, VARIANTES);
    await m.catalogo.escribirCatalogo(orgA, leido);

    expect(await m.catalogoQueries.catalogoDePedidos(orgB)).toHaveLength(0);
    expect((await m.catalogoQueries.catalogoDePedidos(orgA)).length).toBeGreaterThan(0);
  }, 60_000);

  it("la base IMPIDE colgar una opción de un producto de otra organización", async () => {
    // No es disciplina del código: es la FK compuesta (organization_id, id).
    // Ya hubo una fuga entre clientes por un WHERE sin organization_id
    // (docs/korexia/10-SEGURIDAD.md); esto lo cierra en el motor.
    await m.catalogo.escribirCatalogo(orgA, m.catalogo.leerCatalogoDeTexto(CATALOGO, ""));
    const prodA = (await db.execute(sql`
      SELECT id FROM product WHERE organization_id = ${orgA} LIMIT 1
    `)) as unknown as Array<{ id: string }>;

    await expect(
      db.execute(sql`
        INSERT INTO product_option_group (id, organization_id, product_id, name)
        VALUES ('pog_intruso', ${orgB}, ${prodA[0]!.id}, 'Robado')
      `)
    ).rejects.toThrow();
  }, 60_000);

  it("borrar el producto se lleva sus grupos y opciones", async () => {
    await m.catalogo.escribirCatalogo(orgA, m.catalogo.leerCatalogoDeTexto(CATALOGO, VARIANTES));
    const antes = (await db.execute(sql`
      SELECT count(*)::int AS n FROM product_option WHERE organization_id = ${orgA}
    `)) as unknown as Array<{ n: number }>;
    expect(antes[0]!.n).toBeGreaterThan(0);

    await db.execute(sql`DELETE FROM product WHERE organization_id = ${orgA}`);

    const despues = (await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM product_option_group WHERE organization_id = ${orgA}) AS grupos,
        (SELECT count(*)::int FROM product_option WHERE organization_id = ${orgA}) AS opciones
    `)) as unknown as Array<{ grupos: number; opciones: number }>;
    expect(despues[0]!.grupos).toBe(0);
    expect(despues[0]!.opciones).toBe(0);
  }, 60_000);
});
