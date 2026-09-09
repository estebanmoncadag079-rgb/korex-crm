import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { normalizarPedido } from "@/server/orders/normalizar";

/**
 * El pedido que se perdió, contra el catálogo tal como quedó corregido.
 *
 * Incidente real (MALIA, 8-sep-2026, conv cv_cxjpas85h1czjkvn9qw6): tres Pavés
 * de 8 oz, la clienta escribió "Sin toppings" TRES veces y el agente le
 * preguntó CUATRO, porque el grupo `Toppings` —un extra de $2.000— estaba
 * marcado como obligatorio y un grupo obligatorio no se puede rechazar.
 *
 * El catálogo se corrigió desde el CRM (`Toppings` a mínimo 0, y los grupos
 * renombrados a `Sabores`/`Toppings` para que el agente los distinga). Esta
 * prueba fija ESE pedido, con ESE catálogo, para que ninguna corrección futura
 * lo vuelva a romper: es el escenario, no el mecanismo —el mecanismo se prueba
 * en `normalizar-pedido.test.ts`—.
 *
 * El sabor va a $0 porque está INCLUIDO en el pavé, no porque sea un regalo:
 * un pavé no existe sin sabor, viene en seis. El topping sí se agrega aparte.
 */
const PAVE_8OZ: ProductoDelCatalogo = {
  id: "prod_a59u016g1uvjg6p0ooim", nombre: "Pavé Cremoso 8 oz",
  categoria: "Pavés", precioCents: 1000000, descripcion: null,
  grupos: [
    { id: "g-sab", nombre: "Sabores", minimo: 1, maximo: 1, permiteRepeticion: false,
      opciones: ["Leche Klim","Milo","Maracuyá","Arequipe","Limón","Fresas con crema"]
        .map((n, i) => ({ id: `s${i}`, nombre: n, precioExtraCents: 0 })) },
    { id: "g-top", nombre: "Toppings", minimo: 0, maximo: 1, permiteRepeticion: false,
      opciones: ["Leche Klim","Milo","M&M","Chips de chocolate","Nuggets de Milo",
                 "Mermelada de Maracuyá","Lecherita","Arequipe","Oreo"]
        .map((n, i) => ({ id: `t${i}`, nombre: n, precioExtraCents: 200000 })) },
  ],
};

describe("el pedido de tres pavés sin toppings, que antes no se podía cerrar", () => {
  it("3 pavés de sabores distintos, SIN toppings, quedan con total y sin dudas", () => {
    const r = normalizarPedido({
      items: [
        { ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, opciones: [{ grupo: "Sabores", opcion: "Limón" }], gruposDeclinados: ["Toppings"] },
        { ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, opciones: [{ grupo: "Sabores", opcion: "Fresas con crema" }], gruposDeclinados: ["Toppings"] },
        { ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, opciones: [{ grupo: "Sabores", opcion: "Milo" }], gruposDeclinados: ["Toppings"] },
      ], datos: {},
    }, [PAVE_8OZ]);

    expect(r.dudas).toHaveLength(0);
    expect(r.estado.items.map((i) => i.totalCents)).toEqual([1000000, 1000000, 1000000]);
  });

  it("y con topping, cobra los $2.000 de más", () => {
    const r = normalizarPedido({
      items: [{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 1,
        opciones: [{ grupo: "Sabores", opcion: "Milo" }, { grupo: "Toppings", opcion: "Oreo" }] }], datos: {},
    }, [PAVE_8OZ]);
    expect(r.dudas).toHaveLength(0);
    expect(r.estado.items[0]!.totalCents).toBe(1200000);
  });

  it('"Milo" a secas ya no traba: existe como sabor y como topping', () => {
    const r = normalizarPedido({
      items: [{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, opciones: [{ opcion: "Milo" }] }], datos: {},
    }, [PAVE_8OZ]);
    expect(r.dudas.map((d) => d.preguntar).join(" ")).toMatch(/sabores|toppings/i);
  });
});
