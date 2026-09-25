import { describe, expect, it } from "vitest";
import { debeVerificarDomicilio, direccionDelPedido } from "@/server/orders/extraer";
import { siguientePasoDelDomicilio, textoDePedirBarrio } from "@/server/delivery/zonas";
import {
  inconsistenciaFinancieraDePedido,
  correccionDeInconsistenciaFinanciera,
  resumenSinDomicilio,
  correccionDeResumenSinDomicilio,
  faltaPedirElBarrio,
} from "@/server/ai/anuncio-de-cierre";

/**
 * El domicilio SIEMPRE va en el pedido, antes de confirmar (25-sep-2026).
 *
 * Caso real (MALIA, Maye Díaz, cv_dgih82h6duslfe7be5gm): pidió 2 pavés a
 * domicilio, dio su dirección, nunca preguntó cuánto costaba el envío — y el
 * resumen salió con "Total: $20.000", solo productos. La tarifa solo se
 * verificaba si el MODELO decidía consultarla, y su contrato decía hacerlo
 * "cuando el cliente pregunte cuánto cuesta el domicilio".
 *
 * Decisión del dueño: en un negocio con tabla de zonas, un pedido a domicilio
 * lleva productos + domicilio = total en el resumen y en el cierre. Si recoge,
 * no se cobra domicilio. Todo se decide por CONFIGURACIÓN (`delivery_source =
 * 'tabla'`), nunca por el nombre de un negocio: La Churra y Lis (cotizan el
 * domicilio aparte, por app) no cambian.
 */

const BASE = { tieneTablaDeZonas: true, modalidadDeEntrega: "domicilio", direccion: "Calle 72 # 3n 45 barrio floralia" };

describe("debeVerificarDomicilio: el backend verifica, no espera a que el cliente pregunte", () => {
  it("pedido a domicilio con dirección y sin verificar → verifica (el caso de Maye)", () => {
    expect(debeVerificarDomicilio({ ...BASE, entrega: null })).toBe(true);
  });

  it("ya verificado PARA ESA MISMA dirección → no repite", () => {
    expect(
      debeVerificarDomicilio({
        ...BASE,
        entrega: { tipo: "domicilio", feeCents: 1000000, direccion: "Calle 72 # 3n 45 barrio floralia" },
      })
    ).toBe(false);
  });

  it("verificado para OTRA dirección → vuelve a verificar (caso Manuela: zona vieja de otro pedido)", () => {
    expect(
      debeVerificarDomicilio({
        ...BASE,
        direccion: "Cra 26n #112-72",
        entrega: { tipo: "domicilio", feeCents: 800000, direccion: "calle 17a#46a81 San judas etapa 2" },
      })
    ).toBe(true);
  });

  it("una verificación vieja sin dirección registrada no cuenta como verificada", () => {
    expect(debeVerificarDomicilio({ ...BASE, entrega: { tipo: "domicilio", feeCents: 800000 } })).toBe(true);
  });

  it("recoge en el local → no hay domicilio que verificar", () => {
    expect(debeVerificarDomicilio({ ...BASE, modalidadDeEntrega: "recogida", entrega: null })).toBe(false);
  });

  it("el cliente dijo explícitamente que recoge (aunque la modalidad no se actualizó) → no se busca domicilio", () => {
    expect(
      debeVerificarDomicilio({ ...BASE, entrega: { tipo: "recogida", feeCents: null } })
    ).toBe(false);
  });

  it("sin dirección todavía → nada que verificar aún", () => {
    expect(debeVerificarDomicilio({ ...BASE, direccion: "  ", entrega: null })).toBe(false);
  });

  it("negocio SIN tabla de zonas (La Churra, Lis) → nunca: su domicilio se cotiza aparte", () => {
    expect(debeVerificarDomicilio({ ...BASE, tieneTablaDeZonas: false, entrega: null })).toBe(false);
  });
});

describe("direccionDelPedido: la dirección se reconoce por el TIPO del requisito, no por su id", () => {
  const req = (id: string, tipo: "texto" | "direccion") => ({ id, tipo, etiqueta: id, obligatorio: true });

  it("toma el requisito de tipo dirección, se llame como se llame", () => {
    expect(
      direccionDelPedido({ datos: { nombre: "Maye", dir_entrega: "Calle 72 # 3n 45" } }, [
        req("nombre", "texto"),
        req("dir_entrega", "direccion"),
      ])
    ).toBe("Calle 72 # 3n 45");
  });

  it("sin requisito de dirección o sin valor → null", () => {
    expect(direccionDelPedido({ datos: { nombre: "Maye" } }, [req("nombre", "texto")])).toBeNull();
    expect(direccionDelPedido({ datos: {} }, [req("direccion", "direccion")])).toBeNull();
    expect(direccionDelPedido(null, [req("direccion", "direccion")])).toBeNull();
  });
});

/**
 * Instrucción del dueño (25-sep-2026): la tabla está por BARRIOS. Si la
 * dirección no está en la tabla (p. ej. "Centro, Cali"), el bot pide el barrio
 * — "Por favor, dime el barrio para ayudarte con el total con el domicilio" —
 * y con el barrio el backend busca y suma. Si aun así no hay barrio (no lo da,
 * o el que da tampoco está), ahí sí se pasa al equipo. Se pregunta UNA vez:
 * nunca en bucle, nunca "te confirmo el valor" como salida.
 */
describe("siguientePasoDelDomicilio: cobrar, pedir el barrio o pasar al equipo", () => {
  const zona = { id: "z1", nombre: "Floralia", feeCents: 1000000 };

  it("la zona se encuentra → cobrar", () => {
    expect(siguientePasoDelDomicilio({ resultado: { status: "found", zona }, barrioYaPedido: false })).toBe(
      "cobrar"
    );
  });

  it("no está en la tabla y aún no se pidió el barrio → pedir el barrio", () => {
    expect(siguientePasoDelDomicilio({ resultado: { status: "not_found" }, barrioYaPedido: false })).toBe(
      "pedir-barrio"
    );
  });

  it("varias zonas posibles y aún no se pidió → pedir el barrio (cuál de ellas)", () => {
    expect(
      siguientePasoDelDomicilio({
        resultado: { status: "multiple_matches", zonas: [zona, { ...zona, id: "z2", nombre: "Floralia II" }] },
        barrioYaPedido: false,
      })
    ).toBe("pedir-barrio");
  });

  it("ya se pidió el barrio y sigue sin estar en la tabla → pasar al equipo", () => {
    expect(siguientePasoDelDomicilio({ resultado: { status: "not_found" }, barrioYaPedido: true })).toBe(
      "pasar-al-equipo"
    );
  });

  it("ya se pidió el barrio y el cliente lo dio bien → cobrar (nunca pasa al equipo si hay tarifa)", () => {
    expect(siguientePasoDelDomicilio({ resultado: { status: "found", zona }, barrioYaPedido: true })).toBe(
      "cobrar"
    );
  });

  it("el texto para el modelo pide el barrio con la frase del dueño, sin prometer 'te confirmo'", () => {
    const t = textoDePedirBarrio("Edificio Colombia, Centro, Cali");
    expect(t).toMatch(/dime el barrio para ayudarte con el total con el domicilio/i);
    expect(t).not.toMatch(/vas a confirmar/i);
  });
});

/*
 * Medido con el modelo real (25-sep-2026): se le pidió el barrio, la clienta
 * contestó con su nombre y teléfono, y el bot dijo "Ahora preparo el resumen
 * con el total" — un resumen que no puede tener total sin el barrio.
 */
describe("faltaPedirElBarrio: mientras falta el barrio, el mensaje lo pide", () => {
  const pendiente = { tipo: "domicilio" as const, feeCents: null, barrioPedido: true };

  it("barrio pendiente y el mensaje no lo pide → falta", () => {
    expect(
      faltaPedirElBarrio({ texto: "Perfecto Maye 😊 Ahora preparo el resumen con el total.", entrega: pendiente })
    ).toBe(true);
  });

  it("el mensaje pide el barrio → bien", () => {
    expect(faltaPedirElBarrio({ texto: "¿Me dices el barrio, por favor?", entrega: pendiente })).toBe(false);
  });

  it("sin barrio pendiente (tarifa ya verificada, o nunca se pidió) → no aplica", () => {
    expect(
      faltaPedirElBarrio({ texto: "Listo", entrega: { tipo: "domicilio", feeCents: 1000000, barrioPedido: true } })
    ).toBe(false);
    expect(faltaPedirElBarrio({ texto: "Listo", entrega: { tipo: "domicilio", feeCents: null } })).toBe(false);
    expect(faltaPedirElBarrio({ texto: "Listo", entrega: null })).toBe(false);
  });
});

describe("el cierre no pasa sin tarifa en un negocio con tabla", () => {
  const cierre = {
    summary: "Pedido: 2 × Pavé Cremoso 8 oz\nCliente: Maye Díaz, Calle 72 # 3n 45\nTotal: $20.000",
    farewell: "¡Listo!",
    subtotalCents: 2000000,
    deliveryFeeCents: null,
    totalCents: 2000000,
    zonaVerificada: null,
    entregaPersistida: null,
    modalidadDeEntrega: "domicilio",
    subtotalReal: 2000000,
  };

  it("tabla + pedido a domicilio + tarifa nunca verificada → bloquea (el cierre de Maye)", () => {
    expect(inconsistenciaFinancieraDePedido({ ...cierre, puedeVerificarDomicilio: true })).toBe(
      "domicilio-pendiente-en-tabla"
    );
  });

  it("negocio SIN tabla (La Churra, Lis): el domicilio pendiente sigue siendo normal", () => {
    expect(inconsistenciaFinancieraDePedido({ ...cierre, puedeVerificarDomicilio: false })).toBeNull();
  });

  it("tabla + RECOGIDA: sin domicilio, no bloquea", () => {
    expect(
      inconsistenciaFinancieraDePedido({ ...cierre, puedeVerificarDomicilio: true, modalidadDeEntrega: "recogida" })
    ).toBeNull();
  });

  it("la corrección manda a verificar la zona antes de cerrar", () => {
    const c = correccionDeInconsistenciaFinanciera("domicilio-pendiente-en-tabla");
    expect(c).toMatch(/consultar_domicilio/);
    expect(c).toMatch(/Responde ÚNICAMENTE el objeto JSON\.$/);
  });
});

describe("resumenSinDomicilio: el resumen dice el total REAL (productos + domicilio)", () => {
  const cifras = { subtotalCents: 2000000, feeCents: 1000000 };

  it("'Total: $20.000' cuando el total real es $30.000 → mal (el resumen de Maye)", () => {
    expect(
      resumenSinDomicilio({ ...cifras, texto: "Aquí tienes el resumen:\n2 × Pavé 8 oz\nTotal: $20.000\n¿Confirmas?" })
    ).toBe(true);
  });

  it("con el total que suma el domicilio → bien", () => {
    expect(
      resumenSinDomicilio({
        ...cifras,
        texto: "Resumen:\nSubtotal: $20.000\nDomicilio: $10.000\nTotal: $30.000\n¿Confirmas?",
      })
    ).toBe(false);
  });

  it("el total está bien pero NO muestra la línea del domicilio → mal (regla del dueño: productos + domicilio + total)", () => {
    // Medido con el modelo real (25-sep-2026): "Barrio: Floralia … Total: $30.000".
    expect(
      resumenSinDomicilio({
        ...cifras,
        texto: "Resumen:\n2 × Pavé 8 oz — $10.000 c/u\nBarrio: Floralia\nTotal: $30.000\n¿Confirmas?",
      })
    ).toBe(true);
  });

  it("un mensaje que no es un resumen con total no se toca", () => {
    expect(resumenSinDomicilio({ ...cifras, texto: "¿Me pasas tu dirección con barrio?" })).toBe(false);
  });

  it("la corrección le da las cifras exactas del backend", () => {
    const c = correccionDeResumenSinDomicilio(cifras);
    expect(c).toMatch(/20\.000/);
    expect(c).toMatch(/10\.000/);
    expect(c).toMatch(/30\.000/);
    expect(c).toMatch(/Responde ÚNICAMENTE el objeto JSON\.$/);
  });
});
