import { describe, expect, it } from "vitest";
import { buscarOpciones, buscarProductos } from "@/server/catalog/buscar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * Fase urgente (4-sep-2026) — incidente real de La Churra: "¿tienen
 * chocolate blanco?" es una salsa (una opción DENTRO de cada producto,
 * `producto.grupos[].opciones[]`), no un producto en sí. `buscarProductos`
 * solo compara contra NOMBRES DE PRODUCTO — nunca contra las opciones —
 * así que devolvía `not_found`, y el pipeline lo convertía en "[SISTEMA]
 * no lo tienen": una afirmación falsa sobre algo que sí estaba en el
 * catálogo real, un nivel más abajo.
 *
 * "No encontrado en una fuente" nunca puede leerse como "no existe" sin
 * haber consultado también esta fuente — estas pruebas verifican
 * `buscarOpciones` en aislamiento (la función pura); el cableado completo
 * con el pipeline (que decide el texto `[SISTEMA]` final) se prueba en
 * `pipeline-salsas-y-opciones.test.ts`.
 */

function opcion(id: string, nombre: string, precioExtraCents = 0) {
  return { id, nombre, precioExtraCents };
}

function producto(
  id: string,
  nombre: string,
  grupos: { id: string; nombre: string; minimo: number; maximo: number; opciones: ReturnType<typeof opcion>[] }[] = []
): ProductoDelCatalogo {
  return {
    id,
    nombre,
    categoria: null,
    precioCents: 1000000,
    descripcion: null,
    grupos: grupos.map((g) => ({ ...g, permiteRepeticion: false })),
  };
}

describe("buscarOpciones", () => {
  it("TEST 1: una salsa disponible dentro de un producto se encuentra, aunque no exista como producto", () => {
    const catalogo = [
      producto("prod_churrita", "CHURRITA", [
        {
          id: "grp_salsa",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [
            opcion("opt_arequipe", "arequipe"),
            opcion("opt_choco_blanco", "chocolate blanco"),
            opcion("opt_choco_negro", "chocolate negro"),
          ],
        },
      ]),
    ];

    // Primero se confirma que NO es un producto (el mismo paso que dio el
    // falso negativo en el incidente real).
    expect(buscarProductos(catalogo, "chocolate blanco").status).toBe("not_found");

    const r = buscarOpciones(catalogo, "chocolate blanco");
    expect(r.status).toBe("found");
    if (r.status === "found") {
      expect(r.encontrada.opcion.nombre).toBe("chocolate blanco");
      expect(r.encontrada.productos.map((p) => p.nombre)).toEqual(["CHURRITA"]);
    }
  });

  it("TEST 1b: reproduce la consulta REAL del incidente ('la salsa de chocolate blanco') vía substring, sin exigir coincidencia exacta", () => {
    const catalogo = [
      producto("prod_churrita", "CHURRITA", [
        {
          id: "grp_salsa",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_choco_blanco", "chocolate blanco")],
        },
      ]),
    ];
    const r = buscarOpciones(catalogo, "la salsa de chocolate blanco");
    expect(r.status).toBe("found");
  });

  it("TEST 2: una opción marcada NO disponible (filtrada aguas arriba por catalogoDePedidos) nunca se afirma como disponible", () => {
    // `catalogoDePedidos` ya filtra `available=true` en la consulta real
    // (mismo criterio que ya aplica a productos) — una opción desactivada
    // simplemente NO aparece en `producto.grupos[].opciones[]`. Se simula
    // aquí construyendo el catálogo SIN esa opción, tal como llegaría del
    // query real.
    const catalogoSinChocolateBlanco = [
      producto("prod_churrita", "CHURRITA", [
        {
          id: "grp_salsa",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_arequipe", "arequipe")], // chocolate blanco desactivado, no llega aquí
        },
      ]),
    ];
    const r = buscarOpciones(catalogoSinChocolateBlanco, "chocolate blanco");
    expect(r.status).toBe("not_found");
  });

  it("TEST 3: nombre de salsa igual/parecido al de un producto -> cada búsqueda distingue su propio tipo de entidad", () => {
    const catalogo = [
      producto("prod_besties", "BESTIES", [
        {
          id: "grp_salsa",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_besties", "besties especial")], // nombre parecido al producto, a propósito
        },
      ]),
    ];

    const comoProducto = buscarProductos(catalogo, "besties");
    expect(comoProducto.status).toBe("found");
    if (comoProducto.status === "found") expect(comoProducto.producto.nombre).toBe("BESTIES");

    const comoOpcion = buscarOpciones(catalogo, "besties especial");
    expect(comoOpcion.status).toBe("found");
    if (comoOpcion.status === "found") expect(comoOpcion.encontrada.opcion.nombre).toBe("besties especial");
  });

  it("TEST 4: una salsa existe para un producto pero no para otro -> la relación real se respeta, no se asume universal", () => {
    const catalogo = [
      producto("prod_churrita", "CHURRITA", [
        {
          id: "grp_salsa_churrita",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_choco_blanco_churrita", "chocolate blanco")],
        },
      ]),
      // MEGA BOX NO tiene grupo de salsas en absoluto en este catálogo.
      producto("prod_megabox", "MEGA BOX", []),
    ];

    const r = buscarOpciones(catalogo, "chocolate blanco");
    expect(r.status).toBe("found");
    if (r.status === "found") {
      expect(r.encontrada.productos.map((p) => p.nombre)).toEqual(["CHURRITA"]);
      expect(r.encontrada.productos.map((p) => p.nombre)).not.toContain("MEGA BOX");
    }
  });

  it("TEST 5: multi-tenant — el catálogo de un tenant nunca contamina la búsqueda del otro (aislamiento a nivel de función pura: cada llamada recibe SOLO el catálogo ya scoped() de su organización)", () => {
    const catalogoTenantA = [
      producto("prod_a", "CHURRITA", [
        {
          id: "grp_a",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_a", "chocolate blanco")],
        },
      ]),
    ];
    const catalogoTenantB = [producto("prod_b", "COMBO", [])]; // Tenant B no tiene esa salsa

    expect(buscarOpciones(catalogoTenantA, "chocolate blanco").status).toBe("found");
    expect(buscarOpciones(catalogoTenantB, "chocolate blanco").status).toBe("not_found");
  });

  it("TEST 6: una consulta sin ninguna relación real no se confunde con un producto NI con una opción existente", () => {
    const catalogo = [
      producto("prod_churrita", "CHURRITA", [
        {
          id: "grp_salsa",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_choco_blanco", "chocolate blanco")],
        },
      ]),
    ];

    // Sin ningún token en común con "CHURRITA" ni con "chocolate blanco":
    // ni producto ni opción deben inventarse una coincidencia.
    expect(buscarProductos(catalogo, "servicio de manicure").status).toBe("not_found");
    expect(buscarOpciones(catalogo, "servicio de manicure").status).toBe("not_found");
  });

  it("una consulta con una palabra en común (pero de otra familia de producto) sí puede calzar por token — mismo criterio ya probado y aceptado para buscarProductos (caso real 'torta de chocolate' -> 'Porción Chocolate')", () => {
    const catalogo = [
      producto("prod_churrita", "CHURRITA", [
        {
          id: "grp_salsa",
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          opciones: [opcion("opt_choco_blanco", "chocolate blanco")],
        },
      ]),
    ];
    // Comparte la palabra "chocolate": el mismo algoritmo de tokens que ya
    // resuelve "torta de chocolate" -> "Porción Chocolate" para productos
    // también encuentra esta opción — comportamiento intencional, no un
    // falso positivo nuevo introducido aquí.
    expect(buscarOpciones(catalogo, "torta de chocolate").status).toBe("found");
  });

  it("agrupa la MISMA opción repetida en varios productos en un solo resultado, listando a todos los que la ofrecen", () => {
    const catalogo = [
      producto("prod_churrita", "CHURRITA", [
        { id: "g1", nombre: "SALSA", minimo: 1, maximo: 1, opciones: [opcion("o1", "chocolate blanco")] },
      ]),
      producto("prod_besties", "BESTIES", [
        { id: "g2", nombre: "SALSA", minimo: 1, maximo: 1, opciones: [opcion("o2", "chocolate blanco")] },
      ]),
    ];
    const r = buscarOpciones(catalogo, "chocolate blanco");
    expect(r.status).toBe("found");
    if (r.status === "found") {
      expect(r.encontrada.productos.map((p) => p.nombre).sort()).toEqual(["BESTIES", "CHURRITA"]);
    }
  });

  it("varias opciones DISTINTAS que calzan por token -> multiple_matches, nunca asume ninguna", () => {
    const catalogo = [
      producto("prod_x", "COMBO", [
        {
          id: "g1",
          nombre: "TOPPING",
          minimo: 0,
          maximo: 2,
          opciones: [opcion("o1", "chispas de chocolate"), opcion("o2", "lluvia de chocolate")],
        },
      ]),
    ];
    const r = buscarOpciones(catalogo, "chocolate");
    expect(r.status).toBe("multiple_matches");
  });

  it("catálogo vacío o sin ninguna opción -> not_found, nunca lanza", () => {
    expect(buscarOpciones([], "chocolate blanco").status).toBe("not_found");
    expect(buscarOpciones([producto("p1", "SOLO")], "chocolate blanco").status).toBe("not_found");
  });
});
