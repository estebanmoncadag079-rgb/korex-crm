import { describe, expect, it } from "vitest";

/**
 * `detectarConsultaFactualDeProducto` decide, sin ningún LLM, si un mensaje
 * es una pregunta factual concreta ("¿tienen X?") que debe forzar
 * `consultar_producto`, o una pregunta abierta ("qué me recomiendas") que
 * debe seguir usando el catálogo completo (docs/korexia/143).
 */

import { detectarConsultaFactualDeProducto } from "@/server/catalog/deteccion";

describe("detectarConsultaFactualDeProducto — TIPO A (factual concreta)", () => {
  it("¿tienen X?", () => {
    expect(detectarConsultaFactualDeProducto("¿Tienen torta de chocolate?")).toBe(
      "torta de chocolate"
    );
  });

  it("el caso real del incidente: ¿tienen disponible X?", () => {
    expect(
      detectarConsultaFactualDeProducto("¿Tienen disponible torta de chocolate?")
    ).toBe("torta de chocolate");
  });

  it("¿venden X?", () => {
    expect(detectarConsultaFactualDeProducto("¿Venden cupcakes?")).toBe("cupcakes");
  });

  it("¿hay X?", () => {
    expect(detectarConsultaFactualDeProducto("¿Hay cheesecake?")).toBe("cheesecake");
  });

  it("¿manejan X?", () => {
    expect(detectarConsultaFactualDeProducto("¿Manejan tortas sin azúcar?")).toBe(
      "tortas sin azucar"
    );
  });

  it("¿cuánto cuesta X?", () => {
    expect(
      detectarConsultaFactualDeProducto("¿Cuánto cuesta la torta de chocolate?")
    ).toBe("torta de chocolate");
  });

  it("¿cuánto vale X?", () => {
    expect(
      detectarConsultaFactualDeProducto("¿Cuánto vale la porción de chocolate?")
    ).toBe("porcion de chocolate");
  });

  it("tolera texto alrededor (saludo, sin signos de apertura)", () => {
    expect(detectarConsultaFactualDeProducto("Hola, tienen cupcakes de vainilla?")).toBe(
      "cupcakes de vainilla"
    );
  });
});

describe("detectarConsultaFactualDeProducto — TIPO B (abierta, NO forzar)", () => {
  it("¿qué tienen de X? es una categoría, no un producto concreto", () => {
    expect(detectarConsultaFactualDeProducto("¿Qué tienen de chocolate?")).toBeNull();
  });

  it("tienen algo de X también es abierta", () => {
    expect(detectarConsultaFactualDeProducto("¿Tienen algo de chocolate?")).toBeNull();
  });

  it("una recomendación", () => {
    expect(detectarConsultaFactualDeProducto("¿Qué me recomiendas?")).toBeNull();
  });

  it("una ocasión con cantidad de personas", () => {
    expect(
      detectarConsultaFactualDeProducto("Quiero algo para 15 personas.")
    ).toBeNull();
  });

  it("una restricción de sabor (no tan dulce)", () => {
    expect(detectarConsultaFactualDeProducto("Busco algo no tan dulce.")).toBeNull();
  });

  it("una ocasión de regalo", () => {
    expect(
      detectarConsultaFactualDeProducto("Quiero algo para el cumpleaños de mi mamá.")
    ).toBeNull();
  });

  it("un saludo suelto no dispara nada", () => {
    expect(detectarConsultaFactualDeProducto("Hola, buenas noches")).toBeNull();
  });

  it("una pregunta de precio sin producto nombrado (depende del contexto)", () => {
    expect(detectarConsultaFactualDeProducto("¿Cuánto cuesta?")).toBeNull();
  });

  it("texto vacío o nulo", () => {
    expect(detectarConsultaFactualDeProducto("")).toBeNull();
    expect(detectarConsultaFactualDeProducto("   ")).toBeNull();
  });
});
