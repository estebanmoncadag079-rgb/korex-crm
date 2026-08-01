import { describe, expect, it } from "vitest";
import {
  COSTO_RESPUESTA_IA_USD,
  TARIFA_MENSAJE_USD,
  conversacionesDeEquilibrio,
  cotizar,
  margenDe,
  precioParaMargen,
  type EntradasCotizacion,
} from "@/lib/cotizador";

/**
 * Con esto se ponen precios reales, así que un error aquí se cobra mal durante
 * meses. Lo que se prueba no es la aritmética por la aritmética, sino las tres
 * cosas que se pueden razonar mal al cotizar:
 *
 *  1. que el costo lo mandan los MENSAJES, no las conversaciones,
 *  2. que el servidor es fijo y por eso los primeros clientes salen caros,
 *  3. que una campaña de marketing pesa más que un mes entero de respuestas.
 */

const base: EntradasCotizacion = {
  conversacionesMes: 900,
  mensajesBotPorConversacion: 8,
  mensajesPersonaPorConversacion: 0,
  campanasPorMes: 0,
  contactosPorCampana: 0,
  costoVpsUsd: 30,
  clientesEnVps: 5,
  trm: 3206,
};

describe("cotizador", () => {
  it("cobra la IA por respuesta y WhatsApp por mensaje", () => {
    const r = cotizar(base);
    expect(r.respuestasIa).toBe(7200);
    expect(r.mensajesSalientes).toBe(7200);
    expect(r.costoIaUsd).toBeCloseTo(7200 * COSTO_RESPUESTA_IA_USD, 6);
    expect(r.costoWhatsappUsd).toBeCloseTo(7200 * TARIFA_MENSAJE_USD, 6);
    expect(r.costoServidorUsd).toBe(6);
  });

  it("el doble de mensajes por conversación casi dobla el costo variable", () => {
    // El error que motivó la calculadora: cotizar "por conversación" como si
    // todos los negocios cerraran igual. Con las mismas 900 conversaciones,
    // pasar de 8 a 16 mensajes duplica IA y WhatsApp — solo el servidor no se
    // mueve, porque es fijo.
    const ocho = cotizar(base);
    const dieciseis = cotizar({ ...base, mensajesBotPorConversacion: 16 });

    const variableOcho = ocho.costoIaUsd + ocho.costoWhatsappUsd;
    const variableDieciseis = dieciseis.costoIaUsd + dieciseis.costoWhatsappUsd;

    expect(variableDieciseis).toBeCloseTo(variableOcho * 2, 6);
    expect(dieciseis.costoServidorUsd).toBe(ocho.costoServidorUsd);
    // Y el total NO se dobla, justamente por el fijo.
    expect(dieciseis.costoTotalUsd).toBeLessThan(ocho.costoTotalUsd * 2);
  });

  it("los mensajes de una persona pagan WhatsApp pero no IA", () => {
    const soloBot = cotizar(base);
    const conPersona = cotizar({ ...base, mensajesPersonaPorConversacion: 4 });

    expect(conPersona.costoIaUsd).toBeCloseTo(soloBot.costoIaUsd, 6);
    expect(conPersona.costoWhatsappUsd).toBeCloseTo(
      soloBot.costoWhatsappUsd * 1.5,
      6
    );
  });

  it("el servidor se reparte: los primeros clientes son los caros", () => {
    const conDos = cotizar({ ...base, clientesEnVps: 2 });
    const conVeinte = cotizar({ ...base, clientesEnVps: 20 });

    expect(conDos.costoServidorUsd).toBe(15);
    expect(conVeinte.costoServidorUsd).toBe(1.5);
    // Con 2 clientes el servidor pesa más que la IA de todo el mes.
    expect(conDos.costoServidorUsd).toBeGreaterThan(conDos.costoIaUsd);
  });

  it("no divide por cero si aún no hay clientes en el servidor", () => {
    expect(cotizar({ ...base, clientesEnVps: 0 }).costoServidorUsd).toBe(30);
    const vacio = cotizar({ ...base, conversacionesMes: 0 });
    expect(vacio.costoPorConversacionUsd).toBe(0);
    expect(Number.isFinite(vacio.costoTotalUsd)).toBe(true);
  });

  it("una sola campaña puede costar más que el mes entero de respuestas", () => {
    // Es el riesgo que hay que explicarle al cliente en la primera reunión.
    const conCampana = cotizar({
      ...base,
      campanasPorMes: 1,
      contactosPorCampana: 5000,
    });
    expect(conCampana.costoMarketingUsd).toBeCloseTo(62.5, 2);
    expect(conCampana.costoMarketingUsd).toBeGreaterThan(
      conCampana.costoIaUsd + conCampana.costoWhatsappUsd
    );
  });

  it("dice cuánto sube el mes si cada conversación lleva un mensaje más", () => {
    const r = cotizar(base);
    const unoMas = cotizar({ ...base, mensajesBotPorConversacion: 9 });
    expect(r.costoPorMensajeExtraUsd).toBeCloseTo(
      unoMas.costoTotalUsd - r.costoTotalUsd,
      6
    );
  });

  it("convierte a pesos con la tasa que se le pase", () => {
    const r = cotizar(base);
    expect(r.costoTotalCop).toBeCloseTo(r.costoTotalUsd * 3206, 4);
  });

  it("ignora números imposibles en vez de devolver basura", () => {
    const r = cotizar({
      ...base,
      conversacionesMes: -100,
      mensajesBotPorConversacion: Number.NaN,
    });
    expect(r.costoIaUsd).toBe(0);
    expect(r.costoTotalUsd).toBe(6); // solo el servidor
  });
});

describe("precio y equilibrio", () => {
  it("el precio para un margen deja exactamente ese margen", () => {
    const precio = precioParaMargen(20, 0.85);
    expect(precio).toBeCloseTo(133.33, 2);
    expect(margenDe(precio, 20)).toBeCloseTo(0.85, 6);
  });

  it("un margen del 100 % no genera un precio infinito", () => {
    expect(Number.isFinite(precioParaMargen(20, 1))).toBe(true);
  });

  it("el margen es negativo cuando el precio no cubre el costo", () => {
    expect(margenDe(10, 25)).toBeLessThan(0);
  });

  it("el punto de equilibrio marca dónde deja de ganarse", () => {
    const precio = 187; // plan Pro en USD
    const tope = conversacionesDeEquilibrio(precio, base);

    // Justo por debajo todavía deja margen; justo por encima, ya no.
    const antes = cotizar({ ...base, conversacionesMes: Math.floor(tope) - 1 });
    const despues = cotizar({ ...base, conversacionesMes: Math.ceil(tope) + 1 });
    expect(antes.costoTotalUsd).toBeLessThan(precio);
    expect(despues.costoTotalUsd).toBeGreaterThan(precio);
  });

  it("una campaña baja el punto de equilibrio, porque se come el presupuesto", () => {
    const sin = conversacionesDeEquilibrio(187, base);
    const con = conversacionesDeEquilibrio(187, {
      ...base,
      campanasPorMes: 1,
      contactosPorCampana: 2000,
    });
    expect(con).toBeLessThan(sin);
  });

  it("si el precio no cubre ni los fijos, el equilibrio es cero", () => {
    expect(conversacionesDeEquilibrio(3, base)).toBe(0);
  });
});
