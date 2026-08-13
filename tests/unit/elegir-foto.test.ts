import { describe, expect, it } from "vitest";
import { elegirFoto } from "@/server/ai/fotos";

/**
 * Elegir qué foto mandar cuando el agente pide una.
 *
 * Es la pieza que puede fallar en silencio: si no encuentra una foto que sí
 * existe, el cliente se queda sin ella y nadie se entera; si elige la que no
 * era, el negocio le manda al cliente el producto equivocado — que es peor.
 *
 * Por eso tolera cómo escriba el modelo (dice "volumen ruso" donde el negocio
 * guardó "Volumen Ruso") pero **nunca adivina entre dos candidatas**.
 */

const FOTOS = [
  { etiqueta: "Volumen Ruso" },
  { etiqueta: "Volumen Americano" },
  { etiqueta: "Cejas en Henna" },
  { etiqueta: "Carta completa" },
];

describe("elegirFoto: encuentra la que existe", () => {
  it("por nombre exacto", () => {
    expect(elegirFoto(FOTOS, "Volumen Ruso")?.etiqueta).toBe("Volumen Ruso");
  });

  it("sin importar mayúsculas ni espacios de más", () => {
    expect(elegirFoto(FOTOS, "  volumen ruso ")?.etiqueta).toBe("Volumen Ruso");
  });

  it("sin tildes: el modelo escribe 'cejas en henna' y el negocio guardó otra cosa", () => {
    expect(elegirFoto([{ etiqueta: "Diseño de Cejas" }], "diseno de cejas")?.etiqueta).toBe(
      "Diseño de Cejas"
    );
  });

  it("cuando la pedida está contenida en la guardada", () => {
    expect(elegirFoto(FOTOS, "carta")?.etiqueta).toBe("Carta completa");
  });
});

describe("elegirFoto: NO adivina", () => {
  /**
   * El caso que más caro sale: "volumen" encaja con Ruso y con Americano.
   * Mandar una al azar sería enseñarle al cliente un producto de $150.000
   * cuando preguntaba por otro. Mejor texto.
   */
  it("devuelve null si dos fotos encajan igual de bien", () => {
    expect(elegirFoto(FOTOS, "volumen")).toBeNull();
  });

  it("devuelve null si no hay nada parecido", () => {
    expect(elegirFoto(FOTOS, "manicure francesa")).toBeNull();
  });

  it("devuelve null sin fotos cargadas o con petición vacía", () => {
    expect(elegirFoto([], "lo que sea")).toBeNull();
    expect(elegirFoto(FOTOS, "   ")).toBeNull();
  });
});
