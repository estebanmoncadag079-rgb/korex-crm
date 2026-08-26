import { describe, expect, it } from "vitest";

/**
 * Mitad simétrica de "niega disponibilidad sin verificar": aquí el modelo SÍ
 * consultó (`consultar_producto` / `consultar_medio_pago`), el servidor le
 * devolvió el hecho real, y aun así la respuesta final lo contradice. Nace
 * del incidente de Lis (25-ago-2026, "torta de chocolate").
 */

import {
  contradiceProductoEncontrado,
  niegaMetodoDePagoPermitido,
} from "@/server/ai/anuncio-de-cierre";

describe("contradiceProductoEncontrado", () => {
  it("detecta la negación cuando nombra el producto que el sistema confirmó", () => {
    expect(
      contradiceProductoEncontrado(
        "Ay, disculpa, no tenemos porción chocolate en este momento.",
        "Porción Chocolate"
      )
    ).toBe(true);
  });

  it("no marca falso positivo cuando la negación es sobre algo distinto", () => {
    expect(
      contradiceProductoEncontrado(
        "¡Sí, tenemos porción chocolate! Eso sí, no manejamos domicilios en Bogotá.",
        "Porción Chocolate"
      )
    ).toBe(false);
  });

  it("no marca falso positivo en una pregunta", () => {
    expect(
      contradiceProductoEncontrado("¿No será que ya no tienen porción chocolate?", "Porción Chocolate")
    ).toBe(false);
  });

  it("con texto vacío o nulo, nunca contradice", () => {
    expect(contradiceProductoEncontrado(null, "Porción Chocolate")).toBe(false);
    expect(contradiceProductoEncontrado(undefined, "Porción Chocolate")).toBe(false);
    expect(contradiceProductoEncontrado("", "Porción Chocolate")).toBe(false);
  });
});

describe("niegaMetodoDePagoPermitido", () => {
  it("detecta la negación cuando nombra el método que el sistema confirmó", () => {
    expect(niegaMetodoDePagoPermitido("No aceptamos Nequi, disculpa.", "Nequi")).toBe(true);
  });

  it("no marca falso positivo cuando la negación es sobre otra cosa", () => {
    expect(
      niegaMetodoDePagoPermitido("Sí, con Nequi está bien. No manejamos crédito a plazos.", "Nequi")
    ).toBe(false);
  });

  it("no marca falso positivo en una pregunta", () => {
    expect(niegaMetodoDePagoPermitido("¿Será que no aceptan Nequi?", "Nequi")).toBe(false);
  });
});
