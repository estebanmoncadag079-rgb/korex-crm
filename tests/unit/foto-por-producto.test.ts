import { describe, expect, it } from "vitest";
import { resolverFoto, type FotoConProducto } from "@/server/ai/fotos";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * Fase 4 (imágenes de productos del catálogo) — la resolución real pasó de
 * ser "solo etiqueta" a dos prioridades:
 *
 *   1. `product_id`: si lo que pide el cliente resuelve a UN producto real
 *      del catálogo, y ese producto tiene una imagen vinculada, es esa —
 *      sin importar si el texto de `etiqueta` coincide o no.
 *   2. `etiqueta` (comportamiento histórico, sin tocar `elegirFoto`): igual
 *      que siempre, para recursos sin producto (`carta`/`otro`) o productos
 *      todavía sin vincular.
 *
 * `resolverFoto` es puro (sin DB) a propósito, mismo criterio que ya usa
 * `elegirFoto`: la prioridad se puede probar con fixtures en memoria, sin
 * mocks de Postgres.
 */

function producto(id: string, nombre: string): ProductoDelCatalogo {
  return { id, nombre, categoria: null, precioCents: null, descripcion: null, grupos: [] };
}

const CATALOGO: ProductoDelCatalogo[] = [
  producto("p_amor", "Amor y Amistad"),
  producto("p_navidad", "Combo Navidad"),
];

describe("resolverFoto: Prioridad 1, por product_id", () => {
  it("usa la imagen vinculada al producto aunque su etiqueta sea otro texto", () => {
    const fotos: FotoConProducto[] = [
      { id: "m1", etiqueta: "foto_vieja_2024.jpg", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: "p_amor" },
    ];
    const resultado = resolverFoto(fotos, "Amor y Amistad", CATALOGO);
    expect(resultado?.id).toBe("m1");
  });

  it("distingue entre dos productos parecidos por su product_id real, no por texto", () => {
    const fotos: FotoConProducto[] = [
      { id: "m_amor", etiqueta: "img1", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: "p_amor" },
      { id: "m_navidad", etiqueta: "img2", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: "p_navidad" },
    ];
    expect(resolverFoto(fotos, "Combo Navidad", CATALOGO)?.id).toBe("m_navidad");
    expect(resolverFoto(fotos, "Amor y Amistad", CATALOGO)?.id).toBe("m_amor");
  });
});

describe("resolverFoto: cae a Prioridad 2 (etiqueta) sin romper nada existente", () => {
  it("el producto existe pero no tiene imagen vinculada -> resuelve por etiqueta si hay una que calce", () => {
    const fotos: FotoConProducto[] = [
      { id: "m1", etiqueta: "Amor y Amistad", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: null },
    ];
    expect(resolverFoto(fotos, "Amor y Amistad", CATALOGO)?.id).toBe("m1");
  });

  it("la búsqueda de producto es ambigua (multiple_matches) -> no adivina por producto, cae a etiqueta (que aquí SÍ distingue, por texto exacto)", () => {
    const catalogoAmbiguo = [producto("p1", "Volumen Ruso"), producto("p2", "Volumen Americano")];
    const fotos: FotoConProducto[] = [
      { id: "m1", etiqueta: "Volumen Ruso", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: null },
      { id: "m2", etiqueta: "Volumen Americano", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: null },
    ];
    // "volumen" es ambiguo tanto a nivel de producto como de etiqueta (dos
    // fotos encajan igual de bien) -> ninguna de las dos prioridades puede
    // resolver sin adivinar.
    expect(resolverFoto(fotos, "volumen", catalogoAmbiguo)).toBeNull();
    // Pero el nombre EXACTO sí distingue en la etiqueta, aunque el producto
    // siga sin resolverse por su cuenta a un id (aquí no lo necesita).
    expect(resolverFoto(fotos, "Volumen Ruso", catalogoAmbiguo)?.id).toBe("m1");
  });

  it("sin catálogo cargado (negocio en catalog_source=prompt, o citas) -> comportamiento histórico intacto", () => {
    const fotos: FotoConProducto[] = [
      { id: "m1", etiqueta: "Carta completa", kind: "carta", mimeType: "application/pdf", entrega: "archivo", url: null, productId: null },
    ];
    expect(resolverFoto(fotos, "carta", undefined)?.id).toBe("m1");
    expect(resolverFoto(fotos, "carta", [])?.id).toBe("m1");
  });

  it("recurso sin producto (carta/otro) nunca se ve afectado por la Prioridad 1", () => {
    const fotos: FotoConProducto[] = [
      { id: "m1", etiqueta: "Carta completa", kind: "carta", mimeType: "application/pdf", entrega: "archivo", url: null, productId: null },
    ];
    expect(resolverFoto(fotos, "Carta completa", CATALOGO)?.id).toBe("m1");
  });

  it("producto encontrado pero ninguna foto vinculada a NINGÚN producto -> null, nunca inventa", () => {
    const fotos: FotoConProducto[] = [
      { id: "m1", etiqueta: "Otra cosa", kind: "otro", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: null },
    ];
    expect(resolverFoto(fotos, "Amor y Amistad", CATALOGO)).toBeNull();
  });
});

/**
 * Corrección del 19-sep-2026 (auditoría independiente). Al quitarle la imagen
 * a un producto, si esa imagen la usa además una campaña o una plantilla, NO
 * se destruye: se desvincula y se conserva
 * (`desvincularMediaAssetDeProducto`) — `product_id = NULL`, `kind = "otro"` y
 * la etiqueta renombrada para liberar el nombre del producto.
 *
 * El agujero que queda si solo se hiciera eso: la TERCERA pasada de
 * `elegirFoto` es "una contiene a la otra", así que «Amor y Amistad (sin
 * producto · med_x)» seguiría encajando con «Amor y Amistad» y el agente
 * volvería a mandar la foto que el negocio acababa de quitar. Renombrar no
 * basta; hace falta que el respaldo por texto no acepte recursos que no son
 * de un producto cuando lo que se pregunta SÍ es un producto real.
 */
describe("resolverFoto: una imagen quitada del producto no vuelve por la puerta de atrás", () => {
  it("la imagen desvinculada (kind 'otro', etiqueta renombrada) ya no responde por el nombre del producto", () => {
    const fotos: FotoConProducto[] = [
      {
        id: "m_desvinculada",
        etiqueta: "Amor y Amistad (sin producto · m_desvinculada)",
        kind: "otro",
        mimeType: "image/jpeg",
        entrega: "archivo",
        url: null,
        productId: null,
      },
    ];
    expect(resolverFoto(fotos, "Amor y Amistad", CATALOGO)).toBeNull();
  });

  it("y tampoco con el nombre a secas, que es como lo escribe el modelo", () => {
    const fotos: FotoConProducto[] = [
      {
        id: "m_desvinculada",
        etiqueta: "Amor y Amistad (sin producto · m_desvinculada)",
        kind: "otro",
        mimeType: "image/jpeg",
        entrega: "archivo",
        url: null,
        productId: null,
      },
    ];
    expect(resolverFoto(fotos, "amor y amistad", CATALOGO)).toBeNull();
  });

  /*
   * El contrapeso: la restricción NO puede llevarse por delante el caso que
   * la Prioridad 2 existe para cubrir — una foto de producto que todavía no
   * está vinculada (las que subió el onboarding, las que existían antes de
   * la 0043). Esas son `kind: "producto"` y siguen resolviendo.
   */
  it("una foto de producto SIN vincular sigue resolviéndose por su etiqueta", () => {
    const fotos: FotoConProducto[] = [
      { id: "m_onboarding", etiqueta: "Amor y Amistad", kind: "producto", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: null },
    ];
    expect(resolverFoto(fotos, "Amor y Amistad", CATALOGO)?.id).toBe("m_onboarding");
  });

  /*
   * Y la restricción solo se aplica cuando el catálogo identificó un producto
   * REAL: preguntar por la carta, por el local o por cualquier cosa que no
   * sea un artículo sigue usando el respaldo histórico completo, sin filtrar
   * por `kind`. Esto es lo que impide que la corrección rompa "muéstrame la
   * carta" o "una foto del local".
   */
  it("preguntar por algo que NO es un producto del catálogo sigue alcanzando recursos 'otro'", () => {
    const fotos: FotoConProducto[] = [
      { id: "m_local", etiqueta: "Nuestro local", kind: "otro", mimeType: "image/jpeg", entrega: "archivo", url: null, productId: null },
    ];
    expect(resolverFoto(fotos, "Nuestro local", CATALOGO)?.id).toBe("m_local");
  });

  it("la imagen desvinculada SÍ sigue siendo alcanzable por su nombre nuevo completo", () => {
    // No queda inaccesible ni invisible: sigue en Recursos, con un nombre que
    // dice lo que le pasó, y la campaña que la usa sigue funcionando.
    const fotos: FotoConProducto[] = [
      {
        id: "m_desvinculada",
        etiqueta: "Amor y Amistad (sin producto · m_desvinculada)",
        kind: "otro",
        mimeType: "image/jpeg",
        entrega: "archivo",
        url: null,
        productId: null,
      },
    ];
    expect(resolverFoto(fotos, "Amor y Amistad (sin producto · m_desvinculada)", undefined)?.id).toBe(
      "m_desvinculada"
    );
  });
});

describe("resolverFoto: aislamiento — nunca cruza organizaciones", () => {
  it("una foto vinculada al product_id de OTRA organización simplemente no existe en este arreglo, así que no puede match-ear", () => {
    // `fotos` y `catalogo` ya llegan pre-filtrados por organizationId (los
    // arma `fotosDeLaOrganizacion`/`catalogoDePedidosQuery`, ambos scoped) —
    // esta prueba documenta esa garantía: un product_id que no está en el
    // catálogo de ESTA organización nunca puede aparecer en `fotos` de ESTA
    // organización, por construcción de las dos consultas de origen.
    const fotosDeOtraOrg: FotoConProducto[] = [];
    expect(resolverFoto(fotosDeOtraOrg, "Amor y Amistad", CATALOGO)).toBeNull();
  });
});
