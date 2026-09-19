import { describe, expect, it } from "vitest";
import { dijoOtroValorDeDomicilio } from "@/server/ai/anuncio-de-cierre";

/**
 * Fase 8 — el hueco que quedaba abierto para los negocios SIN tabla de zonas.
 *
 * El guardarraíl de domicilio existe desde el 13-sep-2026, pero solo se
 * evaluaba cuando el backend había verificado una tarifa
 * (`resultadoZona.status === "found"`), y eso solo ocurre con
 * `delivery_source='tabla'`. La Churra y Lis están en `'prompt'`: su
 * domicilio lo cotiza Uber/Yango/DiDi y no hay tabla contra la que comparar.
 *
 * Consecuencia medida en el código antes de esta fase: el modelo podía
 * decirle a un cliente de La Churra "el domicilio son $5.000" y **nada** lo
 * detectaba — ni este detector (pedía una tarifa verificada que no existe) ni
 * `inconsistenciaFinancieraDePedido` (su candado está tras
 * `puedeVerificarDomicilio`, apagado a propósito desde el incidente de
 * Zahenz).
 *
 * La extensión es mínima: `feeCentsVerificado` acepta `null` = "este negocio
 * no tiene ninguna tarifa verificable". Entonces la única pregunta que queda
 * es la correcta: ¿esta cifra corresponde a algo que el backend calculó o que
 * una persona del negocio dijo? Si no, la inventó el modelo.
 */
describe("dijoOtroValorDeDomicilio: negocio sin tarifa verificable (delivery_source='prompt')", () => {
  it("una tarifa inventada por el modelo se detecta", () => {
    expect(
      dijoOtroValorDeDomicilio("El domicilio tiene un valor de $5.000 🛵", null, [2000000])
    ).toBe(true);
  });

  it("el subtotal real de los productos, mencionado junto al domicilio, NO es una invención", () => {
    // Es la redacción natural: "$20.000 + el domicilio aparte".
    expect(
      dijoOtroValorDeDomicilio("Son $20.000 más el domicilio, que se cotiza aparte", null, [2000000])
    ).toBe(false);
  });

  it("decir que el domicilio está pendiente, sin cifra, nunca dispara", () => {
    expect(
      dijoOtroValorDeDomicilio(
        "El domicilio lo cotizamos por Uber y te confirmamos el valor 🛵",
        null,
        [2000000]
      )
    ).toBe(false);
  });

  it("una cifra que dijo UNA PERSONA del negocio no es una invención del modelo", () => {
    // Incidente real (MALIA, 8 y 9-sep-2026): el equipo cotiza a mano, el bot
    // repite ese número, y el guardarraíl lo bloqueaba con el cliente ya
    // pagado. La excepción existe; aquí se conserva para el caso sin tabla.
    expect(
      dijoOtroValorDeDomicilio("Con el domicilio incluido el total es de $26.000", null, [2600000])
    ).toBe(false);
  });

  it("sin ninguna cifra legítima, cualquier valor de domicilio es inventado", () => {
    expect(dijoOtroValorDeDomicilio("El domicilio son $8.000", null, [])).toBe(true);
  });

  it("'domicilio gratis' sin respaldo también es una invención", () => {
    // Regalar el domicilio es una decisión del negocio, no del modelo.
    expect(dijoOtroValorDeDomicilio("¡El domicilio es gratis! 🎉", null, [2000000])).toBe(true);
  });
});

/**
 * El comportamiento con tabla NO cambia: mismos casos que ya pasaban, para
 * demostrar que la extensión no toca el camino de MALIA.
 */
describe("dijoOtroValorDeDomicilio: con tarifa verificada (sin regresión)", () => {
  it("la tarifa verificada sigue siendo legítima", () => {
    expect(dijoOtroValorDeDomicilio("El domicilio son $8.000", 800000, [])).toBe(false);
  });

  it("una cifra distinta de la verificada sigue bloqueando", () => {
    expect(dijoOtroValorDeDomicilio("El domicilio son $9.000", 800000, [])).toBe(true);
  });

  it("el total combinado cerca de 'domicilio' sigue sin ser falso positivo", () => {
    expect(
      dijoOtroValorDeDomicilio("Con domicilio serían $20.000", 800000, [2000000])
    ).toBe(false);
  });
});
