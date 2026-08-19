import { describe, expect, it } from "vitest";
import { comoSeEntrega } from "@/server/ai/fotos";
import { AgentAction } from "@/server/ai/actions";

/**
 * Un recurso del negocio se entrega como archivo, como enlace o como ambos.
 *
 * Lo que se comprueba aquí es lo que el sistema puede cumplir DE VERDAD, no lo
 * que la fila declara: un recurso marcado como "enlace" sin enlace, o como
 * "archivo" sin archivo, es una promesa que acaba con el cliente leyendo "te
 * envío el catálogo" y sin recibir nada — el fallo real del 18-ago-2026
 * (docs/korexia/47-FOTOS-DEL-AGENTE.md).
 *
 * Es genérico a propósito: el núcleo no sabe si detrás hay un catálogo, un
 * menú, un tarifario o una guía. Por eso los casos de abajo usan los tres.
 */

const ARCHIVO = { entrega: "archivo" as const, url: null, mimeType: "application/pdf" };
const ENLACE = { entrega: "enlace" as const, url: "https://ejemplo.test/menu", mimeType: null };
const AMBOS = {
  entrega: "ambos" as const,
  url: "https://ejemplo.test/tarifario",
  mimeType: "image/jpeg",
};

describe("comoSeEntrega: lo que el recurso puede cumplir", () => {
  it("un archivo se manda como archivo y no como enlace", () => {
    expect(comoSeEntrega(ARCHIVO)).toEqual({ archivo: true, enlace: false });
  });

  it("un enlace se manda como enlace y no como archivo", () => {
    expect(comoSeEntrega(ENLACE)).toEqual({ archivo: false, enlace: true });
  });

  it("«ambos» manda las dos cosas", () => {
    expect(comoSeEntrega(AMBOS)).toEqual({ archivo: true, enlace: true });
  });
});

describe("comoSeEntrega: lo declarado no basta, tiene que estar", () => {
  /*
   * El caso negativo, que es el que da valor a la prueba: sin él, la función
   * podría devolver `true` siempre y estos tests seguirían en verde.
   */
  it("dice que NO hay enlace si la fila no lo trae, aunque se declare «enlace»", () => {
    expect(comoSeEntrega({ entrega: "enlace", url: null, mimeType: null })).toEqual({
      archivo: false,
      enlace: false,
    });
  });

  it("dice que NO hay archivo sin mimeType: no se sabría si es foto o documento", () => {
    expect(comoSeEntrega({ entrega: "archivo", url: null, mimeType: null })).toEqual({
      archivo: false,
      enlace: false,
    });
  });

  it("en «ambos» a medias, entrega solo la mitad que sí existe", () => {
    expect(
      comoSeEntrega({ entrega: "ambos", url: "https://ejemplo.test/guia", mimeType: null })
    ).toEqual({ archivo: false, enlace: true });
  });
});

/**
 * El otro extremo del mismo problema: una acción que no se puede ejecutar no
 * debería ser válida. `send_image` aceptaba llegar sin etiqueta, pasaba la
 * validación y degradaba a texto — el cliente leía la promesa y no recibía el
 * archivo.
 */
describe("send_image: sin etiqueta no es una acción válida", () => {
  it("la rechaza cuando no trae ni «etiqueta» ni «label»", () => {
    const r = AgentAction.safeParse({ action: "send_image", reply: "Te envío el catálogo" });
    expect(r.success).toBe(false);
  });

  it("acepta «etiqueta», en español", () => {
    const r = AgentAction.safeParse({ action: "send_image", etiqueta: "carta" });
    expect(r.success).toBe(true);
  });

  it("acepta «label», porque el modelo la escribe así (bug del 13-ago)", () => {
    const r = AgentAction.safeParse({ action: "send_image", label: "carta" });
    expect(r.success).toBe(true);
  });

  it("no rompe las demás acciones", () => {
    expect(AgentAction.safeParse({ action: "reply", text: "hola" }).success).toBe(true);
    expect(AgentAction.safeParse({ action: "none" }).success).toBe(true);
  });
});
