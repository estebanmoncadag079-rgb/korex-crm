import { describe, expect, it } from "vitest";

/**
 * `detectarConsultaFactualDeMedioPago` decide, sin ningún LLM, si un
 * mensaje es una pregunta factual concreta sobre un método de pago
 * ("¿aceptan Nequi?") que debe forzar `resolverMetodoDePago`, o una
 * pregunta abierta ("qué medios de pago manejan") que debe seguir
 * usando la ficha completa (docs/korexia/146).
 */

import { detectarConsultaFactualDeMedioPago } from "@/server/pagos/deteccion";

describe("detectarConsultaFactualDeMedioPago — TIPO A (factual concreta)", () => {
  it("¿puedo pagar por X?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Puedo pagar por Nequi?")).toBe("nequi");
  });

  it("¿aceptan X?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Aceptan Nequi?")).toBe("nequi");
  });

  it("¿reciben X?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Reciben efectivo?")).toBe("efectivo");
  });

  it("¿puedo pagar con X?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Puedo pagar con transferencia?")).toBe(
      "transferencia"
    );
  });

  it("¿aceptan Bancolombia?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Aceptan Bancolombia?")).toBe("bancolombia");
  });

  it("¿se puede pagar por X?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Se puede pagar por llave?")).toBe("llave");
  });

  it("¿aceptan pago por X? (con 'pago' de relleno)", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Aceptan pago por transferencia?")).toBe(
      "transferencia"
    );
  });

  it("tolera texto alrededor (saludo)", () => {
    expect(detectarConsultaFactualDeMedioPago("Hola, ¿aceptan Nequi?")).toBe("nequi");
  });
});

describe("detectarConsultaFactualDeMedioPago — TIPO B (abierta, NO forzar)", () => {
  it("¿cómo puedo pagar? sin mencionar método", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Cómo puedo pagar?")).toBeNull();
  });

  it("¿qué medios de pago manejan?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Qué medios de pago manejan?")).toBeNull();
  });

  it("¿cómo funciona el pago?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Cómo funciona el pago?")).toBeNull();
  });

  it("¿cuándo se paga?", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Cuándo se paga?")).toBeNull();
  });

  it("¿qué aceptan? sin nombrar nada", () => {
    expect(detectarConsultaFactualDeMedioPago("¿Qué aceptan ustedes?")).toBeNull();
  });

  it("un saludo suelto no dispara nada", () => {
    expect(detectarConsultaFactualDeMedioPago("Hola, buenas noches")).toBeNull();
  });

  it("texto vacío o nulo", () => {
    expect(detectarConsultaFactualDeMedioPago("")).toBeNull();
    expect(detectarConsultaFactualDeMedioPago("   ")).toBeNull();
  });
});
