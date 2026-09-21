/**
 * El pedido mínimo para que salga un domicilio.
 *
 * ## Por qué existe
 *
 * MALIA tenía esto escrito en una regla propia: *"No hacemos domicilios para
 * un solo pavé de 8 oz, debe ser mínimo dos de 8 oz o uno de 16 oz"*. Una
 * regla que cuesta dinero cada vez que se rompe —mandar un domiciliario por
 * $10.000— y que hasta hoy solo aplicaba el modelo, que es exactamente lo que
 * el Principio 7 prohíbe: el LLM comunica, el backend decide.
 *
 * ## Por qué un IMPORTE y no "dos unidades de 8 oz"
 *
 * Porque la regla del negocio, traducida, es económica: *un domicilio no sale
 * a cuenta por menos de X*. Un mínimo por unidades no puede expresarla —uno
 * de 16 oz es UNA unidad y sí vale— mientras que un importe la reproduce
 * exacta con el catálogo real:
 *
 *   2 × pavé 8 oz  = $20.000  ✅ pasa
 *   1 × pavé 16 oz = $18.000  ✅ pasa
 *   1 × pavé 8 oz  = $10.000  ❌ no llega
 *
 * Y es la forma general: cualquier negocio del CRM entiende "pedido mínimo
 * para domicilio", ninguno entiende "dos de tu segundo producto".
 *
 * ## El importe NO incluye el domicilio
 *
 * Se compara contra el subtotal de los productos. Cobrar el envío para
 * alcanzar el mínimo del envío sería circular, y dejaría pasar justo los
 * pedidos que la regla quiere frenar.
 */
import { describe, expect, it } from "vitest";
import { faltaParaElMinimoDeDomicilio } from "@/server/orders/minimo-de-domicilio";
import { MODALIDAD_DOMICILIO, MODALIDAD_RECOGIDA } from "@/server/ai/generador/ficha";

const caso = (over: Partial<Parameters<typeof faltaParaElMinimoDeDomicilio>[0]> = {}) =>
  faltaParaElMinimoDeDomicilio({
    minimoCents: 1800000,
    modalidadDeEntrega: MODALIDAD_DOMICILIO,
    subtotalCents: 2000000,
    ...over,
  });

describe("faltaParaElMinimoDeDomicilio", () => {
  it("deja pasar un pedido que supera el mínimo", () => {
    expect(caso({ subtotalCents: 2000000 })).toBeNull();
  });

  it("deja pasar un pedido que lo iguala EXACTAMENTE — el mínimo es inclusivo", () => {
    // Un pavé de 16 oz cuesta justo el mínimo. Rechazarlo sería cambiar la
    // regla del negocio por un `<` mal puesto.
    expect(caso({ subtotalCents: 1800000 })).toBeNull();
  });

  it("frena el pedido que no llega, y dice cuánto falta", () => {
    expect(caso({ subtotalCents: 1000000 })).toEqual({
      minimoCents: 1800000,
      subtotalCents: 1000000,
      faltanCents: 800000,
    });
  });

  it("NO aplica a recogida: el mínimo es del domicilio, no del negocio", () => {
    expect(caso({ modalidadDeEntrega: MODALIDAD_RECOGIDA, subtotalCents: 1000000 })).toBeNull();
  });

  it("NO aplica mientras no se sepa la modalidad", () => {
    // Frenar antes de saber cómo lo quiere recibir sería pedirle al cliente
    // que añada productos que quizá no necesita: puede estar recogiendo.
    expect(caso({ modalidadDeEntrega: null, subtotalCents: 1000000 })).toBeNull();
    expect(caso({ modalidadDeEntrega: undefined, subtotalCents: 1000000 })).toBeNull();
  });

  it("NO aplica si el negocio no configuró ningún mínimo", () => {
    for (const sinMinimo of [null, undefined, 0]) {
      expect(caso({ minimoCents: sinMinimo, subtotalCents: 1 })).toBeNull();
    }
  });

  it("NO aplica si el subtotal todavía no está calculado", () => {
    // `totalCents: null` significa "el backend aún no puede sumar" (producto
    // sin precio, opciones sin elegir). Tratarlo como 0 frenaría el pedido por
    // una razón falsa; ya hay otro guardarraíl para el total sin calcular.
    expect(caso({ subtotalCents: null, minimoCents: 1800000 })).toBeNull();
  });

  it("un mínimo negativo o absurdo no frena nada", () => {
    expect(caso({ minimoCents: -500, subtotalCents: 1 })).toBeNull();
  });

  it("es indiferente a mayúsculas y espacios en la modalidad", () => {
    // La modalidad viaja como texto libre desde el modelo y se normaliza
    // antes, pero el guardarraíl no debe depender de que eso haya ocurrido.
    expect(caso({ modalidadDeEntrega: " Domicilio ", subtotalCents: 1000000 })).not.toBeNull();
  });
});
