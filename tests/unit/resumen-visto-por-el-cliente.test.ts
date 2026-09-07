import { describe, expect, it } from "vitest";
import { TIENE_TOTAL, elClienteVioUnTotal } from "@/server/ai/anuncio-de-cierre";

/**
 * Incidente real (6-sep-2026, Lucero Vallejo / Lis Pastelería): el guardarraíl
 * "notify_order sin resumen previo" (14-ago, contra los pedidos vacíos)
 * comprobaba el FORMATO del texto y no el HECHO. El prompt de Lis —escrito por
 * el propio negocio desde el CRM— pide literalmente *"seria algo como TOTAL SIN
 * DOMICILIO: X valor"*, así que su resumen real dice `*TOTAL SIN DOMICILIO:*
 * $19.000`. Con dos palabras entre "TOTAL" y la cifra, la expresión no lo
 * reconocía:
 *
 *   in  19:28:33  "Si esta bien"                        ← la clienta confirma
 *   log 19:28:46  notify_order sin resumen previo; rehaciendo el turno
 *   out 19:28:58  "Aquí te comparto el resumen completo…" ← el MISMO resumen otra vez
 *
 * Resultado: 0 filas en `order_confirmation` (el equipo nunca recibió el aviso
 * automático y cerró el pedido a mano), sin handoff ni error en ningún log.
 * Medido en producción: 3 bloqueos en 2 conversaciones de DOS negocios
 * distintos (Lis y MALIA) en menos de 48 horas.
 */

/** El resumen REAL que Lis le envió a la clienta, copiado de `message.text`. */
const RESUMEN_REAL_DE_LIS = `¡Perfecto, Lucero! 💗 Aquí tienes el resumen de tu pedido:

👤 *Nombre:* Lucero Vallejo
📱 *Teléfono:* sin teléfono
🍰 *Pedido:* 1 × Cremoso de Temporada Franui 12 oz ($19.000)
📍 *Dirección:* Cra 11d#71-11, barrio Siete de Agosto

🛵 *DOMICILIO

El domicilio lo paga el cliente directamente al repartidor cuando recibe el pedido.

💰 *TOTAL SIN DOMICILIO:* $19.000

¿Me confirmas si todos los datos están correctos para agendarlo? ✨`;

describe("TIENE_TOTAL: tolera palabras entre 'total' y la cifra", () => {
  it("BUG REAL: el resumen de Lis ('TOTAL SIN DOMICILIO: $19.000') ahora SÍ se reconoce", () => {
    expect(TIENE_TOTAL.test(RESUMEN_REAL_DE_LIS)).toBe(true);
  });

  it.each([
    ["*TOTAL SIN DOMICILIO:* $19.000", true],
    ["*TOTAL CON DOMICILIO:* $27.100", true],
    ["*TOTAL A PAGAR:* $19.000", true],
    ["💰 *Total:* $18.000", true], // el formato clásico sigue pasando
    ["Total: $18.000", true],
    ["TOTAL $19.000", true],
  ])("reconoce %s", (texto, esperado) => {
    expect(TIENE_TOTAL.test(texto)).toBe(esperado);
  });

  it("NO se convierte en un comodín: sin cifra, o con la cifra en otra línea, sigue sin contar", () => {
    expect(TIENE_TOTAL.test("¿Confirmas el total?")).toBe(false);
    expect(TIENE_TOTAL.test("Te digo el total\n$19.000")).toBe(false);
    expect(TIENE_TOTAL.test("En total son varios productos, ya te confirmo el precio")).toBe(false);
  });
});

describe("elClienteVioUnTotal: el hecho del backend manda sobre el formato del texto", () => {
  it("BUG REAL reproducido: el resumen de Lis + el total calculado por el backend -> el cierre NO se bloquea", () => {
    // 1900000 centavos = $19.000, exactamente lo que guardó `conversation_state`
    // en el turno anterior (verificado en los logs de producción).
    expect(elClienteVioUnTotal([RESUMEN_REAL_DE_LIS], 1900000)).toBe(true);
  });

  it("aunque el negocio redacte el total de una forma que ninguna expresión prevea, si la CIFRA real se le mostró, cuenta", () => {
    expect(elClienteVioUnTotal(["Serían 19.000 con todo incluido 😊"], 1900000)).toBe(true);
    expect(elClienteVioUnTotal(["Son 19000 en efectivo"], 1900000)).toBe(true);
  });

  it("sin estado estructurado (state_source='prompt'), el respaldo por texto sigue funcionando", () => {
    expect(elClienteVioUnTotal([RESUMEN_REAL_DE_LIS], null)).toBe(true);
    expect(elClienteVioUnTotal(["💰 *Total:* $18.000"], undefined)).toBe(true);
  });

  it("PROTECCIÓN ORIGINAL INTACTA (14-ago, pedidos vacíos): sin cifra mostrada y sin total en el backend -> se bloquea", () => {
    expect(elClienteVioUnTotal(["¿Confirmas tu pedido?"], null)).toBe(false);
    expect(elClienteVioUnTotal(["Perfecto, ya te anoto"], undefined)).toBe(false);
    expect(elClienteVioUnTotal([], 1900000)).toBe(false);
  });

  it("el backend conoce el total pero NUNCA se le mostró al cliente -> se bloquea igual (no basta con que el servidor lo sepa)", () => {
    expect(elClienteVioUnTotal(["¿Me confirmas la dirección?"], 1900000)).toBe(false);
  });

  it("ignora mensajes vacíos o nulos sin romperse", () => {
    expect(elClienteVioUnTotal([null, undefined, "", RESUMEN_REAL_DE_LIS], null)).toBe(true);
    expect(elClienteVioUnTotal([null, undefined, ""], null)).toBe(false);
  });
});
