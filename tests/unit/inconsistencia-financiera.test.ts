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
      puedeVerificarDomicilio: true,
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
      puedeVerificarDomicilio: true,
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
      puedeVerificarDomicilio: true,
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
      puedeVerificarDomicilio: true,
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
      puedeVerificarDomicilio: true,
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
      puedeVerificarDomicilio: true,
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
      puedeVerificarDomicilio: true,
    });
    expect(r).toBeNull();
  });

  it("sin campos estructurados (negocio con delivery_source='prompt', el comportamiento de siempre) — nunca dispara nada", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Cualquier resumen de texto libre, como siempre",
      zonaVerificada: null,
      puedeVerificarDomicilio: true,
    });
    expect(r).toBeNull();
  });

  /*
   * ============================================================
   * Fase 10V, Hallazgo B — bug real: los campos financieros se podían
   * omitir por completo en un pedido CON domicilio, y nada lo detectaba
   * porque todos los chequeos exigían que el campo YA existiera.
   * ============================================================
   */
  it("BUG REAL (Hallazgo B): domicilio en el summary, CERO campos estructurados, delivery_source='tabla' -> ya no pasa colado", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Domicilio: $12.000. Total: $30.000",
      // subtotalCents, deliveryFeeCents y totalCents NO vienen — el bypass exacto.
      zonaVerificada: null, // tampoco se reverificó este turno
      puedeVerificarDomicilio: true,
    });
    expect(r).toBe("domicilio-no-verificado");
  });

  it("Hallazgo C: el MISMO caso, pero delivery_source='prompt' -> pasa exactamente igual que antes (compatibilidad)", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Domicilio: $12.000. Total: $30.000",
      zonaVerificada: null,
      puedeVerificarDomicilio: false, // el negocio nunca tuvo delivery_zone
    });
    expect(r).toBeNull();
  });

  it("Hallazgo B: zonaVerificada este turno pero deliveryFeeCents OMITIDO (no solo mal) -> también se detecta", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Domicilio a Kachipay: $12.000. Total: $30.000",
      subtotalCents: 1800000,
      totalCents: 3000000,
      // deliveryFeeCents ausente, no null ni un número equivocado
      zonaVerificada: ZONA_KACHIPAY,
      puedeVerificarDomicilio: true,
    });
    expect(r).toBe("domicilio-no-verificado");
  });

  it("Hallazgo B: zonaVerificada este turno, deliveryFeeCents presente, pero subtotalCents/totalCents omitidos", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Domicilio a Kachipay: $12.000",
      deliveryFeeCents: 1200000,
      // subtotalCents y totalCents ausentes
      zonaVerificada: ZONA_KACHIPAY,
      puedeVerificarDomicilio: true,
    });
    expect(r).toBe("total-no-cuadra");
  });

  it("compatibilidad: sin ninguna mención de domicilio y sin ningún campo -> nunca exige nada, incluso en modo 'tabla'", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Recoges en el local. Total: $18.000",
      subtotalCents: 1800000,
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: true,
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

  it("Fase 11-C: los 3 motivos nuevos también dan mensajes de corrección distintos", () => {
    const a = correccionDeInconsistenciaFinanciera("subtotal-no-verificado");
    const b = correccionDeInconsistenciaFinanciera("subtotal-no-coincide-con-el-carrito");
    const c = correccionDeInconsistenciaFinanciera("resumen-contradice-total-real");
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toMatch(/JSON/);
    expect(b).toMatch(/JSON/);
    expect(c).toMatch(/JSON/);
  });
});

/**
 * Fase 11-C — dinero calculado por backend. `subtotalReal` es el subtotal
 * que YA calculó `normalizarPedido` contra el catálogo real
 * (`conversation_state.estado.totalCents`) — presente SOLO cuando la
 * organización tiene `state_source='backend'` y el carrito está resuelto
 * (ver el comentario del parámetro en `anuncio-de-cierre.ts`). Ausente
 * (`undefined`) para el resto — los 4 clientes reales hoy, en `'prompt'`
 * — donde el backend NO pretende saber un subtotal que no tiene de dónde
 * sacar: ahí el comportamiento es exactamente el de antes (probado en el
 * resto de este archivo, sin ningún `subtotalReal`).
 */
describe("inconsistenciaFinancieraDePedido — Fase 11-C: subtotal calculado por el backend", () => {
  it("1/2: productos y cantidades reales -> el subtotal correcto (calculado por el backend) se acepta sin fricción", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas — $20.000. Total: $20.000",
      subtotalCents: 2000000,
      totalCents: 2000000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 2000000,
    });
    expect(r).toBeNull();
  });

  it("3/4: domicilio + subtotal real -> el total correcto (subtotal real + tarifa verificada) se acepta", () => {
    const ZONA = { feeCents: 1200000 };
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas — $20.000. Domicilio: $12.000. Total: $32.000",
      subtotalCents: 2000000,
      deliveryFeeCents: 1200000,
      totalCents: 3200000,
      zonaVerificada: ZONA,
      puedeVerificarDomicilio: true,
      subtotalReal: 2000000,
    });
    expect(r).toBeNull();
  });

  it("5/6: el LLM propone un subtotal INCORRECTO (no coincide con el carrito real) -> se rechaza, nunca sale así", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas — $18.000. Total: $18.000",
      subtotalCents: 1800000, // el LLM se equivocó sumando
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 2000000, // el backend YA sabe que son $20.000
    });
    expect(r).toBe("subtotal-no-coincide-con-el-carrito");
  });

  it("6b: subtotalCents ausente pero el backend SÍ conoce el subtotal real -> se exige, no se omite en silencio", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas confirmadas.",
      totalCents: 2000000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 2000000,
    });
    expect(r).toBe("subtotal-no-verificado");
  });

  it("2/CRITICAL: aritméticamente correcto pero financieramente incorrecto — el escenario exacto del encargo (subtotal=25.000, domicilio=12.000, total=37.000 cuadra solo, pero el carrito real es 30.000)", () => {
    const ZONA = { feeCents: 1200000 };
    const r = inconsistenciaFinancieraDePedido({
      summary: "Pedido — Domicilio: $12.000. Total: $37.000",
      subtotalCents: 2500000,
      deliveryFeeCents: 1200000,
      totalCents: 3700000, // 25.000 + 12.000 = 37.000: cuadra internamente
      zonaVerificada: ZONA,
      puedeVerificarDomicilio: true,
      subtotalReal: 3000000, // pero el catálogo real dice $30.000
    });
    // "aritméticamente correcto" (25.000+12.000=37.000) NO equivale a
    // "financieramente correcto" (el carrito real vale 30.000): debe
    // rechazarse por el subtotal, no colarse porque la suma cuadra.
    expect(r).toBe("subtotal-no-coincide-con-el-carrito");
  });

  it("7: cambio de tarifa de domicilio -> el subtotal sigue siendo válido, solo se exige la tarifa NUEVA", () => {
    const ZONA_NUEVA = { feeCents: 500000 };
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas — $20.000. Domicilio: $5.000. Total: $25.000",
      subtotalCents: 2000000,
      deliveryFeeCents: 500000,
      totalCents: 2500000,
      zonaVerificada: ZONA_NUEVA,
      puedeVerificarDomicilio: true,
      subtotalReal: 2000000,
    });
    expect(r).toBeNull();
  });

  it("8: pedido SIN domicilio (recogida), con subtotal real -> se exige el subtotal igual, pero nunca exige domicilio", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas — $20.000. Recoges en el local.",
      subtotalCents: 2000000,
      totalCents: 2000000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 2000000,
    });
    expect(r).toBeNull();
  });

  it("9/legacy: sin `subtotalReal` (modo 'prompt', los 4 clientes reales hoy) -> el chequeo nuevo NUNCA se activa, comportamiento idéntico al de antes", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas — $18.000 (el LLM las sumó mal, nadie puede saberlo sin carrito real). Total: $18.000",
      subtotalCents: 1800000,
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      // subtotalReal: undefined (ausente) — el negocio no tiene carrito estructurado
    });
    expect(r).toBeNull();
  });

  it("11: el resumen en TEXTO contradice el total real, aunque los campos estructurados falten -> se detecta igual (defensa de regex, no la única)", () => {
    const ZONA = { feeCents: 1200000 };
    const r = inconsistenciaFinancieraDePedido({
      summary: "Domicilio: $12.000. Total: $28.000", // el texto dice 28.000
      // sin subtotalCents/totalCents estructurados
      zonaVerificada: ZONA,
      puedeVerificarDomicilio: true,
      subtotalReal: 2000000, // el total real es 20.000+12.000 = 32.000
    });
    // Sin subtotalCents, ya se rechaza antes de llegar al chequeo de texto.
    expect(r).toBe("subtotal-no-verificado");
  });

  it("11b: campos estructurados perfectos, pero el TEXTO del resumen dice un total distinto -> se detecta (defensa adicional, no solo aritmética)", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "2 Churritas. Total: $99.000", // el texto miente sobre el total real
      subtotalCents: 2000000,
      totalCents: 2000000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 2000000,
    });
    expect(r).toBe("resumen-contradice-total-real");
  });
});
