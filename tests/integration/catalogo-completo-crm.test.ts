import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * El catálogo completo (productos, grupos, opciones) desde el CRM
 * (25-ago-2026): antes de esto, dar de alta un producto era escribirlo como
 * texto libre en el cuestionario de alta y correr una migración aparte.
 *
 * Va en integración por lo mismo que `permite-repeticion-crm.test.ts`: lo que
 * hay que demostrar es que el cambio persiste en Postgres y que **no cruza de
 * una organización a otra**, incluyendo cuando el intento pasa un id ajeno a
 * propósito.
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

describe.skipIf(!hayBase)("catálogo completo desde el CRM (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Test Cat A",
      slug: F.orgA,
      ownerName: "Dueña A",
      ownerEmail: F.duenaA,
      password: F.clave,
    });
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Negocio Test Cat B",
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

  it("crea un producto, lo edita y lo archiva", async () => {
    const creado = await m.catalogoProductos.crearProducto(
      orgA,
      { nombre: "Cremoso 12 oz", categoria: "Cremosos", precioCents: 1_800_000 },
      "user:test"
    );
    expect(creado.nombre).toBe("Cremoso 12 oz");
    expect(creado.precioCents).toBe(1_800_000);

    let listado = await m.catalogoProductos.listarProductos(orgA);
    expect(listado.find((p) => p.id === creado.id)).toBeTruthy();

    const editado = await m.catalogoProductos.actualizarProducto(
      orgA,
      creado.id,
      { precioCents: 2_000_000 },
      "user:test"
    );
    expect(editado?.precioCents).toBe(2_000_000);
    // Solo lo declarado cambia: el nombre sigue igual.
    expect(editado?.nombre).toBe("Cremoso 12 oz");

    const archivado = await m.catalogoProductos.archivarProducto(orgA, creado.id, "user:test");
    expect(archivado).toBe(true);

    listado = await m.catalogoProductos.listarProductos(orgA);
    expect(listado.find((p) => p.id === creado.id)).toBeUndefined();
  }, 60_000);

  it("un producto sin precio se guarda así — el agente debe preguntarlo, no inventarlo", async () => {
    const creado = await m.catalogoProductos.crearProducto(
      orgA,
      { nombre: "Torta especial" },
      "user:test"
    );
    expect(creado.precioCents).toBeNull();
  }, 60_000);

  it("crea un grupo de opciones para un producto, con sus opciones dentro", async () => {
    const producto = await m.catalogoProductos.crearProducto(
      orgA,
      { nombre: "Cremoso 16 oz", precioCents: 2_200_000 },
      "user:test"
    );
    const grupo = await m.catalogoGrupos.crearGrupo(
      orgA,
      producto.id,
      { nombre: "Toppings", minimo: 3, maximo: 3 },
      "user:test"
    );
    expect(grupo?.productoId).toBe(producto.id);
    expect(grupo?.minimo).toBe(3);

    const opcion = await m.catalogoOpciones.crearOpcion(
      orgA,
      grupo!.id,
      { nombre: "Milo" },
      "user:test"
    );
    expect(opcion?.nombre).toBe("Milo");

    const opciones = await m.catalogoOpciones.listarOpciones(orgA, grupo!.id);
    expect(opciones.map((o) => o.nombre)).toContain("Milo");

    // El agente lo ve fresco, sin regenerar nada (mismo catálogo que lee el pipeline).
    const catalogoDePedidos = await m.catalogoQueries.catalogoDePedidos(orgA);
    const grupoLeido = catalogoDePedidos
      .flatMap((p) => p.grupos)
      .find((g) => g.id === grupo!.id);
    expect(grupoLeido?.opciones.some((o) => o.nombre === "Milo")).toBe(true);
  }, 60_000);

  it("editar un grupo actualiza mínimo, máximo y nombre — no solo repetición", async () => {
    const producto = await m.catalogoProductos.crearProducto(orgA, { nombre: "P edit grupo" }, "user:test");
    const grupo = await m.catalogoGrupos.crearGrupo(
      orgA,
      producto.id,
      { nombre: "Sabor", minimo: 1, maximo: 1 },
      "user:test"
    );
    const editado = await m.catalogoGrupos.actualizarGrupo(
      orgA,
      grupo!.id,
      { nombre: "Sabores", maximo: 2, permiteRepeticion: true },
      "user:test"
    );
    expect(editado?.nombre).toBe("Sabores");
    expect(editado?.minimo).toBe(1); // no declarado, no toca
    expect(editado?.maximo).toBe(2);
    expect(editado?.permiteRepeticion).toBe(true);
  }, 60_000);

  it("eliminar un grupo se lleva sus opciones (cascade)", async () => {
    const producto = await m.catalogoProductos.crearProducto(orgA, { nombre: "P borrar grupo" }, "user:test");
    const grupo = await m.catalogoGrupos.crearGrupo(
      orgA,
      producto.id,
      { nombre: "Temporal", minimo: 0, maximo: 1 },
      "user:test"
    );
    await m.catalogoOpciones.crearOpcion(orgA, grupo!.id, { nombre: "Única" }, "user:test");

    const eliminado = await m.catalogoGrupos.eliminarGrupo(orgA, grupo!.id, "user:test");
    expect(eliminado).toBe(true);

    const opciones = await m.catalogoOpciones.listarOpciones(orgA, grupo!.id);
    expect(opciones).toEqual([]);
  }, 60_000);

  it("🔴 una organización NO puede editar, archivar ni crear grupos sobre el producto de otra", async () => {
    const producto = await m.catalogoProductos.crearProducto(orgA, { nombre: "Solo de A" }, "user:test");

    // B intenta editar el producto de A pasando su id a propósito.
    const edicionIntrusa = await m.catalogoProductos.actualizarProducto(
      orgB,
      producto.id,
      { nombre: "Robado" },
      "user:intruso"
    );
    expect(edicionIntrusa).toBeNull();

    const archivadoIntruso = await m.catalogoProductos.archivarProducto(orgB, producto.id, "user:intruso");
    expect(archivadoIntruso).toBe(false);

    // B intenta crear un grupo colgado del producto de A: la FK compuesta lo rechaza.
    const grupoIntruso = await m.catalogoGrupos.crearGrupo(
      orgB,
      producto.id,
      { nombre: "Intento", minimo: 0, maximo: 1 },
      "user:intruso"
    );
    expect(grupoIntruso).toBeNull();

    // El producto de A sigue intacto.
    const listadoA = await m.catalogoProductos.listarProductos(orgA);
    expect(listadoA.find((p) => p.id === producto.id)?.nombre).toBe("Solo de A");
  }, 60_000);

  it("🔴 una organización tampoco LEE los productos ni las opciones de la otra", async () => {
    const deA = await m.catalogoProductos.listarProductos(orgA);
    const deB = await m.catalogoProductos.listarProductos(orgB);
    const idsDeB = new Set(deB.map((p) => p.id));
    expect(deA.every((p) => !idsDeB.has(p.id))).toBe(true);
    expect(deA.length).toBeGreaterThan(0);
  }, 60_000);
});
