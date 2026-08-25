import { describe, expect, it } from "vitest";
import {
  armarMenuDeCatalogo,
  armarMenuDeIntenciones,
  textoPlanoDeMenu,
} from "@/server/catalog/menu";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * El menú guiado de WhatsApp (25-ago-2026): nace del incidente de Lis (una
 * clienta escribió "torta de chocolate" y el modelo no conectó el sinónimo
 * con "Porción Chocolate" del catálogo, y escaló). Estas funciones arman lo
 * que el cliente TOCA, respetando los límites reales de WhatsApp — hasta 3
 * botones o hasta 10 filas en hasta 10 secciones — y degradan a `null`
 * (nunca truncan un nombre a algo ambiguo) cuando algo no cabe.
 */

function producto(p: Partial<ProductoDelCatalogo> & { id: string; nombre: string }): ProductoDelCatalogo {
  return {
    categoria: null,
    precioCents: null,
    descripcion: null,
    grupos: [],
    ...p,
  } as ProductoDelCatalogo;
}

describe("armarMenuDeIntenciones", () => {
  it("hasta 3 opciones cortas usan botones", () => {
    const menu = armarMenuDeIntenciones([
      { id: "menu", etiqueta: "Ver el menú" },
      { id: "pedido", etiqueta: "Hacer un pedido" },
      { id: "asesor", etiqueta: "Hablar con un asesor" },
    ]);
    expect(menu?.tipo).toBe("button");
    if (menu?.tipo === "button") expect(menu.botones).toHaveLength(3);
  });

  it("4 opciones o un botón con etiqueta larga usan una lista", () => {
    const menu = armarMenuDeIntenciones([
      { id: "menu", etiqueta: "Ver menú y precios" },
      { id: "pedido", etiqueta: "Hacer un pedido" },
      { id: "faq", etiqueta: "Preguntas frecuentes" },
      { id: "asesor", etiqueta: "Hablar con un asesor" },
    ]);
    expect(menu?.tipo).toBe("list");
    if (menu?.tipo === "list") expect(menu.secciones[0]?.filas).toHaveLength(4);
  });

  it("sin opciones no arma nada: quien llama debe caer a texto", () => {
    expect(armarMenuDeIntenciones([])).toBeNull();
  });

  it("más de 10 opciones no cabe en ninguna forma de WhatsApp", () => {
    const opciones = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, etiqueta: `Opción ${i}` }));
    expect(armarMenuDeIntenciones(opciones)).toBeNull();
  });
});

describe("armarMenuDeCatalogo", () => {
  it("agrupa por categoría en secciones de una sola lista", () => {
    const menu = armarMenuDeCatalogo([
      producto({ id: "p1", nombre: "Porción Chocolate", categoria: "Porciones de torta", precioCents: 1250000 }),
      producto({ id: "p2", nombre: "Porción Red Velvet", categoria: "Porciones de torta", precioCents: 1250000 }),
      producto({ id: "p3", nombre: "Cremoso 12 oz", categoria: "Cremosos", precioCents: 1800000 }),
    ]);
    expect(menu?.tipo).toBe("list");
    if (menu?.tipo === "list") {
      expect(menu.secciones.map((s) => s.titulo).sort()).toEqual(["Cremosos", "Porciones de torta"]);
      const chocolate = menu.secciones
        .flatMap((s) => s.filas)
        .find((f) => f.titulo === "Porción Chocolate");
      expect(chocolate?.id).toBe("p1");
      expect(chocolate?.descripcion).toContain("12.500");
    }
  });

  it("sin catálogo no arma nada", () => {
    expect(armarMenuDeCatalogo([])).toBeNull();
  });

  it("más de 10 productos no cabe en una sola lista (nivel 2 pospuesto)", () => {
    const productos = Array.from({ length: 11 }, (_, i) =>
      producto({ id: `p${i}`, nombre: `Producto ${i}`, categoria: "General" })
    );
    expect(armarMenuDeCatalogo(productos)).toBeNull();
  });

  it("un nombre de producto más largo que el límite de WhatsApp degrada a null, no lo trunca", () => {
    const productos = [
      producto({ id: "p1", nombre: "Un nombre de producto absurdamente largo para WhatsApp" }),
    ];
    expect(armarMenuDeCatalogo(productos)).toBeNull();
  });
});

describe("textoPlanoDeMenu", () => {
  it("lista las opciones de botones o de una lista con viñetas", () => {
    const menu = armarMenuDeIntenciones([
      { id: "menu", etiqueta: "Ver el menú" },
      { id: "pedido", etiqueta: "Hacer un pedido" },
    ]);
    expect(textoPlanoDeMenu(menu!)).toContain("• Ver el menú");
    expect(textoPlanoDeMenu(menu!)).toContain("• Hacer un pedido");
  });
});
