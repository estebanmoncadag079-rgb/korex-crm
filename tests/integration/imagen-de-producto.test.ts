import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * La imagen de un producto del catálogo, contra Postgres DE VERDAD
 * (migraciones `0043_imagen_del_producto` y `0044_imagen_del_producto_on_delete`).
 *
 * Va en integración y no en unitarias porque lo que hay que demostrar **no
 * existe fuera de Postgres**, y las unitarias con mocks no pueden verlo:
 *
 * - `ON DELETE SET NULL ("product_id")` — la lista de columnas es lo que
 *   corrige la 0043. Sin ella, el motor intenta anular TAMBIÉN
 *   `organization_id`, que es NOT NULL, y revienta la transacción entera. Un
 *   mock de Drizzle no ejecuta ninguna acción referencial: diría que todo va
 *   bien con las dos versiones de la restricción.
 * - `media_org_etiqueta_uq`, el índice único sobre `(organization_id,
 *   etiqueta)`, que es lo que hace obligatorio renombrar al desvincular.
 * - El aislamiento por organización de la FK compuesta.
 *
 * Es el mismo criterio que ya justifica `catalogo-de-pedidos.test.ts`.
 *
 * ⚠️ Se saltan solas sin `TEST_DATABASE_URL`. **Nunca** apuntes esa variable
 * al túnel de producción (`localhost:15433`): ver el aviso de CLAUDE.md.
 */

const F = {
  orgA: "org_test_img_a",
  orgB: "org_test_img_b",
  duenaA: "duena.img.a@ejemplo-test.com",
  duenaB: "duena.img.b@ejemplo-test.com",
  clave: "ClaveDeTest123",
};

/** 1×1 px JPEG, lo mínimo que pasa la validación de tipo. */
const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

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

async function crearProducto(orgId: string, id: string, nombre: string) {
  await db.execute(sql`
    INSERT INTO product (id, organization_id, name) VALUES (${id}, ${orgId}, ${nombre})
  `);
}

async function filaDelAsset(id: string) {
  const filas = (await db.execute(sql`
    SELECT id, organization_id, product_id, kind, etiqueta, mime_type, datos
      FROM media_asset WHERE id = ${id}
  `)) as unknown as Array<{
    id: string;
    organization_id: string;
    product_id: string | null;
    kind: string;
    etiqueta: string;
    mime_type: string | null;
    datos: string | null;
  }>;
  return filas[0] ?? null;
}

describe.skipIf(!hayBase)("imagen de producto (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    for (const [nombre, slug, email] of [
      ["Negocio Img A", F.orgA, F.duenaA],
      ["Negocio Img B", F.orgB, F.duenaB],
    ] as const) {
      await db.execute(sql`DELETE FROM rate_limit_hit`);
      await m.provisioning.createClientWithOwner({
        organizationName: nombre,
        slug,
        ownerName: "Dueña",
        ownerEmail: email,
        password: F.clave,
      });
    }
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

  beforeEach(async () => {
    // Cada prueba parte de un catálogo y unos recursos limpios, sin tocar las
    // organizaciones (crearlas cuesta ~segundos por el hash de la contraseña).
    await db.execute(sql`DELETE FROM media_asset WHERE organization_id IN (${orgA}, ${orgB})`);
    await db.execute(sql`DELETE FROM campaign WHERE organization_id IN (${orgA}, ${orgB})`);
    await db.execute(sql`DELETE FROM template WHERE organization_id IN (${orgA}, ${orgB})`);
    await db.execute(sql`DELETE FROM product WHERE organization_id IN (${orgA}, ${orgB})`);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 1 · La restricción de la 0044: el borrado en cascada NO puede reventar
   * ════════════════════════════════════════════════════════════════════ */

  describe("ON DELETE SET NULL (product_id)", () => {
    it("borrar el producto deja el recurso vivo, con product_id NULL y organization_id INTACTO", async () => {
      await crearProducto(orgA, "p_borrable", "Amor y Amistad");
      const guardada = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_borrable",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );
      expect(guardada.ok).toBe(true);
      const assetId = (guardada as { ok: true; id: string }).id;

      // Esto es lo que con la 0043 habría lanzado
      // "null value in column organization_id violates not-null constraint".
      await db.execute(sql`DELETE FROM product WHERE id = 'p_borrable'`);

      const fila = await filaDelAsset(assetId);
      expect(fila).not.toBeNull();
      expect(fila!.product_id).toBeNull();
      expect(fila!.organization_id).toBe(orgA); // ← la corrección, en una línea
      // Y el archivo sigue ahí: no se perdió nada al soltar el vínculo.
      expect(fila!.datos).toBeTruthy();
    }, 60_000);

    it("borrar la ORGANIZACIÓN entera no falla (es el camino real de /admin)", async () => {
      // `DELETE /api/admin/clients/[id]` borra la organización; `product`
      // cascadea, y ahí se disparaba el conflicto de la 0043. Se usa una
      // organización desechable para no arrastrar las de las demás pruebas.
      await db.execute(sql`DELETE FROM rate_limit_hit`);
      await m.provisioning.createClientWithOwner({
        organizationName: "Negocio Img Efímero",
        slug: "org_test_img_efimera",
        ownerName: "Dueña",
        ownerEmail: "duena.img.efimera@ejemplo-test.com",
        password: F.clave,
      });
      const orgC = await orgDe("duena.img.efimera@ejemplo-test.com");
      await crearProducto(orgC, "p_efimero", "Combo");
      await m.catalogoImagenes.guardarImagenDeProducto(
        orgC,
        "p_efimero",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      await expect(
        db.execute(sql`DELETE FROM organization WHERE id = ${orgC}`)
      ).resolves.toBeDefined();

      const quedan = (await db.execute(sql`
        SELECT count(*)::int AS n FROM media_asset WHERE organization_id = ${orgC}
      `)) as unknown as Array<{ n: number }>;
      expect(quedan[0]!.n).toBe(0);
      await db.execute(sql`DELETE FROM "user" WHERE email = 'duena.img.efimera@ejemplo-test.com'`);
    }, 120_000);

    it("la FK compuesta impide en la BASE que un recurso apunte al producto de OTRA organización", async () => {
      await crearProducto(orgB, "p_de_b", "Producto de B");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_cruzado', ${orgA}, 'producto', 'Cruzado', 'archivo', 'image/jpeg', ${JPEG})
      `);

      // No es el código quien lo impide: es la restricción.
      await expect(
        db.execute(sql`UPDATE media_asset SET product_id = 'p_de_b' WHERE id = 'med_cruzado'`)
      ).rejects.toThrow();
    }, 60_000);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 2 · Quitar la imagen: destruir solo lo que nadie más usa
   * ════════════════════════════════════════════════════════════════════ */

  describe("eliminarImagenDeProducto", () => {
    async function productoConImagen(id: string, nombre: string): Promise<string> {
      await crearProducto(orgA, id, nombre);
      const r = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        id,
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );
      return (r as { ok: true; id: string }).id;
    }

    it("un recurso EXCLUSIVO del producto se borra de verdad", async () => {
      const assetId = await productoConImagen("p_solo", "Solo Mío");

      const resultado = await m.catalogoImagenes.eliminarImagenDeProducto(orgA, "p_solo");

      expect(resultado.accion).toBe("eliminada");
      expect(await filaDelAsset(assetId)).toBeNull();
    }, 60_000);

    it("un recurso que usa una CAMPAÑA se conserva: se desvincula, no se destruye", async () => {
      const assetId = await productoConImagen("p_compartido", "Compartida");
      await db.execute(sql`
        INSERT INTO campaign (id, organization_id, name, media_asset_id)
        VALUES ('cmp_test', ${orgA}, 'Promo de febrero', ${assetId})
      `);

      const resultado = await m.catalogoImagenes.eliminarImagenDeProducto(orgA, "p_compartido");

      expect(resultado.accion).toBe("desvinculada");
      const fila = await filaDelAsset(assetId);
      expect(fila).not.toBeNull();
      expect(fila!.product_id).toBeNull();
      expect(fila!.kind).toBe("otro");
      expect(fila!.datos).toBeTruthy();
      // Y la campaña conserva su imagen: no se le puso a NULL por el camino.
      const cmp = (await db.execute(sql`
        SELECT media_asset_id FROM campaign WHERE id = 'cmp_test'
      `)) as unknown as Array<{ media_asset_id: string | null }>;
      expect(cmp[0]!.media_asset_id).toBe(assetId);
    }, 60_000);

    it("un recurso que usa una PLANTILLA como header también se conserva (JSONB, sin FK que lo proteja)", async () => {
      const assetId = await productoConImagen("p_header", "Header");
      await db.execute(sql`
        INSERT INTO template (id, organization_id, name, language, category, body, components)
        VALUES ('tpl_test', ${orgA}, 'promo_imagen', 'es', 'MARKETING', 'Hola',
                ${JSON.stringify({ header: { type: "IMAGE", mediaAssetId: assetId }, footer: null })}::jsonb)
      `);

      const resultado = await m.catalogoImagenes.eliminarImagenDeProducto(orgA, "p_header");

      expect(resultado.accion).toBe("desvinculada");
      expect(await filaDelAsset(assetId)).not.toBeNull();
      // La plantilla puede seguir enviándose: el asset que resuelve su header
      // sigue existiendo, con sus bytes y su mime.
      const resuelto = (await db.execute(sql`
        SELECT mime_type, datos FROM media_asset WHERE id = ${assetId}
      `)) as unknown as Array<{ mime_type: string | null; datos: string | null }>;
      expect(resuelto[0]!.mime_type).toBe("image/jpeg");
      expect(resuelto[0]!.datos).toBeTruthy();
    }, 60_000);

    it("una referencia de OTRA organización no cuenta: ahí sí se borra", async () => {
      const assetId = await productoConImagen("p_ajeno", "Ajena");
      // Una campaña de B que (por el motivo que sea) apuntara a un asset de A
      // no puede impedir que A borre lo suyo — `referenciasAMediaAsset` va
      // scoped, igual que todo lo demás.
      await db.execute(sql`
        INSERT INTO campaign (id, organization_id, name) VALUES ('cmp_b', ${orgB}, 'De B')
      `);

      const resultado = await m.catalogoImagenes.eliminarImagenDeProducto(orgA, "p_ajeno");

      expect(resultado.accion).toBe("eliminada");
      expect(await filaDelAsset(assetId)).toBeNull();
    }, 60_000);

    it("al desvincular, el nombre del producto queda LIBRE para una imagen nueva", async () => {
      // Sin renombrar, `media_org_etiqueta_uq` bloquearía la siguiente subida
      // — o peor, la reclamaría y pisaría la que usa la campaña.
      const viejo = await productoConImagen("p_relevo", "Relevo");
      await db.execute(sql`
        INSERT INTO campaign (id, organization_id, name, media_asset_id)
        VALUES ('cmp_relevo', ${orgA}, 'Usa la vieja', ${viejo})
      `);
      await m.catalogoImagenes.eliminarImagenDeProducto(orgA, "p_relevo");

      const nueva = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_relevo",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      expect(nueva.ok).toBe(true);
      const nuevoId = (nueva as { ok: true; id: string }).id;
      expect(nuevoId).not.toBe(viejo);
      // Y la vieja sigue entera, con su etiqueta renombrada.
      const filaVieja = await filaDelAsset(viejo);
      expect(filaVieja).not.toBeNull();
      expect(filaVieja!.etiqueta).toContain(viejo);
    }, 60_000);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 3 · Apropiarse de un recurso ajeno por coincidencia de nombre
   * ════════════════════════════════════════════════════════════════════ */

  describe("guardarImagenDeProducto: la etiqueta no es identidad", () => {
    it("dos productos con el MISMO nombre no pueden quedarse con el mismo recurso", async () => {
      // `product` no tiene índice único sobre (organization_id, name).
      await crearProducto(orgA, "p_homonimo_1", "Combo");
      await crearProducto(orgA, "p_homonimo_2", "Combo");
      const primera = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_homonimo_1",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );
      const assetDelPrimero = (primera as { ok: true; id: string }).id;

      const segunda = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_homonimo_2",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      expect(segunda.ok).toBe(false);
      expect((segunda as { motivo: string }).motivo).toBe("etiqueta_ocupada");
      // El primero conserva la suya: no se la robaron.
      const fila = await filaDelAsset(assetDelPrimero);
      expect(fila!.product_id).toBe("p_homonimo_1");
    }, 60_000);

    it("no se apropia de un recurso que no es de un producto (la carta del negocio)", async () => {
      await crearProducto(orgA, "p_carta", "Carta completa");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_la_carta', ${orgA}, 'carta', 'Carta completa', 'archivo', 'application/pdf', ${JPEG})
      `);

      const resultado = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_carta",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      expect(resultado.ok).toBe(false);
      expect((resultado as { motivo: string }).motivo).toBe("etiqueta_ocupada");
    }, 60_000);

    /*
     * Lo que de verdad importa de un error: que no deje las cosas a medias.
     * Se comprueba la fila ENTERA antes y después, no solo que "no falló".
     */
    it("el rechazo por etiqueta ocupada NO modifica nada: ni el recurso ajeno ni crea uno nuevo", async () => {
      await crearProducto(orgA, "p_intacto", "Carta completa");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_intacta', ${orgA}, 'carta', 'Carta completa', 'archivo', 'application/pdf', 'UERGLWZpY3RpY2lv')
      `);
      const antes = await filaDelAsset("med_intacta");
      const cuantosAntes = (await db.execute(sql`
        SELECT count(*)::int AS n FROM media_asset WHERE organization_id = ${orgA}
      `)) as unknown as Array<{ n: number }>;

      await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_intacto",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      expect(await filaDelAsset("med_intacta")).toEqual(antes);
      const cuantosDespues = (await db.execute(sql`
        SELECT count(*)::int AS n FROM media_asset WHERE organization_id = ${orgA}
      `)) as unknown as Array<{ n: number }>;
      expect(cuantosDespues[0]!.n).toBe(cuantosAntes[0]!.n);
    }, 60_000);

    it("reclama un recurso HUÉRFANO de tipo producto que ya se llamaba igual (el caso del onboarding)", async () => {
      await crearProducto(orgA, "p_huerfano", "Churros");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_huerfana', ${orgA}, 'producto', 'Churros', 'archivo', 'image/jpeg', ${JPEG})
      `);

      const resultado = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_huerfano",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      expect(resultado).toEqual({ ok: true, id: "med_huerfana" });
      const fila = await filaDelAsset("med_huerfana");
      expect(fila!.product_id).toBe("p_huerfano");
      // Y no se duplicó la fila (que además habría chocado con el único).
      const n = (await db.execute(sql`
        SELECT count(*)::int AS n FROM media_asset WHERE organization_id = ${orgA}
      `)) as unknown as Array<{ n: number }>;
      expect(n[0]!.n).toBe(1);
    }, 60_000);

    it("con un recurso vinculado al producto Y otro con la misma etiqueta, gana el del producto", async () => {
      // El producto se renombró: su imagen conserva la etiqueta vieja, y
      // mientras tanto alguien subió a Recursos otra con el nombre nuevo.
      await crearProducto(orgA, "p_renombrado", "San Valentín");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos, product_id)
        VALUES ('med_del_producto', ${orgA}, 'producto', 'Amor y Amistad', 'archivo', 'image/jpeg', ${JPEG}, 'p_renombrado')
      `);
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_otra', ${orgA}, 'producto', 'San Valentín', 'archivo', 'image/jpeg', 'T1RSQQ==')
      `);

      const resultado = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_renombrado",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );

      expect(resultado).toEqual({ ok: true, id: "med_del_producto" });
      // La otra queda intacta: no se la llevó por delante.
      const otra = await filaDelAsset("med_otra");
      expect(otra!.datos).toBe("T1RSQQ==");
      expect(otra!.product_id).toBeNull();
    }, 60_000);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 4 · Lo que el agente resuelve después, con los datos ya en la base
   * ════════════════════════════════════════════════════════════════════ */

  describe("resolución del agente sobre datos reales", () => {
    it("manda la imagen del producto aunque su etiqueta diga otra cosa (Prioridad 1)", async () => {
      await crearProducto(orgA, "p_p1", "Amor y Amistad");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos, product_id)
        VALUES ('med_p1', ${orgA}, 'producto', 'foto_vieja_2024.jpg', 'archivo', 'image/jpeg', ${JPEG}, 'p_p1')
      `);

      const catalogo = await m.catalogoQueries.catalogoDePedidos(orgA);
      const foto = await m.fotos.fotoPorEtiqueta(orgA, "Amor y Amistad", catalogo);

      expect(foto?.id).toBe("med_p1");
    }, 60_000);

    it("una imagen DESVINCULADA no vuelve por el respaldo de texto", async () => {
      await crearProducto(orgA, "p_fallback", "Amor y Amistad");
      const guardada = await m.catalogoImagenes.guardarImagenDeProducto(
        orgA,
        "p_fallback",
        { base64: JPEG, mimeType: "image/jpeg" },
        "user:test"
      );
      const assetId = (guardada as { ok: true; id: string }).id;
      await db.execute(sql`
        INSERT INTO campaign (id, organization_id, name, media_asset_id)
        VALUES ('cmp_fb', ${orgA}, 'La usa', ${assetId})
      `);
      await m.catalogoImagenes.eliminarImagenDeProducto(orgA, "p_fallback");
      // El recurso SIGUE existiendo (lo protege la campaña): si volviera por
      // la coincidencia de texto, esta prueba lo caza.
      expect(await filaDelAsset(assetId)).not.toBeNull();

      const catalogo = await m.catalogoQueries.catalogoDePedidos(orgA);

      expect(await m.fotos.fotoPorEtiqueta(orgA, "Amor y Amistad", catalogo)).toBeNull();
      expect(await m.fotos.fotoPorEtiqueta(orgA, "amor y amistad", catalogo)).toBeNull();
    }, 60_000);

    it("preguntar por algo que no es un producto sigue alcanzando la carta", async () => {
      await crearProducto(orgA, "p_otro", "Amor y Amistad");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_carta2', ${orgA}, 'carta', 'Carta completa', 'archivo', 'application/pdf', ${JPEG})
      `);

      const catalogo = await m.catalogoQueries.catalogoDePedidos(orgA);
      const foto = await m.fotos.fotoPorEtiqueta(orgA, "Carta completa", catalogo);

      expect(foto?.id).toBe("med_carta2");
    }, 60_000);

    it("un recurso de OTRA organización nunca se resuelve desde esta", async () => {
      await crearProducto(orgA, "p_aislado", "Exclusivo");
      await db.execute(sql`
        INSERT INTO media_asset (id, organization_id, kind, etiqueta, entrega, mime_type, datos)
        VALUES ('med_de_b', ${orgB}, 'producto', 'Exclusivo', 'archivo', 'image/jpeg', ${JPEG})
      `);

      const catalogo = await m.catalogoQueries.catalogoDePedidos(orgA);

      expect(await m.fotos.fotoPorEtiqueta(orgA, "Exclusivo", catalogo)).toBeNull();
    }, 60_000);
  });
});
