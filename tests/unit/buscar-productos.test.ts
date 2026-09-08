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
