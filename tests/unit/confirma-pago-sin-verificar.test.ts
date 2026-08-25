import { describe, expect, it } from "vitest";

/**
 * Caso real (Lis Pastelería, 24-ago-2026): la clienta escribió "Pago por
 * nequi" —el MEDIO que iba a usar, sin comprobante todavía— y el agente
 * respondió "¡Recibimos tu pago con éxito! 🎉 Ya estamos preparando tu
 * pedido...". Ningún pago existía. Ver anuncio-de-cierre.ts.
 *
 * Los negativos son mensajes REALES de producción (82 respuestas de los
 * tres negocios, 60 días, filtradas por "pago"/"comprobante"/"nequi"/
 * "daviplata"/"transferencia"/"bancolombia"/"llave"): el patrón correcto de
 * la flota entera es "recibimos tu comprobante... lo pasamos a verificar",
 * nunca "recibimos tu pago" a secas — el único caso real distinto es el
 * incidente de arriba.
 */

import { confirmaPagoSinVerificar } from "@/server/ai/anuncio-de-cierre";

describe("confirmaPagoSinVerificar: el caso real de producción", () => {
  it("caza el incidente exacto del 24-ago (Lis Pastelería)", () => {
    expect(
      confirmaPagoSinVerificar(
        "¡Recibimos tu pago con éxito! 🎉 Ya estamos preparando tu pedido con mucho amor para que disfrutes de cada bocado. 💗\n\nEl domicilio se paga aparte, directo al repartidor cuando llega."
      )
    ).toBe(true);
  });

  it("caza variantes de la misma afirmación", () => {
    expect(confirmaPagoSinVerificar("Tu pago fue confirmado, ya vamos a preparar todo.")).toBe(true);
    expect(confirmaPagoSinVerificar("Listo, ya nos llegó tu pago. Gracias por tu compra.")).toBe(true);
    expect(confirmaPagoSinVerificar("Te confirmo el pago, en un momento sale tu pedido.")).toBe(true);
  });

  it("NO caza el patrón correcto de la flota: recibir el COMPROBANTE y pasarlo a verificar", () => {
    expect(
      confirmaPagoSinVerificar(
        "Gracias, hermosa 💕. Hemos recibido el comprobante, lo estamos verificando con el equipo. ¡Pronto te confirmamos!"
      )
    ).toBe(false);
    expect(
      confirmaPagoSinVerificar(
        "¡Genial, hermosa! 💕 Ya recibimos tu comprobante de pago. Lo pasaré a mi equipo para que lo verifiquen. Enseguida te confirmo tu cita. 😉"
      )
    ).toBe(false);
    expect(confirmaPagoSinVerificar("Estamos validando tu pago y empezando a preparar todo con mucho amor 💗🍰")).toBe(
      false
    );
  });

  it("NO caza dar instrucciones de pago (cuenta, llave, banco)", () => {
    expect(
      confirmaPagoSinVerificar(
        "¡Pedido confirmado, Laura! 🎉\n\n💳 *Para el pago:* transfiere a nuestra *Cuenta de Ahorros Bancolombia* 🏦 *76416970374*."
      )
    ).toBe(false);
  });

  it("NO caza una pregunta de FAQ sobre cómo se confirma el pago", () => {
    expect(
      confirmaPagoSinVerificar("¿Cómo confirmo el pago? ¿Debo enviar el comprobante?\nSí: hay que enviar la captura de pantalla de la transferencia.")
    ).toBe(false);
  });

  it("un saludo o una confirmación de pedido normal no activa nada", () => {
    expect(confirmaPagoSinVerificar("¡Hola! ¿En qué te puedo ayudar hoy? ✨")).toBe(false);
    expect(confirmaPagoSinVerificar("¡Gracias por tu confirmación! Ya estamos preparando tu pedido con mucho amor.")).toBe(
      false
    );
  });

  it("no se cae con texto vacío o nulo", () => {
    expect(confirmaPagoSinVerificar(null)).toBe(false);
    expect(confirmaPagoSinVerificar(undefined)).toBe(false);
    expect(confirmaPagoSinVerificar("")).toBe(false);
  });
});
