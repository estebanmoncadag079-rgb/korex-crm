import { describe, expect, it } from "vitest";

/**
 * Una corrida del Laboratorio simula seis conversaciones completas y las
 * califica con IA — unas 33 llamadas al modelo que paga la agencia, no el
 * cliente. Sin tope, un cliente pulsando "correr" una tarde cuesta más que su
 * mes entero de conversaciones reales.
 */

import { quotaExhausted, startOfMonth } from "@/server/lab/quota";

describe("cupo del Laboratorio", () => {
  it("corta al cliente cuando gastó sus corridas", () => {
    expect(quotaExhausted({ used: 5, limit: 5, left: 0 })).toBe(true);
    expect(quotaExhausted({ used: 4, limit: 5, left: 1 })).toBe(false);
  });

  it("nunca corta a la agencia, que es quien afina los agentes", () => {
    expect(quotaExhausted({ used: 500, limit: null, left: null })).toBe(false);
  });

  it("aguanta que el contador se pase del tope", () => {
    // Dos corridas en vuelo a la vez podrían dejar `used` por encima del tope.
    expect(quotaExhausted({ used: 7, limit: 5, left: 0 })).toBe(true);
  });
});

describe("cuándo se renueva el cupo", () => {
  it("empieza el día 1 del mes en curso", () => {
    const inicio = startOfMonth(new Date("2026-07-28T05:30:00Z"));
    expect(inicio.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("una corrida del mes pasado ya no cuenta", () => {
    const inicio = startOfMonth(new Date("2026-08-01T00:00:00Z"));
    expect(new Date("2026-07-31T23:59:00Z") < inicio).toBe(true);
    expect(new Date("2026-08-01T00:01:00Z") >= inicio).toBe(true);
  });

  it("no se confunde en enero, que cruza de año", () => {
    expect(startOfMonth(new Date("2027-01-15T10:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z"
    );
  });
});
