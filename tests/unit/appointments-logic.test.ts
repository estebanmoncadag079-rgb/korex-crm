import { describe, expect, it } from "vitest";

/**
 * Motor de disponibilidad de citas: lo mismo que ya se probó a fondo para el
 * horario de atención (tests/unit/horario-negocio.test.ts), pero para slots de
 * agenda. La disponibilidad la calcula el SERVIDOR — estos tests son la prueba
 * de que el cálculo es correcto antes de que el agente la use para responder.
 */

import {
  bogotaAUtc,
  buscarServicio,
  calcularDisponibilidad,
  diaDeSemana,
  encontrarCitaActiva,
  esFechaValida,
  esHoy,
  horaAAmPm,
  horaAMin,
  minAHora,
  normalizarFecha,
  rangoDelDiaUtc,
  utcAFechaHoraBogota,
  type ServiceRow,
} from "@/server/appointments/logic";

const SERVICIOS: ServiceRow[] = [
  { id: "svc_1", name: "Semipermanente", category: "unas", priceCents: 4000000, durationMin: 45 },
  { id: "svc_2", name: "Volumen Ruso", category: "pestanas", priceCents: 13500000, durationMin: 150 },
  { id: "svc_3", name: "Efecto Natural", category: "pestanas", priceCents: 9500000, durationMin: 120 },
  { id: "svc_4", name: "Retoque de acrílico", category: "unas", priceCents: 7500000, durationMin: 45 },
];

describe("buscarServicio (catálogo por nombre parafraseado)", () => {
  it("encuentra por coincidencia exacta, sin importar mayúsculas", () => {
    expect(buscarServicio(SERVICIOS, "semipermanente")?.id).toBe("svc_1");
    expect(buscarServicio(SERVICIOS, "SEMIPERMANENTE")?.id).toBe("svc_1");
  });

  it("tolera tildes", () => {
    expect(buscarServicio(SERVICIOS, "volumen rúso")?.id).toBe("svc_2");
  });

  it("encuentra por nombre parafraseado (paciente dice otra cosa que el catálogo)", () => {
    expect(buscarServicio(SERVICIOS, "extensión de pestañas natural")?.id).toBe("svc_3");
  });

  it("no inventa un match cuando no hay ninguno razonable", () => {
    expect(buscarServicio(SERVICIOS, "corte de cabello")).toBeNull();
  });

  it("con el catálogo vacío, nunca encuentra nada", () => {
    expect(buscarServicio([], "semipermanente")).toBeNull();
  });
});

describe("encontrarCitaActiva (mismo emparejamiento, sobre citas activas)", () => {
  const ACTIVAS = [
    { id: "cit_1", serviceName: "Semipermanente" },
    { id: "cit_2", serviceName: "Volumen Ruso" },
  ];

  it("encuentra por nombre parafraseado, igual que buscarServicio", () => {
    expect(encontrarCitaActiva(ACTIVAS, "volumen rúso")?.id).toBe("cit_2");
  });

  it("sin match razonable, no inventa una cita", () => {
    expect(encontrarCitaActiva(ACTIVAS, "corte de cabello")).toBeUndefined();
  });

  it("sin citas activas, nunca encuentra nada", () => {
    expect(encontrarCitaActiva([], "semipermanente")).toBeUndefined();
  });

  /**
   * 18-ago-2026: una visita puede llevar varios servicios ("manos y pies").
   * `serviceName` sigue siendo solo el PRINCIPAL — "cancela mi cita de pies"
   * tiene que encontrarla igual, buscando también en `serviceNames`.
   */
  it("encuentra por un servicio secundario de una visita multiservicio", () => {
    const conVarios = [
      { id: "cit_3", serviceName: "Semipermanente", serviceNames: ["Semipermanente", "Pedicure"] },
      { id: "cit_4", serviceName: "Volumen Ruso", serviceNames: ["Volumen Ruso"] },
    ];
    expect(encontrarCitaActiva(conVarios, "pedicure")?.id).toBe("cit_3");
  });

  it("sin serviceNames, se comporta exactamente igual que antes (solo serviceName)", () => {
    expect(encontrarCitaActiva(ACTIVAS, "semipermanente")?.id).toBe("cit_1");
  });
});

describe("conversión de horas", () => {
  it("horaAMin/minAHora son inversas", () => {
    expect(horaAMin("09:00")).toBe(540);
    expect(horaAMin("14:30")).toBe(870);
    expect(minAHora(540)).toBe("09:00");
    expect(minAHora(870)).toBe("14:30");
  });

  it("horaAAmPm formatea en 12 horas", () => {
    expect(horaAAmPm("00:00")).toBe("12:00 AM");
    expect(horaAAmPm("09:05")).toBe("9:05 AM");
    expect(horaAAmPm("12:00")).toBe("12:00 PM");
    expect(horaAAmPm("15:30")).toBe("3:30 PM");
  });
});

describe("normalizarFecha", () => {
  it("agrega ceros a la izquierda", () => {
    expect(normalizarFecha("5/8/2026")).toBe("05/08/2026");
    expect(normalizarFecha("05/08/2026")).toBe("05/08/2026");
  });

  it("acepta guiones como separador", () => {
    expect(normalizarFecha("5-8-2026")).toBe("05/08/2026");
  });

  /**
   * Aquí se esperaba `null` para el formato ISO, y eso **era el bug**: el
   * modelo manda `2026-08-10` a menudo, la fecha seguía sin normalizar y
   * `esFechaValida` la leía como DD/MM (día "2026"). Caso real del 7-ago-2026:
   * el agente le dijo a una clienta "el lunes 10 de agosto ya pasó" un
   * viernes 7.
   */
  it("acepta el formato ISO que manda el modelo", () => {
    expect(normalizarFecha("2026-08-05")).toBe("05/08/2026");
    expect(normalizarFecha("2026-8-5")).toBe("05/08/2026");
  });

  it("rechaza formatos que no calzan", () => {
    expect(normalizarFecha("mañana")).toBeNull();
    expect(normalizarFecha("08/2026")).toBeNull();
    expect(normalizarFecha("")).toBeNull();
  });
});

describe("día de la semana y validez de fecha", () => {
  // 28-jul-2026 es martes (mismo ancla que horario-negocio.test.ts).
  it("calcula el día de la semana (1=lunes…7=domingo)", () => {
    expect(diaDeSemana("28/07/2026")).toBe(2); // martes
    expect(diaDeSemana("26/07/2026")).toBe(7); // domingo
  });

  it("una fecha con formato inválido no tiene día de semana", () => {
    expect(diaDeSemana("2026-07-28")).toBeNull();
  });

  const LUNES_A_SABADO = { open: "09:00", close: "18:00", days: "1,2,3,4,5,6" };

  it("rechaza un día que el negocio no atiende", () => {
    // 26-jul-2026 es domingo.
    expect(esFechaValida("26/07/2026", LUNES_A_SABADO, new Date("2026-07-20T12:00:00Z"))).toBe(false);
  });

  it("acepta un día hábil futuro", () => {
    expect(esFechaValida("28/07/2026", LUNES_A_SABADO, new Date("2026-07-20T12:00:00Z"))).toBe(true);
  });

  it("rechaza una fecha ya pasada", () => {
    expect(esFechaValida("01/07/2026", LUNES_A_SABADO, new Date("2026-07-20T12:00:00Z"))).toBe(false);
  });

  it("HOY mismo es agendable (no es 'pasado')", () => {
    // 28-jul-2026 05:00 UTC = 00:00 en Bogotá: sigue siendo 28 en Bogotá.
    expect(esFechaValida("28/07/2026", LUNES_A_SABADO, new Date("2026-07-28T05:00:00Z"))).toBe(true);
  });
});

describe("esHoy", () => {
  it("compara contra el día en Bogotá, no en UTC", () => {
    // 2026-07-29T04:00:00Z = 2026-07-28 23:00 en Bogotá: sigue siendo 28.
    expect(esHoy("28/07/2026", new Date("2026-07-29T04:00:00Z"))).toBe(true);
    expect(esHoy("29/07/2026", new Date("2026-07-29T04:00:00Z"))).toBe(false);
  });
});

describe("Bogotá ⇄ UTC (Bogotá es UTC-5 fijo, sin horario de verano)", () => {
  it("bogotaAUtc y utcAFechaHoraBogota son inversas", () => {
    const instante = bogotaAUtc("28/07/2026", "15:00")!;
    expect(instante.toISOString()).toBe("2026-07-28T20:00:00.000Z");
    expect(utcAFechaHoraBogota(instante)).toEqual({ fecha: "28/07/2026", hora: "15:00" });
  });

  it("devuelve null con una fecha mal formada", () => {
    expect(bogotaAUtc("2026-07-28", "15:00")).toBeNull();
  });

  it("rangoDelDiaUtc cubre exactamente ese día de negocio en Bogotá", () => {
    const [inicio, fin] = rangoDelDiaUtc("28/07/2026")!;
    expect(inicio.toISOString()).toBe("2026-07-28T05:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-07-29T05:00:00.000Z");
  });
});

describe("calcularDisponibilidad", () => {
  const HOURS = { open: "09:00", close: "17:00", days: "1,2,3,4,5,6,7" };

  /**
   * 13-ago-2026: el salón tenía su horario escrito "9 AM"/"8 PM". `Number("9
   * AM")` es NaN, la ventana del día salía NaN y no se generaba ni un hueco:
   * durante dos días el agente rechazó todas las citas —"ese día está full"—
   * con la agenda vacía, sin un solo error en ningún log.
   */
  it("entiende el horario escrito como lo escribe una persona", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [],
      duracionMin: 60,
      hours: { open: "9 AM", close: "5 PM", days: "1,2,3,4,5,6,7" },
      esHoy: false,
    });
    expect(disp["09:00"]).toEqual(["laura"]);
    expect(disp["16:00"]).toEqual(["laura"]);
  });

  it("con un horario ilegible no ofrece nada, pero tampoco revienta", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [],
      duracionMin: 60,
      hours: { open: "por la mañana", close: "tardecito", days: "1,2,3" },
      esHoy: false,
    });
    expect(disp).toEqual({});
  });

  it("sin citas, ofrece la grilla completa hasta la hora de cierre", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [],
      duracionMin: 60,
      hours: HOURS,
      esHoy: false,
    });
    expect(disp["09:00"]).toEqual(["laura"]);
    /*
     * El cierre (17:00) es el límite para EMPEZAR, no para terminar: un
     * servicio de 60 min agendado a las 16:30 (o incluso a las 17:00, la
     * hora exacta de cierre) sigue después — corregido el 18-ago-2026 tras
     * un caso real: "Press on" de 120 min rechazado a la hora de cierre con
     * la especialista libre toda la tarde.
     */
    expect(disp["16:30"]).toEqual(["laura"]);
    expect(disp["17:00"]).toEqual(["laura"]);
    expect(disp["17:30"]).toBeUndefined(); // después del cierre, ya no se ofrece
  });

  it("una cita existente bloquea los slots que se solapan", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [{ recursoId: "laura", startMin: 600, endMin: 660 }], // 10:00–11:00
      duracionMin: 60,
      hours: HOURS,
      esHoy: false,
    });
    expect(disp["09:00"]).toEqual(["laura"]); // no se solapa
    expect(disp["10:00"]).toBeUndefined(); // exactamente ocupado
    expect(disp["10:30"]).toBeUndefined(); // se solapa a medias
  });

  it("libera un slot dinámico justo cuando termina la cita anterior", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [{ recursoId: "laura", startMin: 600, endMin: 660 }], // 10:00–11:00
      duracionMin: 60,
      hours: HOURS,
      esHoy: false,
    });
    // 11:00 no es múltiplo raro de la grilla de 30, pero SÍ es el fin exacto de
    // la cita anterior: debe quedar libre sin esperar al siguiente redondeo.
    expect(disp["11:00"]).toEqual(["laura"]);
  });

  it("hoy, descarta los slots que ya pasaron", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [],
      duracionMin: 60,
      hours: HOURS,
      esHoy: true,
      minutosAhoraSiEsHoy: 630, // 10:30
    });
    expect(disp["09:00"]).toBeUndefined();
    expect(disp["10:00"]).toBeUndefined();
    expect(disp["10:30"]).toEqual(["laura"]);
  });

  it("cada especialista tiene su propia agenda: la ocupación de una no afecta a otra", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura", "hilary"],
      citas: [{ recursoId: "laura", startMin: 600, endMin: 660 }], // 10:00–11:00, solo Laura
      duracionMin: 60,
      hours: HOURS,
      esHoy: false,
    });
    expect(disp["10:00"]).toEqual(["hilary"]);
  });

  it("sin horario configurado, no hay disponibilidad (mejor callar que inventar)", () => {
    const disp = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: [],
      duracionMin: 60,
      hours: { open: null, close: null, days: null },
      esHoy: false,
    });
    expect(Object.keys(disp)).toHaveLength(0);
  });

  /**
   * 18-ago-2026: corregida la regla del cierre (ver el docblock de
   * `calcularDisponibilidad`) — la duración YA NO reduce el último hueco
   * del día, porque el cierre solo limita cuándo EMPIEZA una cita, no
   * cuándo termina. `disponibilidadRealMultiple` (queries.ts) le pasa a
   * esta función la SUMA de `durationMin` de los servicios de la visita
   * ("manos y pies" → 45+45); lo que sigue importando es el SOLAPE con
   * citas YA agendadas, no la hora de cierre.
   */
  it("una duración combinada sigue chocando más con las citas existentes, pero ya no con el cierre", () => {
    const citaExistente = [{ recursoId: "laura", startMin: 900, endMin: 930 }]; // 15:00–15:30
    const unServicio = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: citaExistente,
      duracionMin: 45,
      hours: HOURS,
      esHoy: false,
    });
    const dosServicios = calcularDisponibilidad({
      recursoIds: ["laura"],
      citas: citaExistente,
      duracionMin: 45 + 45, // "manos y pies": dos servicios de 45 min
      hours: HOURS,
      esHoy: false,
    });
    expect(unServicio["14:00"]).toEqual(["laura"]); // 45 min: termina 14:45, libre
    expect(dosServicios["14:00"]).toBeUndefined(); // 90 min: se solaparía con la cita de las 15:00
    // Las dos, sin embargo, siguen pudiendo empezar justo al cierre (17:00):
    // caso real (18-ago-2026), "Press on" de 120 min rechazado a la hora
    // de cierre con la especialista libre toda la tarde.
    expect(unServicio["17:00"]).toEqual(["laura"]);
    expect(dosServicios["17:00"]).toEqual(["laura"]);
  });
});
