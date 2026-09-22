import { describe, expect, it } from "vitest";
import {
  bloqueDeCifrasVerificadas,
  cifrasNumericasDelCierre,
  inconsistenciaFinancieraDePedido,
} from "@/server/ai/anuncio-de-cierre";

/**
 * EL FIN DE UNA FAMILIA DE INCIDENTES (15-sep-2026).
 *
 * Durante una semana, cuatro guardarraíles distintos derivaron pedidos
 * CORRECTOS por la misma causa: el backend conocía una cifra con certeza, el
 * modelo la escribía en prosa, y un guardarraíl releía esa prosa con una
 * expresión regular y una ventana de 25 caracteres.
 *
 * El testigo final es de MALIA (`cv_dco8y5w7c2sh99dpji2a`): 3 pavés de 8 oz
 * = $30.000, domicilio a Brisas de Mayo verificado y persistido = $12.000,
 * total correcto $42.000. La clienta dijo "Si correcto" y
 * `resumen-contradice-total-real` derivó el pedido igual.
 *
 * La solución no detecta mejor la contradicción: la hace imposible. El
 * backend escribe las cifras, así que ya no hay dos versiones que puedan
 * diferir.
 */

/** El caso real, con sus números exactos. */
const BRISAS_DE_MAYO = {
  subtotalCents: 3_000_000, // 3 × Pavé Cremoso 8 oz
  entrega: { tipo: "domicilio" as const, feeCents: 1_200_000 },
};

describe("bloqueDeCifrasVerificadas — el backend escribe las cifras del cierre", () => {
  it("el caso de MALIA: subtotal, domicilio y total, calculados por el backend", () => {
    expect(bloqueDeCifrasVerificadas(BRISAS_DE_MAYO)).toBe(
      "Subtotal: $30.000\nDomicilio: $12.000\nTotal: $42.000"
    );
  });

  it("recogida: lo dice explícitamente y el total NO suma domicilio", () => {
    expect(
      bloqueDeCifrasVerificadas({
        subtotalCents: 3_000_000,
        entrega: { tipo: "recogida", feeCents: null },
      })
    ).toBe("Subtotal: $30.000\nRecoges en el local (sin domicilio)\nTotal: $30.000");
  });

  it("sin modalidad resuelta todavía: solo afirma lo que es seguro", () => {
    expect(bloqueDeCifrasVerificadas({ subtotalCents: 1_800_000 })).toBe(
      "Subtotal: $18.000\nTotal: $18.000"
    );
  });

  /**
   * "Medio total es peor que ninguno": si falta la certeza, el bloque no
   * existe y el cierre sigue el camino de siempre, chequeos de texto
   * incluidos.
   */
  it("sin subtotal calculado: NO escribe nada", () => {
    expect(bloqueDeCifrasVerificadas({ subtotalCents: null })).toBeNull();
    expect(bloqueDeCifrasVerificadas({ subtotalCents: undefined })).toBeNull();
  });

  it("domicilio SIN tarifa verificada: NO escribe nada — no se inventa un total", () => {
    expect(
      bloqueDeCifrasVerificadas({
        subtotalCents: 3_000_000,
        entrega: { tipo: "domicilio", feeCents: null },
      })
    ).toBeNull();
  });
});

/**
 * `cifrasNumericasDelCierre` — la MISMA cuenta que `bloqueDeCifrasVerificadas`,
 * pero en números en vez de texto.
 *
 * Existe para un consumidor concreto: el salvavidas de recuperación de turno
 * (`@/server/ai/recuperacion-de-turno`), que construye un `notify_order`
 * SIN que el modelo haya propuesto uno. Requisito de la corrección del
 * 21-sep-2026 (noche): el `notify_order` rescatado debe llevar los mismos
 * datos estructurados que llevaría uno normal, incluido `deliveryFeeCents`
 * cuando corresponde — nunca calculado por Gemini, nunca desde texto libre,
 * nunca hardcodeado. Esta función es esa fuente única.
 */
describe("cifrasNumericasDelCierre — los mismos números, para un consumidor estructurado", () => {
  it("pedido SIN domicilio (modalidad sin resolver): deliveryFeeCents null, total = subtotal", () => {
    expect(cifrasNumericasDelCierre({ subtotalCents: 1_800_000 })).toEqual({
      subtotalCents: 1_800_000,
      deliveryFeeCents: null,
      totalCents: 1_800_000,
    });
  });

  it("recogida en el local: deliveryFeeCents null, total = subtotal", () => {
    expect(
      cifrasNumericasDelCierre({
        subtotalCents: 3_000_000,
        entrega: { tipo: "recogida", feeCents: null },
      })
    ).toEqual({ subtotalCents: 3_000_000, deliveryFeeCents: null, totalCents: 3_000_000 });
  });

  it("domicilio CON tarifa conocida (el caso de MALIA): deliveryFeeCents = la tarifa, total = suma", () => {
    expect(
      cifrasNumericasDelCierre({
        subtotalCents: 3_000_000,
        entrega: { tipo: "domicilio", feeCents: 1_200_000 },
      })
    ).toEqual({ subtotalCents: 3_000_000, deliveryFeeCents: 1_200_000, totalCents: 4_200_000 });
  });

  it("domicilio SIN tarifa verificada (pendiente): NO inventa una — deliveryFeeCents null, total = subtotal", () => {
    expect(
      cifrasNumericasDelCierre({
        subtotalCents: 3_000_000,
        entrega: { tipo: "domicilio", feeCents: null },
      })
    ).toEqual({ subtotalCents: 3_000_000, deliveryFeeCents: null, totalCents: 3_000_000 });
  });

  it("tarifa de domicilio $0 (zona gratis): es una tarifa REAL, no 'sin domicilio'", () => {
    // `0` es un valor legítimo (ver EntregaVerificada.feeCents en estado.ts:
    // "0 es una tarifa real, nunca 'no aplica'"). Si esto se confundiera con
    // "sin verificar", una zona gratis se trataría como domicilio pendiente.
    const r = cifrasNumericasDelCierre({
      subtotalCents: 1_800_000,
      entrega: { tipo: "domicilio", feeCents: 0 },
    });
    expect(r.deliveryFeeCents).toBe(0);
    expect(r.deliveryFeeCents).not.toBeNull();
    expect(r.totalCents).toBe(1_800_000);
  });

  it("nunca devuelve null: a diferencia del bloque de texto, siempre hay una respuesta estructurada válida", () => {
    // `bloqueDeCifrasVerificadas` SÍ devuelve null con domicilio pendiente
    // (para no apagar los chequeos de texto). Un `notify_order` no puede
    // tener un `deliveryFeeCents` "null de verdad" en ese sentido — la
    // acción necesita algún valor, y `null` (sin tarifa) es ese valor.
    const pendiente = cifrasNumericasDelCierre({
      subtotalCents: 1_000_000,
      entrega: { tipo: "domicilio", feeCents: null },
    });
    expect(pendiente).not.toBeNull();
    expect(bloqueDeCifrasVerificadas({ subtotalCents: 1_000_000, entrega: { tipo: "domicilio", feeCents: null } })).toBeNull();
  });

  describe("coherencia: totalCents === subtotalCents + (deliveryFeeCents ?? 0), siempre", () => {
    const CASOS = [
      { nombre: "sin domicilio", input: { subtotalCents: 500_000 } },
      { nombre: "recogida", input: { subtotalCents: 500_000, entrega: { tipo: "recogida" as const, feeCents: null } } },
      { nombre: "domicilio con tarifa", input: { subtotalCents: 500_000, entrega: { tipo: "domicilio" as const, feeCents: 300_000 } } },
      { nombre: "domicilio con tarifa cero", input: { subtotalCents: 500_000, entrega: { tipo: "domicilio" as const, feeCents: 0 } } },
      { nombre: "domicilio pendiente", input: { subtotalCents: 500_000, entrega: { tipo: "domicilio" as const, feeCents: null } } },
    ];
    for (const { nombre, input } of CASOS) {
      it(nombre, () => {
        const r = cifrasNumericasDelCierre(input);
        expect(r.totalCents).toBe(r.subtotalCents + (r.deliveryFeeCents ?? 0));
      });
    }
  });
});

describe("con el bloque del backend, los chequeos de TEXTO se apagan", () => {
  /** El cierre exacto que derivó hoy en MALIA. */
  const cierreDeMalia = {
    summary: "3 Pavés Cremosos 8 oz para Brisas de Mayo. Total con domicilio: $42.000",
    farewell: "¡Listo! Tu pedido va en camino. El total es $42.000 con el domicilio.",
    subtotalCents: 3_000_000,
    deliveryFeeCents: 1_200_000,
    totalCents: 4_200_000,
    zonaVerificada: null,
    entregaPersistida: { tipo: "domicilio" as const, feeCents: 1_200_000 },
    puedeVerificarDomicilio: true,
    subtotalReal: 3_000_000,
  };

  it("EL INCIDENTE: el mismo cierre que derivó, ahora pasa", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierreDeMalia,
        cifrasLasEscribeElBackend: true,
      })
    ).toBeNull();
  });

  it("sin el bloque del backend, los chequeos de texto siguen como antes", () => {
    // Un total que NO cuadra con lo verificado: el texto dice $50.000.
    const conTextoMalo = {
      ...cierreDeMalia,
      summary: "3 Pavés para Brisas de Mayo. Total: $50.000",
    };
    expect(
      inconsistenciaFinancieraDePedido({ ...conTextoMalo, cifrasLasEscribeElBackend: false })
    ).toBe("resumen-contradice-total-real");
  });

  /**
   * Lo que NO se afloja: los chequeos NUMÉRICOS corren siempre, con bloque
   * o sin él. Comparan número contra número y nunca han fallado.
   */
  it("la aritmética se sigue verificando aunque el backend escriba las cifras", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierreDeMalia,
        cifrasLasEscribeElBackend: true,
        totalCents: 9_999_999, // no es subtotal + domicilio
      })
    ).toBe("total-no-cuadra");
  });

  it("un domicilio cobrado sin verificar sigue bloqueando el cierre", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierreDeMalia,
        cifrasLasEscribeElBackend: true,
        entregaPersistida: null,
        zonaVerificada: null,
        deliveryFeeCents: 1_200_000,
        totalCents: 4_200_000,
      })
    ).toBe("domicilio-nunca-verificado");
  });

  it("un subtotal que no coincide con el carrito sigue bloqueando", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        ...cierreDeMalia,
        cifrasLasEscribeElBackend: true,
        subtotalCents: 2_000_000, // el carrito real son $30.000
        totalCents: 3_200_000,
      })
    ).toBe("subtotal-no-coincide-con-el-carrito");
  });
});
