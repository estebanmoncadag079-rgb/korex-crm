import { describe, expect, it } from "vitest";

/**
 * Confirmar una cita que nadie agendó es el error más caro del vertical: la
 * clienta se presenta un día que el salón no la espera.
 *
 * **Caso real (7-ago-2026, probando el salón antes de su primer día)**: a un
 * "si confirmo" suelto, sin nada agendado en la conversación, el agente
 * respondió *"¡Te agendamos para el jueves 13 de agosto a las 10:00 con Laura
 * para Baño de acrílico o poligel!"* — usando `reply`, no
 * `book_appointment`. Se inventó servicio, día, hora y especialista, y no se
 * guardó ninguna cita.
 *
 * El prompt ya lo prohibía con todas las letras. No bastó: se comprueba en el
 * servidor.
 */

import { anunciaCitaAgendada } from "@/server/ai/anuncio-de-cierre";

describe("detectar que el texto confirma una cita", () => {
  it("atrapa la frase exacta del caso real", () => {
    expect(
      anunciaCitaAgendada(
        "¡Perfecto! Te agendamos para el jueves 13 de agosto a las 10:00 con Laura para el servicio de Baño de acrílico o poligel."
      )
    ).toBe(true);
  });

  it("atrapa las variantes que usa el modelo", () => {
    for (const texto of [
      "Quedaste agendada para el martes a las 3",
      "Tu cita quedó confirmada",
      "Tu cita ya está agendada 💗",
      "Listo, te reservé el horario",
      "Cita agendada con éxito",
      "Ya te la dejé agendada",
    ]) {
      expect(anunciaCitaAgendada(texto), texto).toBe(true);
    }
  });

  /**
   * Estrecho a propósito: un falso positivo rehace un turno que estaba bien
   * (y si insiste, lo toma una persona). Hablar de agendar no es confirmar.
   */
  it("NO se dispara con frases que solo hablan de agendar", () => {
    for (const texto of [
      "¿Te gustaría agendar una cita?",
      "Con gusto te ayudo a agendar",
      "¿Para qué día quieres agendar tu cita?",
      "Tengo disponibilidad a las 9:00 AM, ¿te sirve?",
      "Para agendar necesito saber qué servicio quieres",
      "¿Confirmas que agendo el martes a las 3?",
    ]) {
      expect(anunciaCitaAgendada(texto), texto).toBe(false);
    }
  });

  it("no revienta con texto vacío", () => {
    expect(anunciaCitaAgendada(null)).toBe(false);
    expect(anunciaCitaAgendada("")).toBe(false);
  });
});
