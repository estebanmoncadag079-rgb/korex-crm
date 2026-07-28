import { describe, expect, it } from "vitest";

/**
 * El agente no tiene reloj: la hora se la damos nosotros. Y se la damos en 24 h
 * a propósito — con am/pm leía las 12:02 de la madrugada como si cayeran dentro
 * de un horario que abre a las 12:30 pm, y le decía al cliente que el negocio
 * estaba abierto a medianoche.
 */

import { nowForBusiness } from "@/server/ai/prompts";

/** 2026-07-28 05:02 UTC = 00:02 en Bogotá (UTC-5). */
const MEDIANOCHE_EN_BOGOTA = new Date("2026-07-28T05:02:00Z");

describe("la hora que ve el agente", () => {
  it("no usa am/pm — la medianoche no puede confundirse con el mediodía", () => {
    const texto = nowForBusiness(MEDIANOCHE_EN_BOGOTA);
    expect(texto).toMatch(/00:02/);
    expect(texto.toLowerCase()).not.toMatch(/\b[ap]\.?\s?m\.?\b/);
  });

  it("usa la hora del negocio, no la del servidor", () => {
    // El servidor corre en UTC: allí son las 05:02 del martes.
    expect(nowForBusiness(MEDIANOCHE_EN_BOGOTA)).toMatch(/00:02/);
    expect(nowForBusiness(MEDIANOCHE_EN_BOGOTA, "UTC")).toMatch(/05:02/);
  });

  it("incluye el día de la semana, que decide si el negocio abre", () => {
    expect(nowForBusiness(MEDIANOCHE_EN_BOGOTA).toLowerCase()).toContain("martes");
  });

  it("distingue una hora dentro del horario de atención", () => {
    // 2026-07-28 18:00 UTC = 13:00 en Bogotá, dentro de 12:30–20:30.
    expect(nowForBusiness(new Date("2026-07-28T18:00:00Z"))).toMatch(/13:00/);
  });
});
