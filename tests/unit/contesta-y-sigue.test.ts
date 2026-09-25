import { describe, expect, it } from "vitest";
import { contestaYSigue, conTextoCorregido } from "@/server/ai/pipeline";

/**
 * Medido con el modelo real (MALIA, 25-sep-2026): el mensaje con el que el bot
 * contesta a mitad del pedido no siempre es un `reply`. Cuando el cliente da un
 * dato, sale como `provide_requirement` (registra el dato Y contesta con
 * `reply`). Los guardarraíles que solo miraban `reply` no veían esos mensajes:
 * "Ahora te preparo el resumen" (el Bug 5, ya corregido para `reply`) volvió a
 * salir por esa puerta, y la verificación del domicilio no se disparaba justo
 * en el turno en que la clienta dio su dirección.
 */
describe("contestaYSigue", () => {
  it("reply, provide_requirement y update_lead contestan y siguen la conversación", () => {
    expect(contestaYSigue({ action: "reply", text: "hola" })).toBe(true);
    expect(
      contestaYSigue({ action: "provide_requirement", requisitoId: "telefono", valor: "3145602573", reply: "listo" })
    ).toBe(true);
    expect(contestaYSigue({ action: "update_lead", note: "x", reply: "listo" })).toBe(true);
  });

  it("un cierre o una derivación no", () => {
    expect(contestaYSigue({ action: "notify_order", summary: "pedido" })).toBe(false);
    expect(contestaYSigue({ action: "handoff", reason: "x" })).toBe(false);
  });
});

describe("conTextoCorregido: corrige el TEXTO sin perder lo que la acción registra", () => {
  it("una acción que registra un dato conserva su registro y toma el texto nuevo", () => {
    const original = {
      action: "provide_requirement" as const,
      requisitoId: "telefono",
      valor: "3145602573",
      reply: "Ahora te preparo el resumen",
    };
    expect(conTextoCorregido(original, { action: "reply", text: "Resumen… Total: $30.000" })).toEqual({
      ...original,
      reply: "Resumen… Total: $30.000",
    });
  });

  it("si la corrección es otra acción completa, gana la corrección", () => {
    const corregida = { action: "notify_order" as const, summary: "pedido" };
    expect(conTextoCorregido({ action: "reply", text: "x" }, corregida)).toEqual(corregida);
  });

  it("un reply se reemplaza por el reply corregido", () => {
    expect(conTextoCorregido({ action: "reply", text: "x" }, { action: "reply", text: "y" })).toEqual({
      action: "reply",
      text: "y",
    });
  });
});
