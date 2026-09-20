import { describe, expect, it } from "vitest";

/**
 * Si el negocio atiende o no en este momento se decide aquí, no en el modelo.
 * Cuando se lo dejábamos deducir a partir del horario escrito en prosa, leía
 * las 12:02 de la madrugada como si cayeran dentro de un horario que abre a las
 * 12:30 pm y le decía al cliente que estaba abierto a medianoche.
 */

import { abreMasTardeHoy, businessStatus } from "@/server/ai/prompts";
import {
  horarioSemanalDesdeLegacy,
  type FranjaDelDia,
  type HorarioSemanal,
} from "@/server/horario";

/** Todos los días con la misma franja, en el modelo canónico. */
const todosLosDias = (abre: string, cierra: string): HorarioSemanal =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { abre, cierra }]));

/** Solo estos días, con la franja indicada. Los demás, cerrados. */
const soloDias = (dias: number[], franja: FranjaDelDia): HorarioSemanal =>
  Object.fromEntries(dias.map((d) => [d, { ...franja }]));

/** La Churra: 12:30–20:30, todos los días. */
const CHURRA = todosLosDias("12:30", "20:30");

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
    const soloEntreSemana = soloDias([1, 2, 3, 4, 5], { abre: "12:30", cierra: "20:30" });
    expect(businessStatus(soloEntreSemana, enBogota("2026-07-26T20:00:00Z"))).toBe("cerrado");
    expect(businessStatus(CHURRA, enBogota("2026-07-26T20:00:00Z"))).toBe("abierto");
  });

  it("entiende un horario que cruza la medianoche", () => {
    const nocturno = todosLosDias("18:00", "02:00");
    expect(businessStatus(nocturno, enBogota("2026-07-29T04:00:00Z"))).toBe("abierto"); // 23:00
    expect(businessStatus(nocturno, enBogota("2026-07-29T06:00:00Z"))).toBe("abierto"); // 01:00
    expect(businessStatus(nocturno, enBogota("2026-07-29T15:00:00Z"))).toBe("cerrado"); // 10:00
  });

  it("calla si el negocio no configuró horario — mejor que afirmar en falso", () => {
    expect(businessStatus({})).toBeNull();

    /*
     * Una hora que el servidor no sabe leer tampoco se afirma. Se comprueba
     * un LUNES (27-jul-2026), que es un día abierto en estos horarios: en un
     * día cerrado la respuesta sería "cerrado" —cierta y sin depender de la
     * hora—, y no estaría ejercitando lo que esta prueba vigila.
     */
    const unLunes = enBogota("2026-07-27T20:00:00Z");
    expect(
      businessStatus(
        horarioSemanalDesdeLegacy({ dias: "1,2,3", abre: "abrimos temprano", cierra: "20:30" }),
        unLunes
      )
    ).toBeNull();
    expect(
      businessStatus(
        horarioSemanalDesdeLegacy({ dias: "1,2,3", abre: "99:99", cierra: "20:30" }),
        unLunes
      )
    ).toBeNull();
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
    const soloEntreSemana = soloDias([1, 2, 3, 4, 5], { abre: "12:30", cierra: "20:30" });
    // Domingo 26-jul a las 11:00 en Bogotá: cerrado, y hoy no abre.
    expect(abreMasTardeHoy(soloEntreSemana, enBogota("2026-07-26T16:00:00Z"))).toBeNull();
  });

  it("una jornada que cruza medianoche no tiene 'más tarde hoy'", () => {
    const nocturno = todosLosDias("18:00", "02:00");
    expect(abreMasTardeHoy(nocturno, enBogota("2026-07-29T15:00:00Z"))).toBeNull(); // 10:00
  });

  it("sin horario configurado, calla", () => {
    expect(abreMasTardeHoy({})).toBeNull();
  });
});

/**
 * Patrón real (Lis Pastelería, 3-ago-2026): entre semana un horario, domingo
 * reducido.
 *
 * ⚠️ **Este bloque cambió el 20-sep-2026, y el cambio ES el arreglo.** Antes
 * estas pruebas fijaban que el domingo abría "aunque el 7 no esté en days":
 * una franja de domingo suelta bastaba para abrir el día. Eso es literalmente
 * el incidente que vivió Lis — desmarcó el domingo en su pantalla, la franja
 * se quedó puesta, y el bot siguió ofreciendo servicio ese día.
 *
 * Lo que aquel diseño quería resolver sigue resuelto, y mejor: un negocio
 * puede tener el domingo con horario propio. Solo que ahora se dice de la
 * única forma que existe —poniéndole su franja al día 7—, y ya no hay manera
 * de expresar "domingo cerrado con horario de domingo".
 */
describe("el domingo con horario propio (un día más, sin excepciones)", () => {
  // L-S 10:00-20:00, domingo 14:00-19:00. El domingo está abierto porque
  // tiene franja: no hay una segunda lista que pueda decir lo contrario.
  const LIS: HorarioSemanal = {
    ...soloDias([1, 2, 3, 4, 5, 6], { abre: "10:00", cierra: "20:00" }),
    7: { abre: "14:00", cierra: "19:00" },
  };

  it("domingo dentro de su propio rango: abierto", () => {
    // Domingo 26-jul-2026, 15:00 Bogotá.
    expect(businessStatus(LIS, enBogota("2026-07-26T20:00:00Z"))).toBe("abierto");
  });

  it("domingo antes de las 14:00: cerrado, aunque caiga en el 10-20 del resto", () => {
    // Domingo 26-jul-2026, 10:00 Bogotá.
    expect(businessStatus(LIS, enBogota("2026-07-26T15:00:00Z"))).toBe("cerrado");
  });

  it("domingo cuenta los minutos hasta SU apertura (14:00), no la de los demás", () => {
    // Domingo 26-jul-2026, 10:00 Bogotá → abre a las 14:00 → 240 minutos.
    expect(abreMasTardeHoy(LIS, enBogota("2026-07-26T15:00:00Z"))).toBe(240);
  });

  it("domingo tras las 19:00: cerrado, aunque el resto llegue a las 20:00", () => {
    // Domingo 26-jul-2026, 19:30 Bogotá.
    expect(businessStatus(LIS, enBogota("2026-07-27T00:30:00Z"))).toBe("cerrado");
    expect(abreMasTardeHoy(LIS, enBogota("2026-07-27T00:30:00Z"))).toBeNull();
  });

  it("un lunes normal sigue con su rango, sin verse afectado", () => {
    // Lunes 27-jul-2026, 15:00 Bogotá.
    expect(businessStatus(LIS, enBogota("2026-07-27T20:00:00Z"))).toBe("abierto");
  });

  it("EL INCIDENTE: domingo desmarcado + franja de domingo suelta → CERRADO", () => {
    /*
     * El estado exacto que tenía Lis en producción: `hours_days` sin el 7 y
     * `hours_open_sunday = "14:00"`. Antes devolvía "abierto" y el bot tomaba
     * pedidos un día cerrado. Ahora la franja huérfana se descarta al leer,
     * porque el domingo no está entre los días abiertos.
     */
    const comoEstabaLis = horarioSemanalDesdeLegacy({
      dias: "1,2,3,4,5,6",
      abre: "10:00",
      cierra: "20:00",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
    expect(businessStatus(comoEstabaLis, enBogota("2026-07-26T20:00:00Z"))).toBe("cerrado");
    expect(abreMasTardeHoy(comoEstabaLis, enBogota("2026-07-26T15:00:00Z"))).toBeNull();
  });

  it("un domingo sin franja está cerrado, punto", () => {
    const sinDomingo = soloDias([1, 2, 3, 4, 5, 6], { abre: "10:00", cierra: "20:00" });
    expect(businessStatus(sinDomingo, enBogota("2026-07-26T20:00:00Z"))).toBe("cerrado");
  });

  it("cada día puede tener el suyo, no solo el domingo", () => {
    const variado: HorarioSemanal = {
      1: { abre: "08:00", cierra: "12:00" },
      6: { abre: "14:00", cierra: "22:00" },
    };
    // Lunes 27-jul, 09:00 Bogotá → abierto; 15:00 → cerrado.
    expect(businessStatus(variado, enBogota("2026-07-27T14:00:00Z"))).toBe("abierto");
    expect(businessStatus(variado, enBogota("2026-07-27T20:00:00Z"))).toBe("cerrado");
    // Sábado 25-jul, 15:00 Bogotá → abierto, con su propia franja.
    expect(businessStatus(variado, enBogota("2026-07-25T20:00:00Z"))).toBe("abierto");
  });
});
