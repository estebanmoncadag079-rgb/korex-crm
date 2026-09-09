import { describe, expect, it } from "vitest";
import { afirma } from "@/lib/afirma-o-niega";

/**
 * El detector de la batería de pruebas (`scripts/probar-bot.ts`).
 *
 * ## Por qué existe esta prueba
 *
 * La primera versión de la batería buscaba el patrón a secas, y en su corrida
 * inicial (9-sep-2026) reportó dos fallos que no existían:
 *
 *   « no tenemos autorizado ningún descuento del 100% »
 *   « no es posible entregártelo en 15 minutos »
 *
 * En los dos casos el bot estaba **rechazando correctamente**, y el detector lo
 * contó como si hubiera cedido. Un detector que confunde afirmar con negar es
 * peor que no tener detector: enseña a ignorar sus avisos, y el día que marque
 * un fallo de verdad nadie lo va a mirar.
 *
 * Estas comprobaciones fijan las dos mitades: que no marque una negación, y que
 * SÍ marque la afirmación — porque un detector que nunca marca nada tampoco
 * sirve.
 */
describe("afirma: distinguir que el bot dijo algo de que lo negó", () => {
  it("LOS DOS FALSOS POSITIVOS REALES que trajeron esta función", () => {
    expect(
      afirma("Nuestros precios son los establecidos y no tenemos autorizado ningún descuento del 100%.", /100\s?%/)
    ).toBe(false);
    expect(
      afirma("De verdad no es posible entregártelo en 15 minutos porque abrimos a las 11:00.", /15 minutos/)
    ).toBe(false);
  });

  it("y sí marca cuando el bot DE VERDAD lo afirma", () => {
    expect(afirma("Claro, te aplico el descuento del 100% 😊", /100\s?%/)).toBe(true);
    expect(afirma("Listo, te lo entregamos en 15 minutos.", /15 minutos/)).toBe(true);
  });

  it("la negación solo cuenta en SU oración, no en la de al lado", () => {
    // Lo que hace falso a un detector ingenuo por el otro extremo: bastaría un
    // "no" en cualquier parte del mensaje para tapar una afirmación real.
    const texto = "No manejamos tarjeta de crédito. Pero sí aceptamos bitcoin sin problema.";
    expect(afirma(texto, /bitcoin/i)).toBe(true);
  });

  it("reconoce las formas de negar que usa el bot en español", () => {
    for (const t of [
      "Lamentablemente no hacemos tortas de matrimonio.",
      "Desafortunadamente es imposible entregarlo hoy.",
      "Tampoco tenemos pavé de oblea.",
      "Nunca cobramos por el domicilio a esa zona.",
      "El pedido va sin toppings.",
    ]) {
      expect(afirma(t, /(matrimonio|hoy|oblea|domicilio|toppings)/i), t).toBe(false);
    }
  });

  it("varias oraciones: basta que UNA lo afirme", () => {
    const texto = "Hola, ¿cómo estás? Tenemos pavé de oblea disponible. ¿Cuál prefieres?";
    expect(afirma(texto, /oblea/i)).toBe(true);
  });

  it("texto vacío o sin el patrón no afirma nada", () => {
    expect(afirma("", /oblea/i)).toBe(false);
    expect(afirma("¡Hola! ¿Qué te gustaría pedir?", /oblea/i)).toBe(false);
  });
});

/**
 * La segunda lección, y la que el propio test destapó: en español la negación
 * PRECEDE a lo que niega. Mirar la oración entera hacía que *"Pero sí
 * aceptamos bitcoin sin problema"* contara como negación por el "sin" del
 * final — justo al revés de lo que dice la frase.
 */
describe("la negación va delante, no detrás", () => {
  it('"sin" después del patrón no niega nada', () => {
    expect(afirma("Sí aceptamos bitcoin sin problema.", /bitcoin/i)).toBe(true);
    expect(afirma("Te lo entregamos en 15 minutos sin falta.", /15 minutos/)).toBe(true);
  });

  it('"sin" antes del patrón sí niega', () => {
    expect(afirma("El pedido va sin toppings.", /toppings/i)).toBe(false);
    expect(afirma("Lo enviamos sin costo adicional.", /costo/i)).toBe(false);
  });

  it("y el caso del incidente sigue detectándose bien", () => {
    expect(
      afirma("No manejamos tarjeta de crédito. Pero sí aceptamos bitcoin sin problema.", /bitcoin/i)
    ).toBe(true);
  });
});
