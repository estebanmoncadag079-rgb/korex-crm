import { describe, expect, it } from "vitest";

/**
 * Mitad simétrica del guardarraíl del 19-ago (afirmar sin verificar): en vez
 * de prometer de más, el agente NIEGA de más. Medido contra los mensajes
 * reales de Lashes Valen antes de escribir el criterio
 * (docs/korexia/109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md): 7 candidatos por
 * texto, 4 alucinados (sin ninguna consulta detrás) y 3 legítimos.
 *
 * Los 4 primeros tests son los mensajes REALES que salieron a producción.
 * Los dos "NO caza" que siguen son los legítimos que el criterio debe dejar
 * pasar — uno de ellos fue justo el que descartó un primer diseño más
 * simple (cualquier negación, sin mirar si mencionaba una hora): negar una
 * hora puntual puede apoyarse, con razón, en lo que el propio agente ofreció
 * en el turno inmediato anterior.
 */

import { niegaDisponibilidadSinVerificar } from "@/server/ai/anuncio-de-cierre";

describe("niegaDisponibilidadSinVerificar: los casos reales de producción", () => {
  it("caza 'ese horario ya no está disponible' (Valentina, sin hora explícita)", () => {
    expect(
      niegaDisponibilidadSinVerificar("Ese horario ya no está disponible. ¿Qué otra hora prefieres?")
    ).toBe(true);
  });

  it("caza el mismo mensaje del caso del comprobante fuera de contexto", () => {
    expect(
      niegaDisponibilidadSinVerificar("Ese horario ya no está disponible. ¿Qué otra hora prefieres?")
    ).toBe(true);
  });

  it("caza la negación categórica de un periodo entero (\"la mañana\")", () => {
    expect(
      niegaDisponibilidadSinVerificar(
        "Lo siento, hermosa. Para mañana jueves 20 de agosto, ya no tenemos citas disponibles en la mañana. 🌸 ¿Te gustaría que busquemos otra hora en la tarde o para otro día? ✨"
      )
    ).toBe(true);
  });

  it("caza la negación total, sin periodo ni hora", () => {
    expect(
      niegaDisponibilidadSinVerificar(
        "Hermosa, para mañana jueves 20 de agosto, ya no tengo horarios disponibles. 😔 ¿Te gustaría que revisemos para otro día? 💖"
      )
    ).toBe(true);
  });

  /*
   * El caso que descartó un primer diseño más simple: el agente había
   * ofrecido "2:00 PM" en el turno anterior, el cliente insistió con
   * "6:30", y el agente respondió negando ESA hora puntual — apoyado en su
   * propia oferta reciente, no inventado de la nada. `usage_event` confirmó
   * que esta negación no llevaba ninguna consulta en el turno (igual que
   * las alucinadas), así que el HECHO de arriba (`consultas===0` en
   * pipeline.ts) no basta para distinguirlas: hace falta el texto.
   */
  it("NO caza una negación de HORA PUNTUAL propuesta por el cliente (legítima)", () => {
    expect(
      niegaDisponibilidadSinVerificar(
        "Entendido, hermosa. Para hoy, martes 18 de agosto, la cita de Press on con Laura a las 6:30 PM no está disponible. ¿Te gustaría ver otras opciones de horario para hoy o buscar otro día? 💕"
      )
    ).toBe(false);
  });

  /*
   * Este texto SÍ cumple el patrón (niega disponibilidad de forma
   * categórica) y la función pura, correctamente, lo marca. En el caso real
   * era legítimo — pero porque hubo una consulta de verdad en ese turno
   * (`consultas > 0`, confirmado en `usage_event`), no porque el TEXTO
   * fuera distinto de una alucinación real con las mismas palabras. Esa
   * mitad del criterio —el hecho, no el texto— vive en `pipeline.ts`, igual
   * que en el guardarraíl de afirmar sin verificar: la función pura no
   * puede (ni debe) saber si hubo consulta.
   */
  it("caza el mismo patrón de texto aunque en producción fuera legítimo (la otra mitad del criterio vive en pipeline.ts)", () => {
    expect(
      niegaDisponibilidadSinVerificar(
        "Lo siento, hoy ya no tengo disponibilidad para ambos servicios. 😔 ¿Te gustaría que busquemos para mañana miércoles 19 de agosto, o para otro día? 🗓️"
      )
    ).toBe(true);
  });

  it("no cuenta si la única negación está en una pregunta", () => {
    expect(
      niegaDisponibilidadSinVerificar("¿Será que ya no tengo horarios disponibles para hoy?")
    ).toBe(false);
  });

  it("un saludo o una confirmación normal no activa nada", () => {
    expect(
      niegaDisponibilidadSinVerificar("¡Hola hermosa! ¿En qué te puedo ayudar hoy? ✨")
    ).toBe(false);
    expect(
      niegaDisponibilidadSinVerificar("¡Perfecto! Tu retoque de Volumen Ruso quedó anotado.")
    ).toBe(false);
  });

  it("no se cae con texto vacío o nulo", () => {
    expect(niegaDisponibilidadSinVerificar(null)).toBe(false);
    expect(niegaDisponibilidadSinVerificar(undefined)).toBe(false);
    expect(niegaDisponibilidadSinVerificar("")).toBe(false);
  });
});
