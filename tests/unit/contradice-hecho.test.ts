import { describe, expect, it } from "vitest";

/**
 * Mitad simétrica de "niega disponibilidad sin verificar": aquí el modelo SÍ
 * consultó (`consultar_producto` / `consultar_medio_pago`), el servidor le
 * devolvió el hecho real, y aun así la respuesta final lo contradice. Nace
 * del incidente de Lis (25-ago-2026, "torta de chocolate").
 */

import {
  contradiceProductoEncontrado,
  contradiceDatosDeCuenta,
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

/**
 * Fase 8C — auditoría de Fase 8B: ningún guardarraíl existente verificaba
 * que los DÍGITOS que el modelo cita coincidan con `ficha.pago.datosDeCuenta`
 * real (a diferencia de `niegaMetodoDePagoPermitido`, que solo verifica el
 * MÉTODO). Casos 1-5 del encargo de la Fase 8C.
 */
describe("contradiceDatosDeCuenta", () => {
  const CUENTA_REAL = "Bancolombia Ahorros 51400008565, a nombre de Karen Ramírez";

  it("1: dato exacto -> no dispara", () => {
    expect(
      contradiceDatosDeCuenta(
        "Claro, puedes transferir a la cuenta 51400008565 de Bancolombia.",
        CUENTA_REAL
      )
    ).toBe(false);
  });

  it("2: un solo dígito alterado -> detecta", () => {
    // Mismo largo (11 dígitos), el último cambiado de 5 a 6.
    expect(
      contradiceDatosDeCuenta(
        "Claro, puedes transferir a la cuenta 51400008566 de Bancolombia.",
        CUENTA_REAL
      )
    ).toBe(true);
  });

  it("3a: múltiples cuentas/líneas -> detecta cuando el número citado no coincide con NINGUNA", () => {
    const dosCuentas = "Nequi: 3185940645\nBancolombia Ahorros: 51400008565";
    expect(
      contradiceDatosDeCuenta("Puedes pagar a la cuenta Nequi 3185940646.", dosCuentas)
    ).toBe(true);
  });

  it("3b: múltiples cuentas/líneas -> NO dispara si el número citado coincide con CUALQUIERA de ellas", () => {
    const dosCuentas = "Nequi: 3185940645\nBancolombia Ahorros: 51400008565";
    expect(
      contradiceDatosDeCuenta("Puedes pagar a la cuenta Bancolombia 51400008565.", dosCuentas)
    ).toBe(false);
    expect(
      contradiceDatosDeCuenta("Puedes pagar por Nequi al 3185940645.", dosCuentas)
    ).toBe(false);
  });

  it("4: cita parcial válida (solo un fragmento de la cuenta real) -> no dispara", () => {
    expect(
      contradiceDatosDeCuenta("Te confirmo, la cuenta termina en 008565.", CUENTA_REAL)
    ).toBe(false);
    // Fragmento inicial, también substring real.
    expect(
      contradiceDatosDeCuenta("La cuenta empieza por 514000.", CUENTA_REAL)
    ).toBe(false);
  });

  it("5a: números no bancarios en la misma respuesta (precio, fecha, cantidad) -> no falso positivo", () => {
    expect(
      contradiceDatosDeCuenta(
        "Tu pedido de 3 unidades queda para el 15 de septiembre, total $125000. Puedes transferir a la cuenta 51400008565.",
        CUENTA_REAL
      )
    ).toBe(false);
  });

  it("5b: un teléfono de contacto mencionado FUERA de una oración de pago -> no falso positivo", () => {
    // Número de 10 dígitos, largo distinto a la cuenta real (11) y sin
    // contexto de pago en su propia oración.
    expect(
      contradiceDatosDeCuenta(
        "Cualquier duda nos escribes al 3009998877. Para pagar, transfiere a la cuenta 51400008565.",
        CUENTA_REAL
      )
    ).toBe(false);
  });

  it("5c: números cortos (menos de 6 dígitos) nunca se comparan, aunque estén en contexto de pago", () => {
    expect(
      contradiceDatosDeCuenta("Puedes pagar por Nequi, son 45000 pesos.", CUENTA_REAL)
    ).toBe(false);
  });

  it("con texto o datosDeCuenta vacíos/nulos, nunca contradice", () => {
    expect(contradiceDatosDeCuenta(null, CUENTA_REAL)).toBe(false);
    expect(contradiceDatosDeCuenta(undefined, CUENTA_REAL)).toBe(false);
    expect(contradiceDatosDeCuenta("", CUENTA_REAL)).toBe(false);
    expect(contradiceDatosDeCuenta("cuenta 51400008566", null)).toBe(false);
    expect(contradiceDatosDeCuenta("cuenta 51400008566", undefined)).toBe(false);
    expect(contradiceDatosDeCuenta("cuenta 51400008566", "")).toBe(false);
  });

  it("no marca falso positivo en una pregunta del cliente sobre la cuenta", () => {
    expect(
      contradiceDatosDeCuenta("¿La cuenta es la 51400008566?", CUENTA_REAL)
    ).toBe(false);
  });
});
