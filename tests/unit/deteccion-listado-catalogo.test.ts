import { describe, expect, it } from "vitest";

/**
 * `detectarConsultaDeListadoDeProducto` — auditoría de jerarquía de verdad
 * (1-sep-2026): cubre las preguntas de LISTADO abierto de catálogo ("¿qué
 * sabores tienen?") que `detectarConsultaFactualDeProducto` excluye a
 * propósito por ser abiertas. El incidente real de Malía fue exactamente una
 * de estas: "¿cuáles son los sabores que tienes?" tras un mensaje humano
 * desactualizado en el historial ("no tenemos Leche Klim").
 */

import { detectarConsultaDeListadoDeProducto } from "@/server/catalog/deteccion";

describe("detectarConsultaDeListadoDeProducto — debe detectar", () => {
  it("el caso real del incidente: ¿cuáles son los sabores que tienes?", () => {
    expect(
      detectarConsultaDeListadoDeProducto("¿Cuáles son los sabores que tienes?")
    ).toBe(true);
  });

  it("¿qué sabores tienen?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué sabores tienen?")).toBe(true);
  });

  it("¿qué sabores tienes?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué sabores tienes?")).toBe(true);
  });

  it("¿cuáles sabores manejan?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Cuáles sabores manejan?")).toBe(true);
  });

  it("¿qué sabores están disponibles?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué sabores están disponibles?")).toBe(
      true
    );
  });

  it("¿qué productos tienen?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué productos tienen?")).toBe(true);
  });

  it("¿qué productos manejan?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué productos manejan?")).toBe(true);
  });

  it("¿qué tamaños tienen?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué tamaños tienen?")).toBe(true);
  });

  it("¿cuáles tamaños manejan?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Cuáles tamaños manejan?")).toBe(true);
  });

  it("¿qué opciones hay?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué opciones hay?")).toBe(true);
  });

  it("¿qué presentaciones tienen?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué presentaciones tienen?")).toBe(true);
  });

  it("¿qué venden? (genérico, sin objeto)", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué venden?")).toBe(true);
  });

  it("¿qué manejan? (genérico, sin objeto)", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué manejan?")).toBe(true);
  });

  it("¿qué tienes disponible?", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué tienes disponible?")).toBe(true);
  });

  it("el caso de precedencia (Fase C.1): ¿qué sabores tienen disponibles?", () => {
    expect(
      detectarConsultaDeListadoDeProducto("¿Qué sabores tienen disponibles?")
    ).toBe(true);
  });

  it("tolera texto alrededor (saludo, sin signos de apertura)", () => {
    expect(detectarConsultaDeListadoDeProducto("Hola, qué sabores tienen?")).toBe(true);
  });
});

describe("detectarConsultaDeListadoDeProducto — NO debe dispararse", () => {
  it("consulta puntual de un producto: no es un listado", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Tienen Pavé de Leche Klim?")).toBe(false);
  });

  it("categoría con calificativo ('de chocolate'): sigue como abierta, sin forzar", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué tienen de chocolate?")).toBe(false);
  });

  it("qué tienen de bueno hoy: tiene texto después del verbo, no es un listado genérico", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué tienen de bueno hoy?")).toBe(false);
  });

  it("una recomendación", () => {
    expect(detectarConsultaDeListadoDeProducto("¿Qué me recomiendas?")).toBe(false);
  });

  it("una ocasión con cantidad de personas", () => {
    expect(
      detectarConsultaDeListadoDeProducto("Quiero algo para 15 personas.")
    ).toBe(false);
  });

  it("un saludo suelto", () => {
    expect(detectarConsultaDeListadoDeProducto("Hola, buenas noches")).toBe(false);
  });

  it("una pregunta de precio de un producto puntual", () => {
    expect(
      detectarConsultaDeListadoDeProducto("¿Cuánto cuesta la torta de chocolate?")
    ).toBe(false);
  });

  it("un compromiso conversacional, no una consulta de catálogo", () => {
    expect(
      detectarConsultaDeListadoDeProducto("Perfecto, paso por él más tarde.")
    ).toBe(false);
  });

  it("texto vacío o nulo", () => {
    expect(detectarConsultaDeListadoDeProducto("")).toBe(false);
    expect(detectarConsultaDeListadoDeProducto("   ")).toBe(false);
  });
});
