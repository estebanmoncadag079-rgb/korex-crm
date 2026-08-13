import { describe, expect, it } from "vitest";
import {
  catalogoATexto,
  type ProductoExtraido,
} from "@/server/ai/generador/extraer-catalogo";

/**
 * El paso de la lista extraída al texto que guarda la ficha.
 *
 * Se prueba aparte de la extracción a propósito: esto es una función pura y se
 * puede verificar sin llamar a ningún modelo. La lectura de la imagen se probó
 * contra el modelo real con una carta de 12 servicios (12 de 12 correctos).
 */

describe("catalogoATexto", () => {
  it("da una línea por producto, con el precio formateado", () => {
    const productos: ProductoExtraido[] = [
      { nombre: "Volumen Ruso", precio: 150000 },
      { nombre: "Semipermanente", precio: 45000 },
    ];
    expect(catalogoATexto(productos)).toBe(
      "Volumen Ruso — $150.000\nSemipermanente — $45.000"
    );
  });

  it("añade la duración cuando la carta la trae", () => {
    expect(
      catalogoATexto([{ nombre: "Lifting", precio: 65000, duracionMin: 60 }])
    ).toBe("Lifting — $65.000 · 60 min");
  });

  /**
   * Lo que NO se hace es inventar el precio. Un hueco visible obliga a
   * completarlo; un precio adivinado se repite a los clientes durante meses
   * sin que nadie lo note — que es justo lo que pasó al cargar a mano el
   * catálogo del salón, con 12 precios equivocados.
   */
  it("deja marcado el hueco cuando no se leyó el precio", () => {
    const texto = catalogoATexto([{ nombre: "Retoque", precio: null }]);
    expect(texto).toContain("falta el precio");
    expect(texto).not.toMatch(/\$\d/);
  });

  it("con la lista vacía devuelve una cadena vacía, no un salto suelto", () => {
    expect(catalogoATexto([])).toBe("");
  });
});
