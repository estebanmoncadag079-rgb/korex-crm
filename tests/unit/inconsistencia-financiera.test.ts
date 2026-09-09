import { describe, expect, it } from "vitest";
import {
  correccionDeInconsistenciaFinanciera,
  dijoOtroValorDeDomicilio,
  inconsistenciaFinancieraDePedido,
  cifrasEnPesosDelTexto,
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

  it("Fase 8D: los motivos de farewell dan mensajes distintos entre sí y de sus equivalentes de summary, y mencionan \"farewell\"", () => {
    const a = correccionDeInconsistenciaFinanciera("despedida-contradice-tarifa");
    const b = correccionDeInconsistenciaFinanciera("despedida-contradice-total-real");
    const c = correccionDeInconsistenciaFinanciera("resumen-contradice-tarifa");
    const d = correccionDeInconsistenciaFinanciera("resumen-contradice-total-real");
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(a).toMatch(/farewell/);
    expect(b).toMatch(/farewell/);
    expect(a).toMatch(/JSON/);
    expect(b).toMatch(/JSON/);
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

/**
 * Fase 8F — incidente REAL de producción (8-sep-2026, 14:44, MALIA,
 * conversación cv_en2sl2o4mt1ebqbxrj9l). Configuración real de esa
 * organización, verificada en la base: `state_source='backend'` (el backend
 * SÍ conoce el subtotal del carrito) + `delivery_source='prompt'` con CERO
 * filas en `delivery_zone` (el backend NO puede conocer la tarifa de
 * domicilio: vive en prosa en la ficha, por diseño).
 *
 * El carrito real tenía 1 × Pavé Cremoso 16 oz = $18.000. El resumen decía
 * "Total: $26.000" — correcto: $18.000 + $8.000 de domicilio. El chequeo
 * comparaba contra `subtotalReal + (zonaEfectiva ?? 0)` = $18.000 y marcaba
 * contradicción; el reintento repetía el total correcto (porque lo era) y
 * el turno terminaba derivado a una persona con la clienta ya habiendo
 * escrito "Correcto". Todo pedido a domicilio de un negocio en esa
 * combinación fallaba igual.
 */
describe("inconsistenciaFinancieraDePedido — Fase 8F: total real con domicilio que el backend no puede conocer", () => {
  it("BUG REAL: subtotal conocido + domicilio en prosa (sin zonas) -> el total del resumen NO se marca como contradicción", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary:
        "1 × Pavé Cremoso 16 oz (Sabor: Fresas con crema) — $18.000. Domicilio: $8.000. Total: $26.000",
      subtotalCents: 1800000,
      totalCents: 2600000,
      deliveryFeeCents: 800000,
      zonaVerificada: null, // delivery_source='prompt': no hay zona que verificar
      puedeVerificarDomicilio: false, // cero filas en delivery_zone
      subtotalReal: 1800000, // state_source='backend': el subtotal SÍ se conoce
    });
    expect(r).toBeNull();
  });

  it("el subtotal estructurado se sigue verificando SIEMPRE, con domicilio o sin él", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 × Pavé Cremoso 16 oz — $25.000. Domicilio: $8.000. Total: $33.000",
      subtotalCents: 2500000, // el modelo se inventó el subtotal
      totalCents: 3300000,
      deliveryFeeCents: 800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 1800000, // el carrito real dice $18.000
    });
    expect(r).toBe("subtotal-no-coincide-con-el-carrito");
  });

  it("sin domicilio en juego, el total del resumen se sigue comparando igual que antes", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 × Pavé Cremoso 16 oz — $18.000. Recoges en el local. Total: $99.000",
      subtotalCents: 1800000,
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 1800000,
    });
    expect(r).toBe("resumen-contradice-total-real");
  });

  it("con zona VERIFICADA (delivery_source='tabla') el total sí se compara, incluyendo el domicilio", () => {
    const ZONA = { feeCents: 800000 };
    // Correcto: 18.000 + 8.000 = 26.000
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "Pavé — $18.000. Domicilio: $8.000. Total: $26.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
        zonaVerificada: ZONA,
        puedeVerificarDomicilio: true,
        subtotalReal: 1800000,
      })
    ).toBeNull();
    // Incorrecto: el resumen dice otro total del que sale de datos reales.
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "Pavé — $18.000. Domicilio: $8.000. Total: $30.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
        zonaVerificada: ZONA,
        puedeVerificarDomicilio: true,
        subtotalReal: 1800000,
      })
    ).toBe("resumen-contradice-total-real");
  });

  it("farewell (Fase 8D) hereda el mismo candado: con domicilio no verificable, no se marca", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "Pavé — $18.000. Domicilio: $8.000. Total: $26.000",
      farewell: "¡Gracias! Tu pedido queda por un total de $26.000 💕",
      subtotalCents: 1800000,
      totalCents: 2600000,
      deliveryFeeCents: 800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 1800000,
    });
    expect(r).toBeNull();
  });
});

/**
 * Fase 8D — auditoría de Fase 8D: `summary` (lo que ve el EQUIPO) ya se
 * verificaba; `farewell` (lo que de verdad lee el CLIENTE, ver
 * `conducta.ts`: "dale los datos de pago tal cual están escritos") no
 * pasaba por ningún chequeo — un `summary` perfecto no garantizaba que
 * `farewell` dijera la misma cifra. Casos 1-6 del encargo de la Fase 8D.
 */
describe("inconsistenciaFinancieraDePedido — Fase 8D: fidelidad de farewell", () => {
  const ZONA_KACHIPAY = { feeCents: 1200000 };

  it("1: farewell correcto (misma tarifa y mismo total real) -> pasa", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Domicilio a Kachipay: $12.000. Total: $30.000",
      farewell: "¡Gracias! Tu pedido con domicilio de $12.000, total $30.000, va en camino.",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
      zonaVerificada: ZONA_KACHIPAY,
      puedeVerificarDomicilio: true,
    });
    expect(r).toBeNull();
  });

  it("2: summary correcto + farewell con el TOTAL incorrecto -> detecta (el ejemplo exacto de la auditoría de Fase 8D)", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Total: $18.000",
      farewell: "¡Gracias, Juan! Tu pedido queda confirmado por un total de $450.000 🎉", // cifra inventada, no tiene relación con el pedido real
      subtotalCents: 1800000,
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 1800000,
    });
    expect(r).toBe("despedida-contradice-total-real");
  });

  it("2b: summary correcto + farewell con la TARIFA DE DOMICILIO incorrecta -> detecta", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Domicilio a Kachipay: $12.000. Total: $30.000",
      farewell: "¡Gracias! El domicilio son $8.000, en camino tu pedido.", // $8.000, no los $12.000 verificados
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
      zonaVerificada: ZONA_KACHIPAY,
      puedeVerificarDomicilio: true,
    });
    expect(r).toBe("despedida-contradice-tarifa");
  });

  it("3: farewell sin ninguna cifra -> pasa, sin falso positivo", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Total: $18.000",
      farewell: "¡Gracias! Ya estamos preparando tu pedido con mucho cariño 💗",
      subtotalCents: 1800000,
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 1800000,
    });
    expect(r).toBeNull();
  });

  it("4: farewell undefined (el ejecutor solo lo entrega si viene, ver pipeline.ts) -> pasa, no se exige", () => {
    const r = inconsistenciaFinancieraDePedido({
      summary: "1 Pavé — $18.000. Total: $18.000",
      // farewell ausente
      subtotalCents: 1800000,
      totalCents: 1800000,
      zonaVerificada: null,
      puedeVerificarDomicilio: false,
      subtotalReal: 1800000,
    });
    expect(r).toBeNull();
  });

  it("6: dos organizaciones con cifras reales DISTINTAS -> cada llamada se valida solo contra sus propios datos, sin mezclarse", () => {
    // Organización A: total real $30.000; farewell correcto para A.
    const rA = inconsistenciaFinancieraDePedido({
      summary: "Pedido A. Domicilio: $12.000. Total: $30.000",
      farewell: "¡Gracias! Domicilio $12.000, total $30.000.",
      subtotalCents: 1800000,
      deliveryFeeCents: 1200000,
      totalCents: 3000000,
      zonaVerificada: ZONA_KACHIPAY,
      puedeVerificarDomicilio: true,
    });
    expect(rA).toBeNull();

    // Organización B: cifras reales completamente distintas; farewell
    // correcto para B (y coincide, por casualidad, con parte de lo que se
    // usó en A — no debe importar, cada llamada es independiente).
    const ZONA_B = { feeCents: 500000 };
    const rB = inconsistenciaFinancieraDePedido({
      summary: "Pedido B. Domicilio: $5.000. Total: $25.000",
      farewell: "¡Gracias! Domicilio $5.000, total $25.000.",
      subtotalCents: 2000000,
      deliveryFeeCents: 500000,
      totalCents: 2500000,
      zonaVerificada: ZONA_B,
      puedeVerificarDomicilio: true,
    });
    expect(rB).toBeNull();

    // Si el farewell de B se validara por error contra la zona/tarifa de A
    // (mezcla entre organizaciones), esto SÍ debería marcarse -- se prueba
    // aparte para dejar la contaminación cruzada evidente si algún día
    // ocurriera.
    const rBConTarifaDeA = inconsistenciaFinancieraDePedido({
      summary: "Pedido B. Domicilio: $5.000. Total: $25.000",
      farewell: "¡Gracias! Domicilio $5.000, total $25.000.",
      subtotalCents: 2000000,
      deliveryFeeCents: 500000,
      totalCents: 2500000,
      zonaVerificada: ZONA_KACHIPAY, // la tarifa de A, por error
      puedeVerificarDomicilio: true,
    });
    expect(rBConTarifaDeA).toBe("domicilio-no-verificado");
  });
});

/**
 * Incidentes reales, dos en dos días (MALIA, 8 y 9-sep-2026). El mismo patrón,
 * y el segundo con el cliente **ya pagado**:
 *
 *     11:39  persona → "Holaa, buenas tardes! Serían 26.000"
 *     11:40  persona → "Con el domicilio incluido"
 *     11:41  bot     → "Con el domicilio incluido el total es de $26.000"
 *     11:41  cliente → [COMPROBANTE] $26.000
 *     11:42  bot     → "Te comunico con una persona del equipo"
 *
 * El equipo cotiza a mano —101 mensajes suyos contra 273 del bot en seis
 * horas— y cuando lo hacen no pasan por la tabla de zonas. Nadie mencionó un
 * barrio, así que no había ninguna zona que verificar, y el candado se cerraba
 * sobre un total que el modelo no inventó: lo copió de una persona, que es
 * justo lo que el prompt le ordena hacer.
 *
 * La excepción no se cree lo que dice el modelo: los totales vienen de las
 * FILAS de `message` escritas por una persona (`ai_generated=false`).
 */
describe("un total que ya dio una persona del negocio", () => {
  const base = {
    summary: "1 Pavé Cremoso 16 oz — $18.000\nDomicilio: $8.000\nTotal: $26.000",
    subtotalCents: 1800000,
    deliveryFeeCents: 800000,
    totalCents: 2600000,
    zonaVerificada: null,
    puedeVerificarDomicilio: true,
  };

  it("EL INCIDENTE: sin la excepción, deriva a un cliente que ya pagó", () => {
    expect(inconsistenciaFinancieraDePedido(base)).toBe("domicilio-no-verificado");
  });

  it("con el total dicho por una persona, el pedido se cierra", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...base,
        totalesDichosPorUnaPersona: [2600000],
      })
    ).toBeNull();
  });

  it("otro total distinto NO sirve de coartada", () => {
    // La persona dijo $30.000 y el modelo cierra en $26.000: eso no lo
    // respalda nadie, y el candado tiene que seguir cerrado.
    expect(
      inconsistenciaFinancieraDePedido({
        ...base,
        totalesDichosPorUnaPersona: [3000000],
      })
    ).toBe("domicilio-no-verificado");
  });

  it("con la zona SÍ verificada, la excepción no hace falta ni cambia nada", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...base,
        zonaVerificada: { feeCents: 800000 },
      })
    ).toBeNull();
  });

  it("la excepción NO tapa un total que no cuadra con su propia suma", () => {
    // 18.000 + 8.000 no son 30.000. Que una persona haya dicho 30.000 no
    // convierte una suma mala en buena: ese es otro candado y sigue cerrado.
    expect(
      inconsistenciaFinancieraDePedido({
        ...base,
        totalCents: 3000000,
        totalesDichosPorUnaPersona: [3000000],
      })
    ).toBe("total-no-cuadra");
  });
});

describe("cifrasEnPesosDelTexto", () => {
  it("saca los totales como los escribe una persona de verdad", () => {
    expect(cifrasEnPesosDelTexto("Holaa, buenas tardes ! Serían 26.000")).toEqual([2600000]);
    expect(cifrasEnPesosDelTexto("Serían 40.000 en total con domi")).toEqual([4000000]);
    expect(cifrasEnPesosDelTexto("son $12.000 el domicilio")).toEqual([1200000]);
  });

  it("no confunde una hora, una cantidad ni un texto sin cifras", () => {
    expect(cifrasEnPesosDelTexto("llega entre 20 a 40min")).toEqual([]);
    expect(cifrasEnPesosDelTexto("son 3 pavés")).toEqual([]);
    expect(cifrasEnPesosDelTexto("Gracias por tu pago")).toEqual([]);
    expect(cifrasEnPesosDelTexto(null)).toEqual([]);
  });

  it("varias cifras en un mensaje salen todas, sin repetir", () => {
    expect(cifrasEnPesosDelTexto("18.000 más 8.000 son 26.000, o sea 26.000")).toEqual([
      1800000, 800000, 2600000,
    ]);
  });
});

/**
 * Incidente real (MALIA, 9-sep-2026, 16:42): un pedido de $64.000 derivado por
 * un falso positivo del detector de texto.
 *
 * El resumen terminaba con el párrafo fijo del negocio, que no lleva ninguna
 * cifra:
 *
 *     💰 *Total:* $64.000
 *
 *     🛵 *El domicilio tiene un valor adicional, el cliente lo cubre...*
 *
 * El detector no encontraba nada después de "domicilio", miraba hacia atrás,
 * cruzaba el salto de línea y agarraba el $64.000 del total — concluyendo que
 * el resumen decía que el domicilio costaba $64.000 y contradecía la tarifa
 * verificada de $10.000.
 *
 * Todo lo demás estaba bien: la zona resuelta ("Ciudad Córdoba" → found), la
 * suma cuadrada (54.000 + 10.000 = 64.000) y la tarifa correcta. La clienta
 * respondió "Sí correcto" y se llevó una derivación.
 */
describe("el párrafo fijo del negocio no es una tarifa", () => {
  const RESUMEN_REAL = `📋 *Resumen del pedido:*
• 1 × Pavé Cremoso 16 oz — $18.000
• 1 × Pavé Cremoso 16 oz — $18.000
• 1 × Pavé Cremoso 16 oz — $18.000

📍 *Entrega:* Domicilio a Cl 54c #47-24, Ciudad Córdoba
🛵 *Domicilio:* $10.000

💰 *Total:* $64.000

🛵 *El domicilio tiene un valor adicional, el cliente lo cubre y debe pagarlo junto con todo el pedido antes de despachar el pedido.*`;

  const cierre = {
    subtotalCents: 5400000,
    deliveryFeeCents: 1000000,
    totalCents: 6400000,
    zonaVerificada: { feeCents: 1000000 },
    puedeVerificarDomicilio: true,
  };

  it("EL INCIDENTE: el resumen real ya no se lee como contradicción", () => {
    expect(inconsistenciaFinancieraDePedido({ ...cierre, summary: RESUMEN_REAL })).toBeNull();
  });

  it("una contradicción DE VERDAD en la misma línea sigue saltando", () => {
    // Lo que el detector existe para cazar: el texto dice una tarifa distinta
    // de la verificada. Eso no puede dejar de detectarse.
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierre,
        summary: RESUMEN_REAL.replace("*Domicilio:* $10.000", "*Domicilio:* $25.000"),
      })
    ).toBe("resumen-contradice-tarifa");
  });

  it('"$8.000 de domicilio" —la cifra ANTES, misma línea— se sigue leyendo', () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierre,
        summary: "Son $8.000 de domicilio para tu pedido.",
      })
    ).toBe("resumen-contradice-tarifa");
  });

  it("y la despedida al cliente se protege igual", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierre,
        summary: RESUMEN_REAL,
        farewell: `¡Gracias!\n\nEl domicilio tiene un valor adicional que cubre el cliente.\n\nTotal: $64.000`,
      })
    ).toBeNull();
  });
});

/**
 * Incidente real (MALIA, 9-sep-2026, 18:03). La clienta pidió cambiar un
 * sabor, se arrepintió —"déjame el pedido así tal cual"— y el modelo rehizo el
 * resumen desde cero:
 *
 *     17:55  • Domicilio: $10.000  · **Total: $44.000**
 *     18:02  • **Total productos: $34.000**      ← el domicilio desapareció
 *
 * El pedido se cerró sin cobrar el domicilio y NINGÚN guardarraíl saltó: todos
 * comprobaban que la cifra fuera la CORRECTA, ninguno que estuviera. La zona
 * se había verificado en el primer turno ("Carrera 13 #72-08, Barrio Siete de
 * Agosto" → found) y seguía viva gracias a `conEntregaConservada`.
 *
 * Es la otra mitad del mismo problema: una cosa es que el bot MIENTA sobre la
 * tarifa, y otra que la BORRE. La segunda no se veía.
 */
describe("el domicilio verificado no se puede dejar de cobrar", () => {
  const conDomicilioPersistido = {
    summary: "• 3 × Pavé Cremoso 8 oz — $34.000\n\n💰 *Total productos:* $34.000",
    subtotalCents: 3400000,
    totalCents: 3400000,
    zonaVerificada: null,
    entregaPersistida: { tipo: "domicilio" as const, feeCents: 1000000 },
    modalidadDeEntrega: "domicilio",
    puedeVerificarDomicilio: true,
  };

  it("EL INCIDENTE: cierra sin cobrar un domicilio ya verificado", () => {
    expect(inconsistenciaFinancieraDePedido(conDomicilioPersistido)).toBe("domicilio-omitido");
  });

  it("cobrándolo, pasa limpio", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...conDomicilioPersistido,
        summary: "• 3 × Pavé Cremoso 8 oz — $34.000\n🛵 *Domicilio:* $10.000\n\n💰 *Total:* $44.000",
        deliveryFeeCents: 1000000,
        totalCents: 4400000,
      })
    ).toBeNull();
  });

  it("si el cliente pasó a RECOGIDA, no se le cobra nada y está bien", () => {
    // `entregaPersistida.tipo === "recogida"` deja `zonaEfectiva` en null: el
    // chequeo no debe disparar, o cobraría un domicilio que nadie pidió.
    expect(
      inconsistenciaFinancieraDePedido({
        ...conDomicilioPersistido,
        entregaPersistida: { tipo: "recogida" as const, feeCents: null },
      })
    ).toBeNull();
  });

  it("sin ninguna verificación previa, tampoco dispara", () => {
    expect(
      inconsistenciaFinancieraDePedido({ ...conDomicilioPersistido, entregaPersistida: null })
    ).toBeNull();
  });

  it("PREGUNTÓ LA TARIFA POR CURIOSIDAD y pidió para recoger: no se le cobra", () => {
    // La verificación existe -alguien pregunto cuanto costaba- pero el pedido
    // es de recogida. Cobrarle seria peor que no detectar nada.
    expect(
      inconsistenciaFinancieraDePedido({
        ...conDomicilioPersistido,
        modalidadDeEntrega: "recogida",
      })
    ).toBeNull();
  });

  it("con la modalidad sin resolver, no dispara: no se cobra a ciegas", () => {
    expect(
      inconsistenciaFinancieraDePedido({ ...conDomicilioPersistido, modalidadDeEntrega: null })
    ).toBeNull();
  });

  it("y la corrección le dice al modelo qué hacer, incluido el caso de recogida", () => {
    const texto = correccionDeInconsistenciaFinanciera("domicilio-omitido");
    expect(texto).toMatch(/deliveryFeeCents/);
    expect(texto).toMatch(/recogida/i);
  });
});
