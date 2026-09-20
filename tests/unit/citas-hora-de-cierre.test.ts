import { describe, expect, it } from "vitest";
import { calcularDisponibilidad, esFechaValida } from "@/server/appointments/logic";
import { franjaDelDia, horarioSemanalDesdeLegacy } from "@/server/horario";

/**
 * QUÉ SIGNIFICA LA HORA DE CIERRE EN UNA AGENDA DE CITAS.
 *
 * No es lo mismo "hasta qué hora se RECIBEN citas" que "a qué hora tiene que
 * estar terminado el servicio". Confundirlas cuesta dinero en las dos
 * direcciones: si el cierre fuera el fin obligatorio, un Volumen Ruso de 150
 * minutos dejaría de poder agendarse a partir de las 16:00 en un salón que
 * cierra a las 18:30 — y el salón lo acepta sin problema, porque termina
 * cuando termina.
 *
 * Y ya pasó: el 18-ago-2026 se rechazó un "Press on" de 120 minutos a la hora
 * de cierre con la especialista libre toda la tarde.
 *
 * Esta prueba fija la semántica que el motor YA implementa, para que nadie la
 * cambie sin darse cuenta: **la hora de cierre es la última hora a la que se
 * puede EMPEZAR**. El servicio corre después si hace falta.
 *
 * Caso de referencia: Lashes Valen, 09:30–18:30.
 */

/** El salón: 09:30–18:30, lunes a sábado. */
const SALON = horarioSemanalDesdeLegacy({
  dias: "1,2,3,4,5,6",
  abre: "09:30",
  cierra: "18:30",
});
/** La franja de un lunes. */
const LUNES = franjaDelDia(SALON, 1);

/** Los huecos que ofrece el motor para una especialista libre. */
const huecos = (duracionMin: number) =>
  Object.keys(
    calcularDisponibilidad({
      recursoIds: ["hilary"],
      citas: [],
      duracionMin,
      franja: LUNES,
      esHoy: false,
    })
  );

describe("la hora de cierre es la última hora de INICIO, no la de fin", () => {
  it("09:30 — la apertura es agendable", () => {
    expect(huecos(60)).toContain("09:30");
  });

  it("18:30 — la hora de cierre EXACTA es agendable", () => {
    /*
     * Este es el caso que el negocio pidió explícitamente: un cliente que
     * escribe "quiero una cita hoy a las 6:30" debe poder tenerla.
     */
    expect(huecos(60)).toContain("18:30");
  });

  it("18:30 con un servicio de 60 min termina a las 19:30, y se permite", () => {
    /*
     * El motor NO compara `inicio + duración` contra el cierre. Solo mira
     * choques con otras citas. Por eso una cita puede terminar después del
     * cierre: es lo correcto para un salón, donde el cierre es cuándo deja
     * de recibir, no cuándo apaga las luces.
     */
    expect(huecos(60)).toContain("18:30");
    // Y con un servicio largo tampoco cambia nada: 150 min → 21:00.
    expect(huecos(150)).toContain("18:30");
  });

  it("después del cierre NO hay hueco: 19:00 no se ofrece", () => {
    const h = huecos(60);
    expect(h).not.toContain("19:00");
    expect(h).not.toContain("18:45");
    // El último hueco del día es exactamente la hora de cierre.
    expect(h[h.length - 1]).toBe("18:30");
  });

  it("la rejilla es de 30 minutos: 18:29 no existe como hueco", () => {
    /*
     * ⚠️ MATIZ IMPORTANTE, y no es lo mismo que "18:29 está fuera de
     * horario": el motor ofrece huecos cada 30 minutos desde la apertura,
     * así que 18:29 no se rechaza por tarde — **no existe**. Tampoco existe
     * 09:31 ni 12:07.
     *
     * Quien pida "18:29" recibe `sin_cupo`, que es el mismo resultado que
     * pedir una hora ocupada. La granularidad es una regla del motor, no del
     * horario, y cambiarla sería otra decisión.
     */
    const h = huecos(60);
    expect(h).not.toContain("18:29");
    expect(h).not.toContain("09:31");
    expect(h.every((hora) => /:(00|30)$/.test(hora))).toBe(true);
  });
});

describe("el día sigue mandando: el cierre no lo cambia", () => {
  it("el domingo no está en el horario → ninguna fecha de domingo es válida", () => {
    // Domingo 27-sep-2026; hoy, lunes 21.
    expect(esFechaValida("27/09/2026", SALON, new Date("2026-09-21T20:00:00Z"))).toBe(false);
  });

  it("un día cerrado no ofrece huecos, aunque la franja exista para otros días", () => {
    expect(
      Object.keys(
        calcularDisponibilidad({
          recursoIds: ["hilary"],
          citas: [],
          duracionMin: 60,
          franja: franjaDelDia(SALON, 7), // domingo → null
          esHoy: false,
        })
      )
    ).toEqual([]);
  });
});

describe("una cita existente libera su hueco al minuto exacto en que termina", () => {
  it("una cita de 150 min desde las 09:30 libera las 12:00", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["hilary"],
      citas: [{ recursoId: "hilary", startMin: 9 * 60 + 30, endMin: 12 * 60 }],
      duracionMin: 30,
      franja: LUNES,
      esHoy: false,
    });
    expect(disp["12:00"]).toContain("hilary");
    expect(disp["11:30"] ?? []).not.toContain("hilary");
  });

  it("y una cita que termina DESPUÉS del cierre no añade un hueco fuera de hora", () => {
    /*
     * Una cita de 18:30 a 21:00 termina fuera del horario. El motor añade
     * como candidato el minuto en que se libera un recurso, pero solo si cae
     * dentro de la franja — si no, ofrecería las 21:00 de un salón cerrado.
     */
    const disp = calcularDisponibilidad({
      recursoIds: ["hilary"],
      citas: [{ recursoId: "hilary", startMin: 18 * 60 + 30, endMin: 21 * 60 }],
      duracionMin: 30,
      franja: LUNES,
      esHoy: false,
    });
    expect(Object.keys(disp)).not.toContain("21:00");
    // Y las 18:30 quedan ocupadas, como debe ser.
    expect(disp["18:30"] ?? []).not.toContain("hilary");
  });
});
