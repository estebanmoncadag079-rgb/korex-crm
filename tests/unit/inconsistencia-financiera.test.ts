import { describe, expect, it } from "vitest";
import {
  correccionDeInconsistenciaFinanciera,
  dijoOtroValorDeDomicilio,
  inconsistenciaFinancieraDePedido,
} from "@/server/ai/anuncio-de-cierre";

/**
 * Fase 10N-J — detectores puros de la consistencia financiera del pedido.
 * El caso end-to-end contra el pipeline real vive en
 * `tests/unit/pipeline-domicilio.test.ts`; aquí se prueba cada pieza
 * aislada, incluida la prueba explícita de la invariante pedida:
 *
 *   total = subtotal + deliveryFee (+ cargos - descuentos, no
 *   implementados en este alcance porque el incidente real no los
 *   involucraba — ver el informe final).
 *
 * Y, por separado:
 *
 *   valor mostrado al cliente (dijoOtroValorDeDomicilio sobre `reply`)
 *   == valor guardado/verificado (zonaVerificada.feeCents)
 *   == valor usado para el total (subtotalCents + deliveryFeeCents == totalCents)
 *   == valor enviado a notify_order (deliveryFeeCents estructurado Y summary en prosa)
 */

describe("dijoOtroValorDeDomicilio", () => {
  it("detecta una cifra de domicilio distinta de la verificada, en cualquier orden (cifra antes o después de la palabra)", () => {
    expect(dijoOtroValorDeDomicilio("El domicilio a Kachipay es $8.000", 1200000)).toBe(true);
    expect(dijoOtroValorDeDomicilio("$8.000 de domicilio hasta allá", 1200000)).toBe(true);
  });

  it("NO dispara cuando la cifra coincide exactamente con la verificada", () => {
    expect(dijoOtroValorDeDomicilio("El domicilio a Kachipay es $12.000", 1200000)).toBe(false);
  });

  it("NO dispara si el texto no menciona domicilio/envío/transporte en absoluto", () => {
    expect(dijoOtroValorDeDomicilio("Tu Pavé cuesta $18.000", 1200000)).toBe(false);
  });

  it("domicilio gratis (0) también se detecta correctamente como inconsistente si el texto dice otra cosa", () => {
    expect(dijoOtroValorDeDomicilio("El domicilio son $5.000", 0)).toBe(true);
    expect(dijoOtroValorDeDomicilio("El domicilio es gratis, $0", 0)).toBe(false);
  });

  it("null/undefined nunca contradicen nada", () => {
    expect(dijoOtroValorDeDomicilio(null, 1200000)).toBe(false);
    expect(dijoOtroValorDeDomicilio(undefined, 1200000)).toBe(false);
  });
});

describe("inconsistenciaFinancieraDePedido — invariante total = subtotal + deliveryFee", () => {
  const ZONA_KACHIPAY = { feeCents: 1200000 };

  it("A/K: el caso feliz — subtotal + domicilio verificado = total, summary consistente → sin inconsistencia", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Domicilio a Kachipay: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
      zonaVerificada: ZONA_KACHIPAY,
    });
    expect(r).toBeNull();
  });

  it("13: la invariante aritmética — total distinto de subtotal+domicilio se detecta SIEMPRE, sin importar el summary", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Total: $26.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 2600000, // debería ser 3.000.000
      zonaVerificada: ZONA_KACHIPAY,
    });
    expect(r).toBe("total-no-cuadra");
  });

  it("reproduce el incidente EXACTO: deliveryFeeCents estructurado no coincide con la zona verificada este turno", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Domicilio: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 800000, // $8.000 — el número equivocado del incidente real
      totalCents: 2600000,
      zonaVerificada: ZONA_KACHIPAY, // consultar_domicilio verificó $12.000
    });
    expect(r).toBe("domicilio-no-verificado");
  });

  it("L: reproduce el incidente EXACTO en el summary — campos estructurados correctos, pero el TEXTO que le llega al equipo dice otra cifra", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Resumen: 1 Pavé $18.000. Domicilio: $8.000. Total: $26.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000, // estructurado correcto
      totalCents: 3000000, // estructurado correcto
      zonaVerificada: ZONA_KACHIPAY,
    });
    expect(r).toBe("resumen-contradice-tarifa");
  });

  it("domicilio-no-verificado: deliveryFeeCents no-nulo sin NINGUNA zona verificada este turno (aunque se haya verificado en un turno anterior)", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Domicilio: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
      zonaVerificada: null, // nada verificado en ESTE turno
    });
    expect(r).toBe("domicilio-no-verificado");
  });

  it("G: pedido sin domicilio (deliveryFeeCents null) — total = subtotal, sin inconsistencia", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Recoges en el local. Total: $18.000",
      subtotalCents: 1800000,
      deliveryFeeCents: null,
      totalCents: 1800000,
      zonaVerificada: null,
    });
    expect(r).toBeNull();
  });

  it("E: domicilio gratis (0) verificado — total = subtotal + 0, sin inconsistencia", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Domicilio gratis. Total: $18.000",
      subtotalCents: 1800000,
      deliveryFeeCents: 0,
      totalCents: 1800000,
      zonaVerificada: { feeCents: 0 },
    });
    expect(r).toBeNull();
  });

  it("sin campos estructurados (negocio con delivery_source='prompt', el comportamiento de siempre) — nunca dispara nada", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Cualquier resumen de texto libre, como siempre",
      zonaVerificada: null,
    });
    expect(r).toBeNull();
  });
});

describe("correccionDeInconsistenciaFinanciera", () => {
  it("da un mensaje de corrección distinto para cada tipo de fallo", () => {
    const a = correccionDeInconsistenciaFinanciera("total-no-cuadra");
    const b = correccionDeInconsistenciaFinanciera("domicilio-no-verificado");
    const c = correccionDeInconsistenciaFinanciera("resumen-contradice-tarifa");
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toMatch(/JSON/);
    expect(b).toMatch(/JSON/);
    expect(c).toMatch(/JSON/);
  });
});
