import { describe, expect, it } from "vitest";

/**
 * Si el negocio atiende o no en este momento se decide aquí, no en el modelo.
 * Cuando se lo dejábamos deducir a partir del horario escrito en prosa, leía
 * las 12:02 de la madrugada como si cayeran dentro de un horario que abre a las
 * 12:30 pm y le decía al cliente que estaba abierto a medianoche.
 */

import { abreMasTardeHoy, businessStatus } from "@/server/ai/prompts";

/** La Churra: 12:30–20:30, todos los días. */
const CHURRA = { open: "12:30", close: "20:30", days: "1,2,3,4,5,6,7" };

/** Instantes UTC; Bogotá es UTC-5. */
const enBogota = (utc: string) => new Date(utc);

describe("¿el negocio atiende ahora?", () => {
  it("a medianoche está cerrado, aunque el horario diga 12:30", () => {
    // 05:02 UTC = 00:02 en Bogotá — el caso que rompía en producción.
    expect(businessStatus(CHURRA, enBogota("2026-07-28T05:02:00Z"))).toBe("cerrado");
  });

  it("a media tarde está abierto", () => {
    // 20:40 UTC = 15:40 en Bogotá.
    expect(businessStatus(CHURRA, enBogota("2026-07-28T20:40:00Z"))).toBe("abierto");
  });

  it("respeta los bordes: abre a las 12:30 y cierra a las 20:30", () => {
    expect(businessStatus(CHURRA, enBogota("2026-07-28T17:29:00Z"))).toBe("cerrado"); // 12:29
    expect(businessStatus(CHURRA, enBogota("2026-07-28T17:30:00Z"))).toBe("abierto"); // 12:30
    expect(businessStatus(CHURRA, enBogota("2026-07-29T01:29:00Z"))).toBe("abierto"); // 20:29
    expect(businessStatus(CHURRA, enBogota("2026-07-29T01:30:00Z"))).toBe("cerrado"); // 20:30
  });

  it("cierra los días en que el negocio no abre", () => {
    // Domingo 26-jul-2026, 15:00 en Bogotá: dentro de la franja pero sin abrir.
    const soloEntreSemana = { ...CHURRA, days: "1,2,3,4,5" };
    expect(businessStatus(soloEntreSemana, enBogota("2026-07-26T20:00:00Z"))).toBe("cerrado");
    expect(businessStatus(CHURRA, enBogota("2026-07-26T20:00:00Z"))).toBe("abierto");
  });

  it("entiende un horario que cruza la medianoche", () => {
    const nocturno = { open: "18:00", close: "02:00", days: "1,2,3,4,5,6,7" };
    expect(businessStatus(nocturno, enBogota("2026-07-29T04:00:00Z"))).toBe("abierto"); // 23:00
    expect(businessStatus(nocturno, enBogota("2026-07-29T06:00:00Z"))).toBe("abierto"); // 01:00
    expect(businessStatus(nocturno, enBogota("2026-07-29T15:00:00Z"))).toBe("cerrado"); // 10:00
  });

  it("calla si el negocio no configuró horario — mejor que afirmar en falso", () => {
    expect(businessStatus({ open: null, close: null, days: null })).toBeNull();
    expect(businessStatus({ open: "abrimos temprano", close: "20:30", days: null })).toBeNull();
    expect(businessStatus({ open: "99:99", close: "20:30", days: null })).toBeNull();
  });
});

/**
 * Cerrado de madrugada y cerrado por la mañana no son lo mismo. El negocio
 * tiene UN solo mensaje para "ahora no atendemos" y habla de mañana: a quien
 * escribía a las once de la mañana le contestaba "te lo reagendo para mañana"
 * con la apertura a noventa minutos. Una venta regalada cada mañana.
 */
describe("¿abre más tarde hoy?", () => {
  it("por la mañana avisa cuántos minutos faltan para abrir", () => {
    // 16:00 UTC = 11:00 en Bogotá; abre 12:30 → 90 minutos.
    expect(abreMasTardeHoy(CHURRA, enBogota("2026-07-28T16:00:00Z"))).toBe(90);
  });

  it("un minuto antes de abrir sigue contando", () => {
    expect(abreMasTardeHoy(CHURRA, enBogota("2026-07-28T17:29:00Z"))).toBe(1);
  });

  it("con el negocio abierto no aplica", () => {
    expect(abreMasTardeHoy(CHURRA, enBogota("2026-07-28T20:40:00Z"))).toBeNull();
  });

  it("después de cerrar ya no abre hoy: toca hablar de mañana", () => {
    // 02:00 UTC del 29 = 21:00 del 28 en Bogotá, media hora tras el cierre.
    expect(abreMasTardeHoy(CHURRA, enBogota("2026-07-29T02:00:00Z"))).toBeNull();
  });

  it("en un día que el negocio no abre, no promete una apertura que no habrá", () => {
    const soloEntreSemana = { ...CHURRA, days: "1,2,3,4,5" };
    // Domingo 26-jul a las 11:00 en Bogotá: cerrado, y hoy no abre.
    expect(abreMasTardeHoy(soloEntreSemana, enBogota("2026-07-26T16:00:00Z"))).toBeNull();
  });

  it("una jornada que cruza medianoche no tiene 'más tarde hoy'", () => {
    const nocturno = { open: "18:00", close: "02:00", days: "1,2,3,4,5,6,7" };
    expect(abreMasTardeHoy(nocturno, enBogota("2026-07-29T15:00:00Z"))).toBeNull(); // 10:00
  });

  it("sin horario configurado, calla", () => {
    expect(abreMasTardeHoy({ open: null, close: null, days: null })).toBeNull();
  });
});
