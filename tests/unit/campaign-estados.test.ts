import { describe, expect, it } from "vitest";
import { transicionCampanaValida } from "@/server/campaigns/estados";

/**
 * Fase 6A: la máquina de estados de `campaign` en sí — pura, sin DB. Los 8
 * valores ya existían en el schema desde la Fase 3C; aquí solo se valida
 * cuáles saltos están permitidos.
 */

describe("transicionCampanaValida: transiciones mínimas requeridas", () => {
  it("draft → ready", () => {
    expect(transicionCampanaValida("draft", "ready")).toBe(true);
  });

  it("ready → scheduled", () => {
    expect(transicionCampanaValida("ready", "scheduled")).toBe(true);
  });

  it("ready → processing", () => {
    expect(transicionCampanaValida("ready", "processing")).toBe(true);
  });

  it("scheduled → processing", () => {
    expect(transicionCampanaValida("scheduled", "processing")).toBe(true);
  });

  it("processing → paused", () => {
    expect(transicionCampanaValida("processing", "paused")).toBe(true);
  });

  it("paused → processing", () => {
    expect(transicionCampanaValida("paused", "processing")).toBe(true);
  });

  it("processing → completed", () => {
    expect(transicionCampanaValida("processing", "completed")).toBe(true);
  });

  it("processing → failed", () => {
    expect(transicionCampanaValida("processing", "failed")).toBe(true);
  });

  it.each(["draft", "ready", "scheduled", "paused"] as const)(
    "%s → cancelled",
    (desde) => {
      expect(transicionCampanaValida(desde, "cancelled")).toBe(true);
    }
  );
});

describe("transicionCampanaValida: nada arbitrario, nada de terminales reabiertos", () => {
  it("draft no puede saltar directo a processing/completed", () => {
    expect(transicionCampanaValida("draft", "processing")).toBe(false);
    expect(transicionCampanaValida("draft", "completed")).toBe(false);
  });

  it("completed/cancelled/failed son terminales — ninguna salida", () => {
    for (const terminal of ["completed", "cancelled", "failed"] as const) {
      for (const destino of [
        "draft",
        "ready",
        "scheduled",
        "processing",
        "paused",
        "completed",
        "cancelled",
        "failed",
      ] as const) {
        expect(transicionCampanaValida(terminal, destino)).toBe(false);
      }
    }
  });

  it("ready no puede volver a draft", () => {
    expect(transicionCampanaValida("ready", "draft")).toBe(false);
  });
});
