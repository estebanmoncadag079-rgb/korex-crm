import { describe, expect, it } from "vitest";
import { horaAMinutos, normalizarHora } from "@/lib/hora";

/**
 * 13-ago-2026. El salón guardó su horario como "9 AM" / "8 PM" y el agente pasó
 * dos días rechazando citas —"ese día está full"— con la agenda vacía: los dos
 * lectores del horario exigían `HH:MM` y uno de ellos devolvía NaN en silencio.
 */
describe("normalizarHora", () => {
  it("entiende lo que escribe una persona", () => {
    expect(normalizarHora("9 AM")).toBe("09:00");
    expect(normalizarHora("8 PM")).toBe("20:00");
    expect(normalizarHora("9am")).toBe("09:00");
    expect(normalizarHora("9:30 p.m.")).toBe("21:30");
    expect(normalizarHora("  7 Am ")).toBe("07:00");
  });

  it("respeta el formato de 24 h que ya usaban los clientes buenos", () => {
    expect(normalizarHora("12:30")).toBe("12:30");
    expect(normalizarHora("20:00")).toBe("20:00");
    expect(normalizarHora("09:00")).toBe("09:00");
    expect(normalizarHora("9")).toBe("09:00");
  });

  it("resuelve bien las dos horas que siempre se confunden", () => {
    expect(normalizarHora("12 AM")).toBe("00:00"); // medianoche
    expect(normalizarHora("12 PM")).toBe("12:00"); // mediodía
  });

  it("dice que NO cuando no se entiende, en vez de inventar", () => {
    expect(normalizarHora("por la mañana")).toBeNull();
    expect(normalizarHora("25:00")).toBeNull();
    expect(normalizarHora("10:70")).toBeNull();
    expect(normalizarHora("13 PM")).toBeNull();
    expect(normalizarHora("0 am")).toBeNull();
    expect(normalizarHora("")).toBeNull();
    expect(normalizarHora(null)).toBeNull();
  });
});

describe("horaAMinutos", () => {
  it("cuenta los minutos desde medianoche", () => {
    expect(horaAMinutos("09:00")).toBe(540);
    expect(horaAMinutos("14:30")).toBe(870);
    expect(horaAMinutos("9 AM")).toBe(540);
    expect(horaAMinutos("8 PM")).toBe(1200);
  });

  it("devuelve null en vez de NaN, que es lo que vaciaba la agenda", () => {
    expect(horaAMinutos("9 de la mañana")).toBeNull();
    expect(horaAMinutos(null)).toBeNull();
  });
});
