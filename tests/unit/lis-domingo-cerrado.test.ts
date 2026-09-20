import { describe, expect, it } from "vitest";
import { businessStatus, horarioLegible } from "@/server/ai/prompts";
import { horarioSemanalDesdeLegacy, type HorarioSemanal } from "@/server/horario";

/**
 * Incidente real (20-sep-2026): el bot de Lis ofreció servicio un domingo que
 * el negocio tenía cerrado.
 *
 * Causa: `hours_open_sunday`/`hours_close_sunday` sobrevivieron a desmarcar
 * "Dom" en la UI, y tanto el resolutor de rangos como `horarioLegible` los
 * consultaban ANTES de mirar los días abiertos. Desmarcar el día no
 * desmarcaba nada.
 *
 * La primera versión de este archivo (esa misma mañana) comprobaba que la
 * LIMPIEZA de las columnas había surtido efecto, y dejaba fijado —a modo de
 * documentación— que con la franja huérfana el negocio se abría igual. Eso
 * era cierto y era el problema. Desde el rediseño del horario ya no puede
 * pasar, así que esa última prueba está invertida: **ahora exige que la
 * franja huérfana NO abra el día**.
 */

/** Lis tras la limpieza: lunes a sábado 10:00–20:00, domingo cerrado. */
const LIS: HorarioSemanal = horarioSemanalDesdeLegacy({
  dias: "1,2,3,4,5,6",
  abre: "10:00",
  cierra: "20:00",
});

/** Domingo 20-sep-2026, 19:00 hora de Colombia. */
const UN_DOMINGO = new Date("2026-09-21T00:00:00Z");

describe("Lis: el domingo quedó cerrado de verdad", () => {
  it("el horario legible dice CERRADO, no un rango", () => {
    const texto = horarioLegible(LIS);
    expect(texto).toMatch(/domingo CERRADO/i);
    expect(texto).not.toMatch(/domingo de/i);
  });

  it("businessStatus da 'cerrado' un domingo", () => {
    expect(businessStatus(LIS, UN_DOMINGO)).toBe("cerrado");
  });

  it("y sigue ABIERTO entre semana (no se rompió lo demás)", () => {
    // Lunes 21-sep-2026 a las 15:00 Colombia.
    expect(businessStatus(LIS, new Date("2026-09-21T20:00:00Z"))).toBe("abierto");
  });

  it("LA CAUSA, YA CERRADA: la franja de domingo huérfana ya no abre el día", () => {
    /*
     * El estado exacto que causó el incidente: los días sin el 7, pero las
     * columnas de domingo con valores. Antes, esto bastaba para que el
     * negocio "abriera" el domingo y para que el prompt recitara
     * "domingo de 14:00 a 19:00".
     *
     * Ahora la conversión al modelo canónico descarta la franja de un día que
     * no está abierto, así que el mismo dato podrido da el resultado correcto.
     * Limpiar las columnas sigue siendo lo deseable —y la migración lo hace—,
     * pero ya no es lo que separa a un cliente de un incidente.
     */
    const comoEstaba = horarioSemanalDesdeLegacy({
      dias: "1,2,3,4,5,6",
      abre: "10:00",
      cierra: "20:00",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
    expect(horarioLegible(comoEstaba)).not.toMatch(/domingo de 14:00 a 19:00/i);
    expect(horarioLegible(comoEstaba)).toMatch(/domingo CERRADO/i);
    expect(businessStatus(comoEstaba, UN_DOMINGO)).toBe("cerrado");
  });
});
