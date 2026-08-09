import { describe, expect, it } from "vitest";
import {
  medidasEn,
  productosOlvidados,
} from "@/server/ai/anuncio-de-cierre";

/**
 * El producto que desaparece del pedido (9-ago-2026).
 *
 * Caso real de Lis: "Cremoso de 7 Oz" → el agente pregunta el topping →
 * "Quiero un cremoso de 16 Oz" → el agente responde solo del de 16 y el de 7
 * se esfuma. El cliente paga uno y esperaba dos.
 *
 * Se intentó por prompt y, contra el pipeline real, solo funcionaba cuando el
 * cliente decía "y también uno de 16". Por eso acabó en el servidor.
 */

describe("medidasEn: lo que distingue una variante de otra", () => {
  it("reconoce onzas escritas de varias formas", () => {
    expect(medidasEn("Cremoso de 7 Oz")).toEqual(["7oz"]);
    expect(medidasEn("un cremoso de 16oz")).toEqual(["16oz"]);
    expect(medidasEn("el de 44 onzas")).toEqual(["44onzas"]);
  });

  it("saca varias medidas del mismo texto, sin repetir", () => {
    expect(medidasEn("un 7 oz y un 16 oz, y otro 16 oz")).toEqual([
      "7oz",
      "16oz",
    ]);
  });

  it("no confunde un precio con una medida", () => {
    expect(medidasEn("son $18.000 en total")).toEqual([]);
  });

  it("sin texto no revienta", () => {
    expect(medidasEn(null)).toEqual([]);
    expect(medidasEn(undefined)).toEqual([]);
  });
});

describe("productosOlvidados: el caso reportado", () => {
  const enCurso = "¡Excelente elección! Un Cremoso de 7 oz. ¿QUÉ TOPPING DESEAS?";

  it("detecta que el de 7 oz desapareció", () => {
    expect(
      productosOlvidados({
        ultimaRespuestaDelAgente: enCurso,
        mensajesDelCliente: ["Quiero un cremoso de 16 Oz"],
        respuestaNueva: "¡Qué delicia! Un Cremoso de 16 oz. Lleva 3 toppings.",
      })
    ).toEqual(["7oz"]);
  });

  it("calla si la respuesta SÍ lleva los dos", () => {
    expect(
      productosOlvidados({
        ultimaRespuestaDelAgente: enCurso,
        mensajesDelCliente: ["Quiero un cremoso de 16 Oz"],
        respuestaNueva: "Entonces un Cremoso de 7 oz y un Cremoso de 16 oz.",
      })
    ).toEqual([]);
  });

  it("calla si el cliente dijo que CAMBIA: ahí sustituir es lo correcto", () => {
    for (const frase of [
      "mejor el de 16 oz",
      "no, mejor uno de 16 oz",
      "cámbialo por el de 16 oz",
      "en vez de ese, el de 16 oz",
    ]) {
      expect(
        productosOlvidados({
          ultimaRespuestaDelAgente: enCurso,
          mensajesDelCliente: [frase],
          respuestaNueva: "¡Listo! Un Cremoso de 16 oz.",
        })
      ).toEqual([]);
    }
  });

  it("calla cuando el cliente solo responde el topping (no hay producto nuevo)", () => {
    expect(
      productosOlvidados({
        ultimaRespuestaDelAgente: enCurso,
        mensajesDelCliente: ["milo"],
        respuestaNueva: "¡Anotado! ¿Es para ti o es un regalo?",
      })
    ).toEqual([]);
  });

  it("calla al principio de la conversación, sin nada en curso", () => {
    expect(
      productosOlvidados({
        ultimaRespuestaDelAgente: "¡Hola! ¿Qué se te antoja?",
        mensajesDelCliente: ["Cremoso de 7 Oz"],
        respuestaNueva: "¡Excelente! Un Cremoso de 7 oz.",
      })
    ).toEqual([]);
  });

  it("calla si el cliente repite el MISMO tamaño", () => {
    expect(
      productosOlvidados({
        ultimaRespuestaDelAgente: enCurso,
        mensajesDelCliente: ["sí, el de 7 oz"],
        respuestaNueva: "Perfecto, el Cremoso de 7 oz.",
      })
    ).toEqual([]);
  });

  it("con dos productos en curso, avisa de los dos si se pierden", () => {
    expect(
      productosOlvidados({
        ultimaRespuestaDelAgente: "Serían un Cremoso de 7 oz y uno de 12 oz.",
        mensajesDelCliente: ["quiero uno de 16 oz"],
        respuestaNueva: "¡Va un Cremoso de 16 oz!",
      })
    ).toEqual(["7oz", "12oz"]);
  });
});
