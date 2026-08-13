import { describe, expect, it } from "vitest";
import {
  catalogoATexto,
  type ProductoExtraido,
} from "@/server/ai/generador/extraer-catalogo";
import { leerCatalogoPegado } from "@/lib/catalogo-texto";

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

  /**
   * Las categorías del catálogo del salón (Pestañas pelo a pelo, Volumen
   * tecnológico, Retoques…) tienen que sobrevivir el viaje: se escriben como
   * título en MAYÚSCULAS, que es lo que `leerCatalogoPegado` vuelve a leer al
   * aplicar la ficha. Sin esto, 34 servicios acaban todos sin agrupar.
   */
  it("agrupa por categoría con el título en mayúsculas", () => {
    const texto = catalogoATexto([
      { nombre: "Volumen ruso", precio: 150000, duracionMin: 180, categoria: "Pestañas" },
      { nombre: "Cejas en henna", precio: 30000, duracionMin: 45, categoria: "Cejas" },
      { nombre: "Lifting", precio: 80000, duracionMin: 60, categoria: "Pestañas" },
    ]);
    expect(texto).toBe(
      "PESTAÑAS\nVolumen ruso — $150.000 · 180 min\nLifting — $80.000 · 60 min\n\nCEJAS\nCejas en henna — $30.000 · 45 min"
    );
  });

  it("los que no traen categoría van al final, sin título inventado", () => {
    const texto = catalogoATexto([
      { nombre: "Retoque", precio: 40000 },
      { nombre: "Volumen ruso", precio: 150000, categoria: "Pestañas" },
    ]);
    expect(texto).toBe("PESTAÑAS\nVolumen ruso — $150.000\n\nRetoque — $40.000");
  });

  /**
   * El viaje completo, que es donde estaba el fallo: lo leído del PDF se
   * escribe en la ficha como texto y `leerCatalogoPegado` lo vuelve a leer al
   * crear los servicios. Si el texto pierde los minutos, un servicio de 3 horas
   * entra como la duración típica y el salón acepta tres clientas a la vez.
   */
  it("ida y vuelta: lo leído del PDF conserva precio, duración y categoría", () => {
    const leidoDelPdf: ProductoExtraido[] = [
      { nombre: "Volumen ruso", precio: 150000, duracionMin: 180, categoria: "Pestañas" },
      { nombre: "Cejas en henna", precio: 30000, duracionMin: 45, categoria: "Cejas" },
    ];
    expect(leerCatalogoPegado(catalogoATexto(leidoDelPdf))).toEqual([
      { nombre: "Volumen ruso", precio: 150000, duracionMin: 180, categoria: "PESTAÑAS" },
      { nombre: "Cejas en henna", precio: 30000, duracionMin: 45, categoria: "CEJAS" },
    ]);
  });
});
