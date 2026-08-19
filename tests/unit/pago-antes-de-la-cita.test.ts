import { describe, expect, it } from "vitest";

/**
 * 19-ago-2026 (docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md). Caso real: Lashes
 * Valen no cobra por adelantado, y el agente pedía NEQUI + comprobante "para
 * dejar la cita en firme" en el mismo mensaje de confirmación, sin que la
 * clienta lo preguntara. La causa: `CIERRE_CITAS` dejaba la condición
 * abierta ("si el negocio cobra algo por adelantado, dilo") y el modelo la
 * resolvía solo con que hubiera datos de pago en su conocimiento — que casi
 * cualquier negocio tiene, cobre antes o no.
 *
 * `pagoAntesDeLaCitaDe` es la única lectura del dato; `pagoDeCitasParaElPrompt`
 * es la única redacción — las dos deciden por el servidor, nunca por el
 * modelo.
 */

import { pagoAntesDeLaCitaDe, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { pagoDeCitasParaElPrompt } from "@/server/ai/prompts";

function ficha(cierre?: FichaDelNegocio["cierre"]): FichaDelNegocio {
  return {
    nombre: "Cualquiera",
    vertical: "citas",
    queVende: "algo",
    tono: "cercano",
    horario: { abre: "9:00 AM", cierra: "6:00 PM", dias: [1, 2, 3] },
    pago: { formas: "NEQUI", datosDeCuenta: "NEQUI-123", compruebaUnaPersona: true },
    cierre,
  } as FichaDelNegocio;
}

describe("pagoAntesDeLaCitaDe: no declarado es lo mismo que no cobrar antes", () => {
  it("sin ficha.cierre, es false (el caso real de Lashes Valen antes del fix)", () => {
    expect(pagoAntesDeLaCitaDe(ficha(undefined))).toBe(false);
  });

  it("con cierre.requisitos pero sin declarar el pago, sigue siendo false", () => {
    expect(pagoAntesDeLaCitaDe(ficha({ requisitos: [] }))).toBe(false);
  });

  it("declarado explícitamente en false, es false", () => {
    expect(pagoAntesDeLaCitaDe(ficha({ requisitos: [], pagoAntesDeLaCita: false }))).toBe(false);
  });

  it("solo `true` explícito lo enciende", () => {
    expect(pagoAntesDeLaCitaDe(ficha({ requisitos: [], pagoAntesDeLaCita: true }))).toBe(true);
  });
});

describe("pagoDeCitasParaElPrompt: la instrucción es categórica en los dos sentidos", () => {
  it("si no cobra antes, prohíbe mencionar pago o comprobante al confirmar", () => {
    const texto = pagoDeCitasParaElPrompt(
      { formas: "NEQUI", datosDeCuenta: "NEQUI-123" },
      false
    );
    expect(texto).toContain("NO pide pago por adelantado");
    expect(texto).toContain("NO");
    expect(texto).not.toContain("NEQUI-123");
  });

  it("si cobra antes, incluye la forma y los datos reales de la cuenta", () => {
    const texto = pagoDeCitasParaElPrompt(
      { formas: "NEQUI", datosDeCuenta: "NEQUI-123" },
      true
    );
    expect(texto).toContain("SÍ pide el pago por adelantado");
    expect(texto).toContain("NEQUI");
    expect(texto).toContain("NEQUI-123");
    expect(texto).toContain("comprobante");
  });

  it("si cobra antes mal declarado sin datos de pago, no revienta y da un texto genérico", () => {
    const texto = pagoDeCitasParaElPrompt(undefined, true);
    expect(texto).toContain("SÍ pide el pago por adelantado");
    expect(texto).not.toContain("undefined");
  });
});
