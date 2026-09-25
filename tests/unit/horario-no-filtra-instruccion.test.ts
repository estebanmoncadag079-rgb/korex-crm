import { describe, expect, it } from "vitest";
import { horarioLegible } from "@/server/ai/prompts";
import { horarioSemanalDesdeLegacy, type HorarioSemanal } from "@/server/horario";

/**
 * Incidente real (24-sep-2026, gpt-5-mini en producción): al preguntarle el
 * horario, el bot le contestó al CLIENTE, literal:
 *
 *   "HORARIO DEL NEGOCIO (di exactamente esto si te preguntan, no lo redondees
 *    ni lo cambies): ..."
 *
 * Es decir, copió al pie de la letra una instrucción interna que era SOLO para
 * él. Causa: en `horarioLegible` la instrucción venía pegada como paréntesis
 * justo detrás de la etiqueta "HORARIO DEL NEGOCIO", así que el modelo la leía
 * como parte del texto a decir. El dato (las horas) y la instrucción (cómo
 * usarlo) estaban mezclados en la misma frase.
 *
 * El resto de este prompt ya separa dato de instrucción y marca lo interno
 * ("dato para TI", "NUNCA se la dices al cliente"). El horario era la excepción.
 *
 * Regla: el DATO tiene que poder repetirse tal cual sin filtrar nada interno;
 * la instrucción va aparte y marcada como para el asistente, no para el cliente.
 */

/** Lunes a sábado 10:00–19:00, domingo cerrado. */
const CON_DIA_CERRADO: HorarioSemanal = horarioSemanalDesdeLegacy({
  dias: "1,2,3,4,5,6",
  abre: "10:00",
  cierra: "19:00",
});

/** Todos los días 11:00–19:00 (sin días cerrados). */
const TODA_LA_SEMANA: HorarioSemanal = horarioSemanalDesdeLegacy({
  dias: "1,2,3,4,5,6,7",
  abre: "11:00",
  cierra: "19:00",
});

describe("horarioLegible: el dato es relatable, la instrucción no se filtra", () => {
  const conCerrado = horarioLegible(CON_DIA_CERRADO);
  const todaLaSemana = horarioLegible(TODA_LA_SEMANA);

  it("conserva el dato: las horas y los días cerrados siguen ahí", () => {
    expect(conCerrado).toContain("lunes a sábado de 10:00 a 19:00");
    expect(conCerrado).toMatch(/domingo CERRADO/i);
    expect(todaLaSemana).toContain("de 11:00 a 19:00");
  });

  it("NO filtra la instrucción interna que el bot copió al cliente", () => {
    // La frase exacta que gpt-5-mini repitió al cliente.
    expect(conCerrado).not.toContain("di exactamente esto si te preguntan");
    expect(todaLaSemana).not.toContain("di exactamente esto si te preguntan");
    // Y la otra instrucción que iba pegada al listado de días cerrados.
    expect(conCerrado).not.toContain("no ofrezcas nada esos días");
  });

  it("no pega la instrucción como paréntesis detrás de la etiqueta", () => {
    // La causa raíz estructural: "HORARIO DEL NEGOCIO (imperativo...)". La
    // etiqueta debe ir seguida del DATO (":"), nunca de un paréntesis con una
    // orden que el modelo confunde con contenido.
    expect(conCerrado).toMatch(/HORARIO DEL NEGOCIO:/);
    expect(conCerrado).not.toMatch(/HORARIO DEL NEGOCIO\s*\(/);
  });

  it("conserva la guía, pero marcada como interna (para el asistente, no para el cliente)", () => {
    // No se pierde el guardarraíl: sigue diciéndole al modelo que diga las
    // horas tal cual y que no ofrezca en días cerrados. Solo que ahora está
    // separado del dato y marcado como algo que NO se le repite al cliente.
    expect(conCerrado).toMatch(/no se la repitas al cliente/i);
    expect(conCerrado).toMatch(/sin redondear/i);
    expect(conCerrado).toMatch(/CERRADO/);
  });
});
