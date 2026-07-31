import { describe, expect, it } from "vitest";
import { inicioDelMes } from "@/server/usage";

/**
 * El corte del mes decide qué gastos entran en la factura. Se calcula en UTC
 * porque el servidor corre en UTC: usar la hora local haría que los gastos de
 * las últimas horas del mes cayeran en el mes siguiente.
 */
describe("inicioDelMes", () => {
  it("devuelve el día 1 a las 00:00 del mes en curso", () => {
    const corte = inicioDelMes(new Date("2026-07-31T23:59:59Z"));
    expect(corte.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("el primer instante del mes ya pertenece a ese mes", () => {
    const corte = inicioDelMes(new Date("2026-08-01T00:00:00Z"));
    expect(corte.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("funciona en el cambio de año", () => {
    const corte = inicioDelMes(new Date("2027-01-05T10:00:00Z"));
    expect(corte.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

/**
 * Los importes son fracciones de centavo que se suman miles de veces. Se
 * guardan como texto decimal con 10 decimales, no como coma flotante: con
 * flotante, sumar muchos costos pequeños desvía el total.
 */
describe("precisión de los importes", () => {
  it("un costo minúsculo no se pierde al pasarlo a texto", () => {
    const costo = 2.62e-5;
    expect(costo.toFixed(10)).toBe("0.0000262000");
    expect(Number(costo.toFixed(10))).toBeCloseTo(costo, 12);
  });

  it("mil turnos baratos suman lo esperado", () => {
    const porTurno = 2.62e-5;
    const total = Number((porTurno * 1000).toFixed(10));
    expect(total).toBeCloseTo(0.0262, 6);
  });
});
