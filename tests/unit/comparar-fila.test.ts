/**
 * La regla que sustituye a las listas de campos.
 *
 * El caso que la originó está el primero: una operación que dice tocar el
 * prompt y de paso revierte el horario. Con lista de campos, pasa; con fila
 * completa, aborta.
 */
import { describe, expect, it } from "vitest";
import { compararFila, explicar } from "@/server/ai/generador/comparar-fila";

const FILA = {
  id: "ap_1",
  organizationId: "org_1",
  instructions: "PROMPT",
  greeting: "hola",
  escalationRules: "escalar",
  enabled: true,
  appointmentsEnabled: false,
  hoursOpen: "09:30",
  hoursClose: "18:30",
  hoursDays: "1,2,3,4,5,6",
  ficha: '{"nombre":"Salón"}',
  catalogSource: "prompt",
  updatedAt: new Date("2026-08-15T00:00:00Z"),
};

describe("el incidente del 15-ago a las 19:46", () => {
  it("caza el horario revertido por una operación que decía tocar solo la ficha", () => {
    const despues = { ...FILA, ficha: '{"nombre":"Salón","x":1}', hoursOpen: "09:00", hoursClose: "20:00" };
    const c = compararFila(FILA, despues, ["ficha"]);
    expect(c.ok).toBe(false);
    expect(c.noDeclarados.map((d) => d.campo).sort()).toEqual(["hoursClose", "hoursOpen"]);
  });

  it("con la lista de campos de entonces, el mismo cambio pasaba desapercibido", () => {
    // Aquella prueba miraba estos cinco. El horario no estaba, y por eso pasó.
    const LOS_CINCO = ["instructions", "greeting", "escalationRules", "enabled", "appointmentsEnabled"];
    const despues = { ...FILA, hoursOpen: "09:00", hoursClose: "20:00" };
    const ninguno = LOS_CINCO.every((c) => FILA[c as keyof typeof FILA] === despues[c as keyof typeof despues]);
    expect(ninguno).toBe(true); // "todo correcto" decía la prueba vieja
    // Y la nueva lo caza:
    expect(compararFila(FILA, despues, []).ok).toBe(false);
  });
});

describe("comparación de fila completa", () => {
  it("deja pasar lo declarado", () => {
    const despues = { ...FILA, instructions: "PROMPT NUEVO", updatedAt: new Date() };
    const c = compararFila(FILA, despues, ["instructions", "updatedAt"]);
    expect(c.ok).toBe(true);
    expect(c.declarados.map((d) => d.campo).sort()).toEqual(["instructions", "updatedAt"]);
  });

  it("avisa de lo declarado que NO cambió: la operación no hizo lo que dijo", () => {
    const c = compararFila(FILA, { ...FILA }, ["instructions"]);
    expect(c.declaradosSinCambio).toEqual(["instructions"]);
  });

  it("una operación de solo lectura no puede cambiar ni updatedAt", () => {
    const despues = { ...FILA, updatedAt: new Date("2026-08-16T00:00:00Z") };
    expect(compararFila(FILA, despues, []).ok).toBe(false);
  });

  it("compara fechas por valor, no por referencia", () => {
    const despues = { ...FILA, updatedAt: new Date("2026-08-15T00:00:00Z") };
    expect(compararFila(FILA, despues, []).ok).toBe(true);
  });

  it("detecta un campo que aparece o desaparece", () => {
    const { catalogSource: _quitado, ...sinCampo } = FILA;
    expect(compararFila(FILA, sinCampo, []).ok).toBe(false);
    expect(compararFila(sinCampo, FILA, []).noDeclarados[0]?.campo).toBe("catalogSource");
  });

  it("explica el motivo del aborto de un vistazo", () => {
    const despues = { ...FILA, hoursOpen: "09:00" };
    const texto = explicar(compararFila(FILA, despues, []));
    expect(texto).toContain("hoursOpen CAMBIÓ SIN DECLARARSE");
    expect(texto).toContain("09:30");
  });
});
