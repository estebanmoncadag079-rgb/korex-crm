import { describe, expect, it } from "vitest";

/**
 * El celular que teclea el salón al agendar a mano.
 *
 * Importa más de lo que parece: es lo que une la cita con la conversación de
 * WhatsApp de esa clienta. Si se guarda con otro formato, la cita queda
 * colgada de un contacto distinto — el agente no sabría que ya tiene cita y
 * el botón de recordar le escribiría a nadie.
 *
 * En un salón lo van a teclear como les salga: con espacios, con +57, con
 * guiones o los 10 dígitos pelados.
 */

import { normalizarTelefonoCo } from "@/lib/utils";

describe("el celular de una cita agendada a mano", () => {
  it("acepta las formas en que un colombiano escribe su número", () => {
    for (const entrada of [
      "3001234567",
      "300 123 4567",
      "300-123-4567",
      "+57 300 123 4567",
      "573001234567",
      "(300) 1234567",
    ]) {
      expect(normalizarTelefonoCo(entrada), entrada).toBe("573001234567");
    }
  });

  it("rechaza lo que no puede ser un teléfono", () => {
    for (const entrada of ["", "123", "abc", "300123"]) {
      expect(normalizarTelefonoCo(entrada), entrada).toBeNull();
    }
  });

  it("deja pasar un número de otro país sin romperlo", () => {
    expect(normalizarTelefonoCo("+1 305 555 1234")).toBe("13055551234");
  });
});
