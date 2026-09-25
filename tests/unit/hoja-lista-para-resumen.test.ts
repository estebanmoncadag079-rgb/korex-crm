import { describe, expect, it } from "vitest";
import { hojaListaParaResumen } from "@/server/orders/extraer";

/**
 * ¿La hoja del pedido está lista para mostrar el resumen? — la mitad de BACKEND
 * del Bug 5 (24-sep-2026).
 *
 * Decide desde el ESTADO, nunca desde el texto del modelo: ítems resueltos,
 * total (subtotal) calculado, requisitos obligatorios completos, y un total
 * CALCULABLE incluyendo el domicilio. Si el pedido es a domicilio y la tarifa
 * aún no está verificada, la hoja NO está lista — primero se verifica el
 * domicilio, no se fuerza un resumen sin él (el caso de aymara al aplazar).
 */

const BASE = { itemsResueltos: 1, totalCents: 1000000, requisitosPendientes: 0 } as const;

describe("hojaListaParaResumen: lista cuando el total es completo y calculable", () => {
  it("recogida en el local (por entrega verificada)", () => {
    expect(hojaListaParaResumen({ ...BASE, entrega: { tipo: "recogida", feeCents: null } })).toBe(true);
  });

  it("recogida (por modalidad, sin entrega verificada)", () => {
    expect(
      hojaListaParaResumen({ ...BASE, modalidadDeEntrega: "Recoge en el local", entrega: null })
    ).toBe(true);
  });

  it("domicilio con la tarifa YA verificada (el caso de Diana)", () => {
    expect(
      hojaListaParaResumen({ ...BASE, entrega: { tipo: "domicilio", feeCents: 800000 } })
    ).toBe(true);
  });
});

describe("hojaListaParaResumen: NO lista mientras falte algo del total", () => {
  it("domicilio sin tarifa verificada (feeCents null)", () => {
    expect(
      hojaListaParaResumen({ ...BASE, entrega: { tipo: "domicilio", feeCents: null } })
    ).toBe(false);
  });

  it("modalidad domicilio elegida pero sin verificar (el caso de aymara al aplazar)", () => {
    expect(
      hojaListaParaResumen({ ...BASE, modalidadDeEntrega: "domicilio", entrega: null })
    ).toBe(false);
  });

  it("faltan requisitos obligatorios", () => {
    expect(
      hojaListaParaResumen({ ...BASE, requisitosPendientes: 2, entrega: { tipo: "recogida", feeCents: null } })
    ).toBe(false);
  });

  it("sin ítems resueltos", () => {
    expect(
      hojaListaParaResumen({ ...BASE, itemsResueltos: 0, entrega: { tipo: "recogida", feeCents: null } })
    ).toBe(false);
  });

  it("sin total calculado", () => {
    expect(
      hojaListaParaResumen({ ...BASE, totalCents: null, entrega: { tipo: "recogida", feeCents: null } })
    ).toBe(false);
  });

  it("sin modalidad ni entrega resueltas", () => {
    expect(hojaListaParaResumen({ ...BASE, entrega: null })).toBe(false);
  });
});
