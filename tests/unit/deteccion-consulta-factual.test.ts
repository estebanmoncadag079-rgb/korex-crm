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

  it("2ª persona — ¿tienes X? (el incidente real de Malía usó esta conjugación)", () => {
    expect(detectarConsultaFactualDeProducto("¿Tienes Pavé de Leche Klim?")).toBe(
      "pave de leche klim"
    );
  });

  it("2ª persona — ¿vendes X?", () => {
    expect(detectarConsultaFactualDeProducto("¿Vendes cupcakes?")).toBe("cupcakes");
  });

  it("2ª persona — ¿manejas X?", () => {
    expect(detectarConsultaFactualDeProducto("¿Manejas tortas sin azúcar?")).toBe(
      "tortas sin azucar"
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

  it("2ª persona, categoría con calificativo: ¿qué tienes de chocolate? sigue abierta", () => {
    expect(detectarConsultaFactualDeProducto("¿Qué tienes de chocolate?")).toBeNull();
  });
});

describe("detectarConsultaFactualDeProducto — domicilio/envío NUNCA es un producto", () => {
  /**
   * Incidente real (MALIA, 12-sep-2026, conv cv_jzr8hvnt02m1zvvzqgyy):
   * "Hola! Tienes domi a ciudad pacífica?" hizo que este detector buscara
   * "domi a ciudad pacifica" en el catálogo de PAVÉS, diera `not_found`, y
   * ese hecho falso contradijera al detector de zonas (que sí encontró
   * "Ciudad Pacífica" a $12.000) en el mismo turno. El modelo recibió dos
   * hechos "verificados" que se contradecían, redactó algo que negaba la
   * tarifa real, y terminó derivando sin haberle respondido nada al cliente.
   */
  it("EL INCIDENTE: 'tienes domi a X?' no es una pregunta de producto", () => {
    expect(
      detectarConsultaFactualDeProducto("Hola! Tienes domi a ciudad pacífica?")
    ).toBeNull();
  });

  it("'domicilio' con el verbo de existencia, igual de bloqueado", () => {
    expect(detectarConsultaFactualDeProducto("¿Tienen domicilio a Kachipay?")).toBeNull();
    expect(detectarConsultaFactualDeProducto("¿Hacen domicilios?")).toBeNull();
  });

  it("'envío' con el patrón de precio, igual de bloqueado", () => {
    expect(
      detectarConsultaFactualDeProducto("¿Cuánto cuesta el envío a Talanga?")
    ).toBeNull();
    expect(detectarConsultaFactualDeProducto("¿Cuánto vale el envio?")).toBeNull();
  });

  it("sin tilde, plural, y mezclado con más texto: todas bloqueadas", () => {
    expect(detectarConsultaFactualDeProducto("tienes envio hoy mismo?")).toBeNull();
    expect(detectarConsultaFactualDeProducto("manejan envíos a Cañasgordas?")).toBeNull();
  });

  it("REGRESIÓN: las preguntas de producto reales de la suite de arriba siguen intactas", () => {
    // Ninguna de las 11 pruebas "TIPO A" menciona domicilio/envío — confirma
    // que la exclusión nueva no les toca ni un carácter.
    expect(detectarConsultaFactualDeProducto("¿Tienen torta de chocolate?")).toBe(
      "torta de chocolate"
    );
    expect(detectarConsultaFactualDeProducto("¿Tienes Pavé de Leche Klim?")).toBe(
      "pave de leche klim"
    );
    expect(
      detectarConsultaFactualDeProducto("¿Cuánto cuesta la porción de chocolate?")
    ).toBe("porcion de chocolate");
  });

  it("no dispara con substrings parecidos que no son la palabra completa", () => {
    // Límites de palabra (\b): "dominio" y "condominio" no deben confundirse
    // con "domi". Es un caso hipotético, no uno visto en producción, pero es
    // exactamente el tipo de falso positivo que \b existe para evitar.
    expect(detectarConsultaFactualDeProducto("¿Tienen servicio a domicilio o dominio propio?")).toBeNull();
  });
});
