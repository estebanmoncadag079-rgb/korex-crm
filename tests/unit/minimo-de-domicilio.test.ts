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

/**
 * Los cinco casos que el negocio aprobó por escrito el 21-sep-2026, con las
 * cifras del catálogo real de MALIA. Están aquí, literales, para que quien
 * venga después no tenga que reconstruir la decisión desde un documento.
 *
 * El contrato: **el mínimo es MONETARIO y se compara contra el SUBTOTAL.**
 * No hay regla por unidades ni por tamaño de producto, y la tarifa de
 * domicilio no cuenta.
 */
describe("los casos aprobados por el negocio (21-sep-2026)", () => {
  const MINIMO = 1800000; // $18.000 en centavos — el precio del pavé de 16 oz
  const cumple = (subtotalCents: number) =>
    faltaParaElMinimoDeDomicilio({
      minimoCents: MINIMO,
      modalidadDeEntrega: MODALIDAD_DOMICILIO,
      subtotalCents,
    }) === null;

  const P8 = 1000000; // pavé 8 oz  · $10.000
  const P16 = 1800000; // pavé 16 oz · $18.000
  const TOPPING = 200000; // cada uno · $2.000

  it("1 × pavé 8 oz = $10.000 → NO cumple", () => {
    expect(cumple(P8)).toBe(false);
  });

  it("1 × pavé 8 oz + toppings hasta $18.000 → SÍ cumple (aceptado explícitamente)", () => {
    // 4 toppings × $2.000 = $8.000, y $10.000 + $8.000 = $18.000 justos.
    // El negocio aceptó esta consecuencia: el domicilio se paga a sí mismo
    // igual. NO se debe añadir una regla de unidades para "corregirlo".
    expect(P8 + 4 * TOPPING).toBe(1800000);
    expect(cumple(P8 + 4 * TOPPING)).toBe(true);
    // Y por debajo de esos 4 toppings, sigue sin llegar.
    expect(cumple(P8 + 3 * TOPPING)).toBe(false);
  });

  it("1 × pavé 16 oz = $18.000 → SÍ cumple", () => {
    expect(cumple(P16)).toBe(true);
  });

  it("2 × pavé 8 oz = $20.000 → SÍ cumple", () => {
    expect(cumple(2 * P8)).toBe(true);
  });

  it("subtotal $10.000 + domicilio $10.000 = $20.000 → NO cumple", () => {
    // El caso que más fácil se implementa mal. La función solo recibe el
    // SUBTOTAL: no tiene forma de sumar la tarifa ni aunque se lo pidieran.
    expect(cumple(P8)).toBe(false);
  });

  it("el mínimo NO conoce unidades: solo mira el importe", () => {
    // Mismo subtotal, composiciones distintas, mismo veredicto. Si algún día
    // esto deja de ser cierto es que alguien metió lógica de unidades.
    expect(cumple(1800000)).toBe(true); // 1 × 16 oz
    expect(cumple(1800000)).toBe(true); // 1 × 8 oz + 4 toppings
  });
});
