import { describe, expect, it } from "vitest";
import {
  confirmoPeroNoSeCerro,
  esConfirmacionCorta,
  pideConfirmarPedido,
} from "@/server/ai/anuncio-de-cierre";

/**
 * Fase 10N-A — detectores puros del guardarraíl "confirmó y no se cerró".
 * El comportamiento end-to-end (con el pipeline real) se prueba en
 * `pipeline-confirmo-sin-cierre.test.ts`; aquí se prueba cada pieza aislada.
 */

describe("esConfirmacionCorta", () => {
  it("A: reconoce afirmaciones cortas típicas, con o sin puntuación", () => {
    for (const t of ["Correcto", "correcto.", "Sí", "si", "sí!", "Dale", "Listo", "Confirmo", "Vale", "Ok", "okay", "De acuerdo", "Está bien", "esta bien", "Perfecto", "  Correcto  "]) {
      expect(esConfirmacionCorta(t)).toBe(true);
    }
  });

  it("B: NO reconoce una confirmación con contenido extra (no es un cierre limpio, es media corrección)", () => {
    for (const t of [
      "sí pero cámbiame el color",
      "correcto, agrégame otro más",
      "dale, y también quiero una gaseosa",
      "sí claro, cuánto sería con domicilio",
    ]) {
      expect(esConfirmacionCorta(t)).toBe(false);
    }
  });

  it("C: null/undefined/vacío no son confirmación", () => {
    expect(esConfirmacionCorta(null)).toBe(false);
    expect(esConfirmacionCorta(undefined)).toBe(false);
    expect(esConfirmacionCorta("")).toBe(false);
  });
});

describe("pideConfirmarPedido (PIDE_CONFIRMAR ampliado, 3-sep-2026)", () => {
  it("D: reconoce la frase real del incidente, que antes NO matcheaba", () => {
    expect(
      pideConfirmarPedido(
        "📍 Entrega: Cll 60A #119-140 · 💰 Total: $30.000\n¿Me confirmas si todo está correcto para dejar tu pedido en firme? 😊"
      )
    ).toBe(true);
  });

  it("E: sigue reconociendo las marcas originales", () => {
    expect(pideConfirmarPedido("Resumen: 1 Cremoso 12 oz. CONFIRMA TU PEDIDO")).toBe(true);
    expect(pideConfirmarPedido("¿Está todo correcto?")).toBe(true);
  });

  it("F: un mensaje normal, sin pedir confirmar nada, no matchea", () => {
    expect(pideConfirmarPedido("¡Hola! ¿En qué te ayudo hoy? 😊")).toBe(false);
    expect(pideConfirmarPedido(null)).toBe(false);
  });
});

describe("confirmoPeroNoSeCerro", () => {
  const RESUMEN = "💰 Total: $30.000\n¿Me confirmas si todo está correcto para dejar tu pedido en firme?";

  it("G: las tres condiciones juntas → true", () => {
    expect(
      confirmoPeroNoSeCerro({
        ultimaRespuestaPrevia: RESUMEN,
        mensajesDelCliente: ["Correcto"],
        accionNueva: "reply",
        textoDeLaAccionNueva: RESUMEN,
      })
    ).toBe(true);
  });

  it("H: si la acción nueva YA es notify_order, nunca dispara (así el resto encaje)", () => {
    expect(
      confirmoPeroNoSeCerro({
        ultimaRespuestaPrevia: RESUMEN,
        mensajesDelCliente: ["Correcto"],
        accionNueva: "notify_order",
        textoDeLaAccionNueva: "cualquier cosa",
      })
    ).toBe(false);
  });

  it("I: si el cliente mandó más de un mensaje este turno, no dispara (evita falsos positivos sobre mensajes mezclados)", () => {
    expect(
      confirmoPeroNoSeCerro({
        ultimaRespuestaPrevia: RESUMEN,
        mensajesDelCliente: ["Correcto", "y agrégame un jugo"],
        accionNueva: "reply",
        textoDeLaAccionNueva: RESUMEN,
      })
    ).toBe(false);
  });

  it("J: si el cliente no confirmó de forma corta e inequívoca, no dispara", () => {
    expect(
      confirmoPeroNoSeCerro({
        ultimaRespuestaPrevia: RESUMEN,
        mensajesDelCliente: ["sí pero cámbiame el sabor"],
        accionNueva: "reply",
        textoDeLaAccionNueva: RESUMEN,
      })
    ).toBe(false);
  });

  it("K: si el turno anterior del agente no pedía confirmar, no dispara aunque el cliente diga 'Correcto'", () => {
    expect(
      confirmoPeroNoSeCerro({
        ultimaRespuestaPrevia: "¡Hola! ¿En qué te ayudo? 😊",
        mensajesDelCliente: ["Correcto"],
        accionNueva: "reply",
        textoDeLaAccionNueva: RESUMEN,
      })
    ).toBe(false);
  });

  it("L: si la respuesta nueva ya NO repite la pregunta de confirmar (aunque sea un 'reply'), no dispara", () => {
    expect(
      confirmoPeroNoSeCerro({
        ultimaRespuestaPrevia: RESUMEN,
        mensajesDelCliente: ["Correcto"],
        accionNueva: "reply",
        textoDeLaAccionNueva: "¿Prefieres que te lo lleve entre las 3 y las 5, o después de las 6?",
      })
    ).toBe(false);
  });
});
