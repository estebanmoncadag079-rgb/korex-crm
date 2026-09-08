import { describe, expect, it } from "vitest";

/**
 * `buscarProductos` es la mitad del catálogo que hace verificable el caso
 * real que lo originó (25-ago-2026, Lis): "torta de chocolate" tiene que
 * resolver a "Porción Chocolate" sin que el modelo tenga que adivinarlo
 * leyendo el catálogo como prosa.
 */

import { buscarProductos, type ResultadoBusquedaProducto } from "@/server/catalog/buscar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

function producto(id: string, nombre: string, precioCents: number | null = 1000000): ProductoDelCatalogo {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

const CATALOGO_LIS: ProductoDelCatalogo[] = [
  producto("p1", "Porción Chocolate"),
  producto("p2", "Porción Fresa"),
  producto("p3", "Torta Completa Vainilla"),
  producto("p4", "Cupcake Red Velvet"),
];

describe("buscarProductos", () => {
  it("encuentra por coincidencia exacta, sin importar mayúsculas ni tildes", () => {
    const r = buscarProductos(CATALOGO_LIS, "porción chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p1");

    expect(buscarProductos(CATALOGO_LIS, "PORCION FRESA").status).toBe("found");
  });

  it("resuelve el caso real: 'torta de chocolate' → Porción Chocolate", () => {
    const r = buscarProductos(CATALOGO_LIS, "torta de chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p1");
  });

  it("encuentra por substring único", () => {
    const r = buscarProductos(CATALOGO_LIS, "red velvet");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p4");
  });

  it("devuelve multiple_matches cuando dos productos empatan igual de bien (mismos tokens, distinto orden)", () => {
    const empatados: ProductoDelCatalogo[] = [
      producto("x", "Combo Familiar Grande"),
      producto("y", "Combo Grande Familiar"),
    ];
    // "ya" al final evita que la consulta sea substring exacto de cualquiera
    // de los dos nombres (eso resolvería por substring único, no por tokens).
    const r = buscarProductos(empatados, "grande familiar combo ya");
    expect(r.status).toBe("multiple_matches");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "multiple_matches" }>).productos).toHaveLength(2);
  });

  it("no inventa un match cuando no hay ninguno razonable", () => {
    expect(buscarProductos(CATALOGO_LIS, "servicio a domicilio en Bogotá").status).toBe("not_found");
  });

  it("con el catálogo vacío, nunca encuentra nada", () => {
    expect(buscarProductos([], "torta de chocolate").status).toBe("not_found");
  });

  it("con una consulta vacía, nunca encuentra nada", () => {
    expect(buscarProductos(CATALOGO_LIS, "   ").status).toBe("not_found");
  });
});

describe("buscarProductos — Fase 10S: coincide() no debe fusionar palabras distintas", () => {
  it("BUG REAL: 'limon' encuentra la 'Bebida de Limón Natural' correcta, no 'Limonada' por prefijo compartido", () => {
    const catalogo: ProductoDelCatalogo[] = [
      producto("b1", "Bebida de Limón Natural"),
      producto("b2", "Limonada"),
    ];
    const r = buscarProductos(catalogo, "limon");
    // Antes del fix: "found" -> Limonada (ratio 1/1 le ganaba a la bebida
    // por tener menos tokens, sin pasar por multiple_matches).
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("b1");
  });

  it("BUG REAL: 'chocolate' y 'choconuez' no deben tratarse como el mismo producto por compartir 5 letras de prefijo", () => {
    const catalogo: ProductoDelCatalogo[] = [
      producto("c1", "Torta Choconuez"),
      producto("c2", "Porción Chocolate"),
    ];
    const r = buscarProductos(catalogo, "chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("c2");
  });

  it("sigue tolerando plural simple: 'tortas' encuentra 'Torta Completa Vainilla'", () => {
    const r = buscarProductos(CATALOGO_LIS, "tortas de vainilla");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p3");
  });
});

/**
 * Fase 8E — incidente REAL de producción (8-sep-2026, 13:37-13:54, MALIA,
 * conversación cv_2xfh67lig9a07xzief96). Catálogo real de esa organización:
 * solo "Botella de Agua", "Pavé Cremoso 8 oz" y "Pavé Cremoso 16 oz" —
 * "oblea" no existe ni como producto ni como opción (verificado en la base
 * de producción: 0 filas).
 *
 * La clienta pidió "el pavé de oblea". `buscarProductos` devolvía
 * `found: Pavé Cremoso 8 oz` (el único token que coincidía era "pave", que
 * comparten los dos productos; "oblea" no coincidía con nada; el desempate
 * lo decidía `ratio`, que ahí solo premia al nombre más corto). Ese `found`
 * viaja al prompt como hecho verificado y `contradiceProductoEncontrado`
 * obliga al modelo a sostenerlo — en la traza real quedó registrado:
 * `hechos=producto:"el pave de oblea"=found@backend` y
 * `guardarrailes=producto_contradicho:corrigio`.
 *
 * Consecuencia medida: el bot ofreció el pavé de oblea en 8 y 16 oz, el
 * carrito real rechazó "Oblea" cinco veces en silencio, el cierre falló por
 * `subtotal-no-coincide-con-el-carrito` y el pedido acabó en derivación —
 * la clienta lo canceló.
 */
describe("buscarProductos — Fase 8E: un match de puro nombre de familia no es un hallazgo", () => {
  const CATALOGO_MALIA: ProductoDelCatalogo[] = [
    producto("m1", "Botella de Agua", 300000),
    producto("m2", "Pavé Cremoso 16 oz", 1800000),
    producto("m3", "Pavé Cremoso 8 oz", 1000000),
  ];

  it("BUG REAL: 'el pave de oblea' NO puede resolver a 'Pavé Cremoso 8 oz'", () => {
    expect(buscarProductos(CATALOGO_MALIA, "el pave de oblea").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA, "pavé de oblea").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA, "pave de oblea").status).toBe("not_found");
  });

  it("lo que SÍ está en el catálogo se sigue encontrando igual", () => {
    // Sin palabras sin explicar: el match cubre lo que pidió la clienta.
    const r = buscarProductos(CATALOGO_MALIA, "el de 8 oz");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("m3");

    const r2 = buscarProductos(CATALOGO_MALIA, "pavé cremoso 16 oz");
    expect(r2.status).toBe("found");
    expect((r2 as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("m2");

    // "16" distingue a ese producto de su hermano: aunque "maracuyá" quede
    // sin explicar (es una OPCIÓN, la resuelve `buscarOpciones` después),
    // el producto sí quedó identificado de verdad.
    const r3 = buscarProductos(CATALOGO_MALIA, "pave cremoso 16 oz de maracuya");
    expect(r3.status).toBe("found");
    expect((r3 as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("m2");

    expect(buscarProductos(CATALOGO_MALIA, "botella de agua").status).toBe("found");
  });

  it("no rompe el caso original de Lis: 'torta de chocolate' sigue resolviendo (chocolate SÍ distingue)", () => {
    const r = buscarProductos(CATALOGO_LIS, "torta de chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p1");
  });
});
