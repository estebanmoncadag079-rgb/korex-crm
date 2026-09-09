import { describe, expect, it } from "vitest";
import { conEntregaConservada, validarPropuesta } from "@/server/orders/estado";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * La causa raíz de cuatro clientes perdidos en un solo día (MALIA,
 * 9-sep-2026): Carol, Michael, Laura y Karol. Cada uno parecía un bug
 * distinto —uno por el domicilio, otro por los métodos de pago, otro por un
 * párrafo de texto— y los cuatro eran esto.
 *
 * `validarPropuesta` reconstruye el estado desde lo que propone el modelo
 * —items, datos, reserva, modalidad, total, paso, confirmado— y **`entrega`
 * no está en esa lista**. Como el campo es opcional en el tipo, TypeScript
 * nunca se quejó.
 *
 * Así que cada turno guardaba `entrega: undefined` y borraba la verificación
 * de domicilio del turno anterior. Medido en producción: de 101
 * conversaciones con estado guardado, **solo 4 conservaban la entrega**. Las
 * otras 97 llegaban al cierre sin zona verificada, y el guardarraíl financiero
 * —que no tenía contra qué comprobar la tarifa— las derivaba justo cuando el
 * cliente decía "sí, correcto".
 */
const CATALOGO: ProductoDelCatalogo[] = [
  {
    id: "p8",
    nombre: "Pavé Cremoso 8 oz",
    categoria: null,
    precioCents: 1000000,
    descripcion: null,
    grupos: [],
  },
];

const ENTREGA = {
  tipo: "domicilio" as const,
  zonaId: "dz_1",
  zonaNombre: "Villa del Sur",
  feeCents: 800000,
  verificadoEnMensajeId: "msg_1",
  verificadoEn: "2026-09-09T22:17:00.000Z",
};

describe("la verificación de domicilio sobrevive al turno", () => {
  it("LA CAUSA: validarPropuesta reconstruye el estado SIN entrega", () => {
    const v = validarPropuesta(
      { items: [{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 2, opciones: [] }], datos: {} },
      CATALOGO
    );
    expect(v.ok).toBe(true);
    // Esto es lo que se guardaba tal cual, borrando la verificación.
    if (v.ok) expect(v.estado.entrega).toBeUndefined();
  });

  it("EL ARREGLO: al guardar, la entrega conocida se conserva", () => {
    const v = validarPropuesta(
      { items: [{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 2, opciones: [] }], datos: {} },
      CATALOGO
    );
    if (!v.ok) throw new Error("la propuesta debería ser válida");
    const guardado = conEntregaConservada(v.estado, ENTREGA);
    expect(guardado.entrega).toEqual(ENTREGA);
    // Y no toca nada más del estado.
    expect(guardado.items).toEqual(v.estado.items);
    expect(guardado.totalCents).toBe(v.estado.totalCents);
  });

  it("sin entrega conocida, respeta la que ya trajera el estado", () => {
    const estado = { ...({} as never), entrega: ENTREGA } as Parameters<typeof conEntregaConservada>[0];
    expect(conEntregaConservada(estado, undefined).entrega).toEqual(ENTREGA);
    expect(conEntregaConservada(estado, null).entrega).toEqual(ENTREGA);
  });

  it("sin nada por ningún lado, queda en null y no en undefined", () => {
    // `undefined` desaparece al serializar a JSON y deja el campo ausente en
    // la fila; `null` dice explícitamente "no hay verificación".
    const estado = { ...({} as never) } as Parameters<typeof conEntregaConservada>[0];
    expect(conEntregaConservada(estado, undefined).entrega).toBeNull();
  });

  it("una entrega NUEVA pisa a la vieja: la del turno manda", () => {
    const vieja = { ...ENTREGA, zonaNombre: "Talanga", feeCents: 1000000 };
    const estado = { ...({} as never), entrega: vieja } as Parameters<typeof conEntregaConservada>[0];
    expect(conEntregaConservada(estado, ENTREGA).entrega).toEqual(ENTREGA);
  });
});
