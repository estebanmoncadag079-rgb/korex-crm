import { describe, expect, it } from "vitest";

/**
 * 24-ago-2026. Caso real (Lis Pastelería, captura de WhatsApp): el cliente
 * preguntó "te puedo pagar por nequi?" y el agente respondió "Por ahora,
 * solo aceptamos pagos por transferencia bancaria" — leyendo la ausencia
 * literal de la palabra "Nequi" en su prompt como un rechazo, cuando pagar
 * por Nequi ES transferir. La causa: en el vertical de PEDIDOS, "formas de
 * pago" vivía como una frase suelta dentro de `instructions`, mezclada con
 * decenas de reglas de tono — a diferencia de CITAS, donde el pago ya se lee
 * fresco desde `ficha.pago` en cada turno (`pagoDeCitasParaElPrompt`,
 * docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md).
 *
 * `pagoDePedidosParaElPrompt` es la misma capacidad, llevada al vertical que
 * no la tenía. No inventa sinónimos que el negocio no declaró en
 * `pago.formas` — eso lo decide el dueño desde el CRM — pero sí prohíbe el
 * "no" categórico ante un método que el modelo no reconoce ahí.
 */

import { pagoDePedidosParaElPrompt } from "@/server/ai/prompts";

describe("pagoDePedidosParaElPrompt: la lista del negocio es la única fuente", () => {
  it("incluye las formas declaradas tal cual", () => {
    const texto = pagoDePedidosParaElPrompt({ formas: "SOLO transferencia" });
    expect(texto).toContain("SOLO transferencia");
    expect(texto).toContain("MÉTODOS DE PAGO ACEPTADOS");
  });

  it("incluye los datos de cuenta solo cuando vienen declarados", () => {
    const conDatos = pagoDePedidosParaElPrompt({
      formas: "Transferencia",
      datosDeCuenta: "Bancolombia 123456",
    });
    expect(conDatos).toContain("Bancolombia 123456");
    // Doc 200: por defecto se dan también si el cliente pregunta cómo pagar
    // (decisión del dueño, 9-sep-2026). "Solo después de confirmar" es ahora
    // una opción de la ficha (`cuentaAntesDeConfirmar: "nunca"`).
    expect(conDatos).toContain("antes si el cliente te pregunta cómo pagar");
    expect(
      pagoDePedidosParaElPrompt({
        formas: "Transferencia",
        datosDeCuenta: "Bancolombia 123456",
        cuentaAntesDeConfirmar: "nunca",
      })
    ).toContain("DESPUÉS de que confirme");

    const sinDatos = pagoDePedidosParaElPrompt({ formas: "Transferencia" });
    expect(sinDatos).not.toContain("undefined");
    expect(sinDatos).not.toContain("Datos para el pago");
  });

  /**
   * El caso Nequi exacto: la instrucción no puede saber que Nequi es
   * transferencia si el negocio no lo declaró así, pero sí puede evitar que
   * el modelo lo niegue de forma tajante — que es lo que perdió la venta.
   */
  it("prohíbe el rechazo categórico ante un método no nombrado en la lista", () => {
    const texto = pagoDePedidosParaElPrompt({ formas: "SOLO transferencia" });
    expect(texto).not.toContain("Nequi");
    expect(texto.toLowerCase()).toContain("no le digas que no se acepta");
    expect(texto.toLowerCase()).toContain("lo confirmas");
  });

  it("si el negocio SÍ declara los sinónimos, el modelo los recibe tal cual", () => {
    const texto = pagoDePedidosParaElPrompt({
      formas: "Transferencia bancaria (incluye Nequi, Daviplata y Bancolombia a la mano)",
    });
    expect(texto).toContain("Nequi");
    expect(texto).toContain("Daviplata");
  });
});
