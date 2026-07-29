import { describe, expect, it } from "vitest";

/**
 * El score del Laboratorio llegó a medir la HORA a la que el dueño pulsó el
 * botón: 83 al mediodía y 30 de noche con el mismo agente. Los guiones son de
 * compra ("quiero la más pedida", "¿hacen domicilio?") y con el reloj de
 * producción, de noche, el agente contestaba —con razón— que estaba cerrado y
 * reagendaba para el día siguiente. El juez leía un desvío donde había
 * obediencia.
 *
 * `horaHabilDePrueba` fija ese suelo: la simulación corre siempre en horario
 * de atención.
 */

import { businessStatus, horaHabilDePrueba } from "@/server/ai/prompts";

/** Churrería: abre todos los días de 12:30 a 20:30 (hora de Bogotá). */
const DIURNO = { open: "12:30", close: "20:30", days: "1,2,3,4,5,6,7" };

/** Bar: cruza la medianoche, 18:00 → 02:00. */
const NOCTURNO = { open: "18:00", close: "02:00", days: "1,2,3,4,5,6,7" };

/** Solo de lunes a viernes: el sábado hay que saltar hasta el lunes. */
const ENTRE_SEMANA = { open: "09:00", close: "17:00", days: "1,2,3,4,5" };

/** Instante UTC a partir de una hora local de Bogotá (UTC-5, sin DST). */
function bogota(iso: string): Date {
  return new Date(`${iso}-05:00`);
}

describe("horaHabilDePrueba", () => {
  it("de noche y con el negocio cerrado, salta al horario de atención", () => {
    // 22:11 — la corrida que devolvió "reagendada para mañana" y un score de 30.
    const cerrado = bogota("2026-07-28T22:11:00");
    expect(businessStatus(DIURNO, cerrado)).toBe("cerrado");

    const hábil = horaHabilDePrueba(DIURNO, cerrado);
    expect(businessStatus(DIURNO, hábil)).toBe("abierto");
    expect(hábil.getTime()).toBeGreaterThan(cerrado.getTime());
  });

  it("si el negocio ya está abierto, no mueve el reloj más de la holgura", () => {
    const abierto = bogota("2026-07-28T14:00:00");
    const hábil = horaHabilDePrueba(DIURNO, abierto);
    expect(businessStatus(DIURNO, hábil)).toBe("abierto");
    // Una hora de holgura como máximo: sigue siendo la misma tarde.
    expect(hábil.getTime() - abierto.getTime()).toBeLessThanOrEqual(3600_000);
  });

  it("no se queda pegado en el minuto exacto de apertura", () => {
    // Justo antes de abrir: el primer instante hábil sería 12:30 en punto, y
    // "¿me lo traen ya?" en el minuto de apertura es un borde que el
    // Laboratorio no está tratando de medir.
    const antes = bogota("2026-07-28T12:00:00");
    const hábil = horaHabilDePrueba(DIURNO, antes);
    expect(businessStatus(DIURNO, hábil)).toBe("abierto");
    expect(hábil.getTime()).toBeGreaterThan(bogota("2026-07-28T12:30:00").getTime());
  });

  it("respeta un horario que cruza la medianoche", () => {
    const mediodía = bogota("2026-07-28T12:00:00");
    expect(businessStatus(NOCTURNO, mediodía)).toBe("cerrado");
    expect(businessStatus(NOCTURNO, horaHabilDePrueba(NOCTURNO, mediodía))).toBe(
      "abierto"
    );
  });

  it("salta el fin de semana cuando el negocio no abre", () => {
    const sábado = bogota("2026-08-01T11:00:00");
    expect(businessStatus(ENTRE_SEMANA, sábado)).toBe("cerrado");

    const hábil = horaHabilDePrueba(ENTRE_SEMANA, sábado);
    expect(businessStatus(ENTRE_SEMANA, hábil)).toBe("abierto");
    // Una semana de búsqueda alcanza de sobra para llegar al lunes.
    expect(hábil.getTime() - sábado.getTime()).toBeLessThan(7 * 86_400_000);
  });

  it("sin horario configurado devuelve el ahora tal cual", () => {
    const ahora = bogota("2026-07-28T03:00:00");
    const sinHorario = { open: null, close: null, days: null };
    expect(horaHabilDePrueba(sinHorario, ahora)).toBe(ahora);
  });
});
