import { describe, expect, it } from "vitest";
import { textoDePoliticaDePago } from "@/server/pagos/politica";

/**
 * El backend NO da veredicto sobre una forma de pago escrita en texto libre
 * (doc 198, decisión del dueño 25-sep-2026). Le devuelve al modelo la política
 * LITERAL del negocio y la modalidad del pedido si el estado la tiene, y el
 * modelo —que sí entiende condiciones como "solo recogiendo"— la aplica.
 *
 * Casos reales que lo exigieron:
 * - MALIA/Sofía: "¿te puedo pagar en efectivo cuando llegue el domicilio?" →
 *   el backend dijo "SÍ… confírmalo con seguridad" y el bot aprobó efectivo
 *   contra entrega. La ficha: "efectivo pero solo recogiendo en planta".
 * - Lis: "No se recibe efectivo" → el verificador anterior lo daba por permitido.
 */
const MALIA = "Transferencia y efectivo pero solo recogiendo en planta, para los domicilios solo recibimos transferencia";
const LIS = "Transferencia bancaria — incluye Bancolombia, Nequi y pago por llave. No se recibe efectivo (los domicilios van por Yango).";

describe("textoDePoliticaDePago: la política literal, sin veredicto del backend", () => {
  it("lleva la política literal del negocio", () => {
    const t = textoDePoliticaDePago({ formas: MALIA, metodo: "efectivo", modalidadDeEntrega: "domicilio" });
    expect(t).toContain(MALIA);
  });

  it("nunca afirma que SÍ ni que NO está permitido, ni ordena confirmarlo 'con seguridad'", () => {
    for (const formas of [MALIA, LIS]) {
      const t = textoDePoliticaDePago({ formas, metodo: "efectivo cuando llegue el domicilio", modalidadDeEntrega: null });
      expect(t).not.toMatch(/SÍ está entre/i);
      expect(t).not.toMatch(/NO está entre/i);
      expect(t).not.toMatch(/con seguridad/i);
    }
  });

  it("si el estado sabe la modalidad, se la dice (es un dato estructurado del pedido)", () => {
    const t = textoDePoliticaDePago({ formas: MALIA, metodo: "efectivo", modalidadDeEntrega: "domicilio" });
    expect(t).toMatch(/este pedido es a domicilio/i);
  });

  it("sin modalidad conocida, pide aplicar la política según cómo reciba el pedido", () => {
    const t = textoDePoliticaDePago({ formas: MALIA, metodo: "efectivo", modalidadDeEntrega: null });
    expect(t).not.toMatch(/este pedido es a/i);
    expect(t).toMatch(/condici/i);
  });

  it("sin formas de pago declaradas, no inventa: lo confirma el equipo", () => {
    const t = textoDePoliticaDePago({ formas: "", metodo: "efectivo", modalidadDeEntrega: null });
    expect(t).toMatch(/equipo/i);
  });
});
