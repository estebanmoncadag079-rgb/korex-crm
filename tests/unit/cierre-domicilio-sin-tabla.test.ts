import { describe, expect, it } from "vitest";
import { inconsistenciaFinancieraDePedido } from "@/server/ai/anuncio-de-cierre";

/**
 * Incidente real de producción (7-sep-2026, MALIA | Pavés . Postres).
 *
 * Conversación testigo `cv_da855xkj2g0745pemj7o` ("Zahenz"):
 *
 *   19:29:37 out  "El domicilio a Ciudad Modelo tiene un valor de $8.000 🛵"
 *   19:30:21 out  "¡Perfecto! Aquí tienes el resumen de tu pedido: 1 × Pavé Cremoso 16 oz…"
 *   19:30:52 in   "Si"                                    ← la clienta CONFIRMA
 *   19:31:15 out  "Dame un momentico 🙏 Te comunico con una persona del equipo…"
 *   19:36:28 in   "Si se hizo el pedido?"                  ← quedó en el limbo
 *
 * Traza del turno:
 *   accion=handoff  guardarrailes=inconsistencia_financiera:disparado
 *   causa_handoff=model_output_recovery_failed
 *   motivo (6 de 6 veces): "domicilio-no-verificado"
 *
 * **La causa NO fue que el modelo no entendiera "Si"**: lo entendió y emitió
 * `notify_order` (por eso este guardarraíl llegó a evaluarse — solo corre
 * sobre esa acción). La causa fue un CONTRATO IMPOSIBLE: el chequeo exigía
 * que `deliveryFeeCents` estuviera respaldado por `consultar_domicilio`,
 * pero esa acción solo se le ofrece al modelo cuando el negocio tiene
 * `delivery_source='tabla'` (ver `tieneZonasDeEntrega` en prompts.ts), y los
 * CUATRO negocios de pedidos reales están en `'prompt'`. El modelo no tenía
 * ninguna forma de producir la prueba que se le exigía.
 *
 * Medido: 6 disparos en ~5 horas, 4 terminados en derivación, 5
 * conversaciones — el 100% de los pedidos con domicilio de ese negocio.
 */

/** El negocio del incidente: `delivery_source='prompt'`, sin `delivery_zone`. */
const SIN_TABLA_DE_ZONAS = { puedeVerificarDomicilio: false, zonaVerificada: null };

/** Un negocio con `delivery_source='tabla'` y `consultar_domicilio` disponible. */
const CON_TABLA_DE_ZONAS = { puedeVerificarDomicilio: true };

describe("BUG REAL: un negocio sin tabla de zonas no puede probar el domicilio, y se le exigía igual", () => {
  it("caso Zahenz reproducido: cierre con domicilio en un negocio 'prompt' -> NO se bloquea", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Pavé Cremoso 16 oz — $18.000 · Domicilio $8.000 · Total $26.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
        ...SIN_TABLA_DE_ZONAS,
      })
    ).toBeNull();
  });

  it("aunque el modelo mande solo deliveryFeeCents, sin subtotal ni total, tampoco se bloquea", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Pavé Cremoso 16 oz. Domicilio $8.000",
        deliveryFeeCents: 800000,
        ...SIN_TABLA_DE_ZONAS,
      })
    ).toBeNull();
  });

  it("un pedido SIN domicilio en un negocio 'prompt' sigue pasando, como siempre", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Pavé Cremoso 16 oz — $18.000",
        subtotalCents: 1800000,
        deliveryFeeCents: null,
        totalCents: 1800000,
        ...SIN_TABLA_DE_ZONAS,
      })
    ).toBeNull();
  });
});

describe("PROTECCIÓN INTACTA donde SÍ se puede verificar (delivery_source='tabla')", () => {
  it("incidente de Kachipay: tarifa inventada sin haber consultado la zona -> se sigue bloqueando", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Torta — $18.000 · Domicilio $8.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
        zonaVerificada: null, // nunca se consultó en este turno
        ...CON_TABLA_DE_ZONAS,
      })
    ).toBe("domicilio-no-verificado");
  });

  it("tarifa que NO coincide con la zona verificada -> se sigue bloqueando", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Torta — $18.000 · Domicilio $8.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2600000,
        zonaVerificada: { feeCents: 1200000 }, // la real era $12.000
        ...CON_TABLA_DE_ZONAS,
      })
    ).toBe("domicilio-no-verificado");
  });

  it("tarifa que SÍ coincide con la zona verificada -> pasa", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Torta — $18.000 · Domicilio $12.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 1200000,
        totalCents: 3000000,
        zonaVerificada: { feeCents: 1200000 },
        ...CON_TABLA_DE_ZONAS,
      })
    ).toBeNull();
  });

  it("el resumen contradice la tarifa verificada -> se sigue bloqueando", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Torta — $18.000 · Domicilio $8.000 · Total $26.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 1200000,
        totalCents: 3000000,
        zonaVerificada: { feeCents: 1200000 },
        ...CON_TABLA_DE_ZONAS,
      })
    ).toBe("resumen-contradice-tarifa");
  });
});

describe("La aritmética NO depende de la infraestructura: protege a TODOS los negocios", () => {
  it("total que no cuadra en un negocio 'prompt' -> se sigue bloqueando", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Pavé — $18.000 · Domicilio $8.000 · Total $20.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 800000,
        totalCents: 2000000, // 18.000 + 8.000 = 26.000, no 20.000
        ...SIN_TABLA_DE_ZONAS,
      })
    ).toBe("total-no-cuadra");
  });

  it("total que no cuadra en un negocio 'tabla' -> se sigue bloqueando", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Torta — $18.000 · Total $19.000",
        subtotalCents: 1800000,
        deliveryFeeCents: null,
        totalCents: 1900000,
        zonaVerificada: null,
        ...CON_TABLA_DE_ZONAS,
      })
    ).toBe("total-no-cuadra");
  });
});
