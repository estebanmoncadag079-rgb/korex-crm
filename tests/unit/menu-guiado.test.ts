import { describe, expect, it } from "vitest";
import {
  armarMenuDeCatalogo,
  armarMenuDeCategoria,
  armarMenuDeCategorias,
  armarMenuDeIntenciones,
  armarMenuDelCatalogo,
  ID_VOLVER_A_CATEGORIAS,
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

  it("más de 10 productos no cabe en una sola lista — hace falta el nivel 2 (categorías)", () => {
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

/*
 * Nivel 2 (25-ago-2026): el caso real que lo motivó — Lis tiene 15
 * productos, más de los 10 que caben en una sola lista de WhatsApp (límite
 * duro de la plataforma, no de este código). Sin esto, "Ver menú y precios"
 * degradaba directo a texto y el incidente de "torta de chocolate" seguía
 * sin resolverse vía menú tocado.
 */
const CATALOGO_DE_LIS = [
  producto({ id: "c1", nombre: "Cremoso 12 oz", categoria: "Cremosos", precioCents: 1800000 }),
  producto({ id: "c2", nombre: "Cremoso 16 oz", categoria: "Cremosos", precioCents: 2200000 }),
  producto({ id: "c3", nombre: "Cremoso 7 oz", categoria: "Cremosos", precioCents: 1200000 }),
  producto({ id: "c4", nombre: "Cremoso Familiar 44 oz", categoria: "Cremosos", precioCents: 5500000 }),
  producto({ id: "c5", nombre: "Polvoroso 12 oz", categoria: "Polvorosos", precioCents: 1600000 }),
  producto({ id: "c6", nombre: "Polvoroso 16 oz", categoria: "Polvorosos", precioCents: 2000000 }),
  producto({ id: "c7", nombre: "Porción Chocolate", categoria: "Porciones de torta", precioCents: 1250000 }),
  producto({ id: "c8", nombre: "Porción Red Velvet", categoria: "Porciones de torta", precioCents: 1250000 }),
  producto({ id: "c9", nombre: "Porción Zanahoria", categoria: "Porciones de torta", precioCents: 1250000 }),
  producto({ id: "c10", nombre: "Agua", categoria: "Bebidas", precioCents: 300000 }),
  producto({ id: "c11", nombre: "Café", categoria: "Bebidas", precioCents: 300000 }),
  producto({ id: "c12", nombre: "Capuchino", categoria: "Bebidas", precioCents: 500000 }),
  producto({ id: "c13", nombre: "Sodas", categoria: "Bebidas", precioCents: 400000 }),
  producto({ id: "c14", nombre: "Mini Box", categoria: null, precioCents: 3000000 }),
  producto({ id: "c15", nombre: "Cremoso de Temporada Arrechon", categoria: "Cremosos", precioCents: 1900000 }),
];

describe("armarMenuDeCategorias", () => {
  it("lista solo los nombres de categoría, sin productos", () => {
    const menu = armarMenuDeCategorias(CATALOGO_DE_LIS);
    expect(menu?.tipo).toBe("list");
    if (menu?.tipo === "list") {
      const titulos = menu.secciones.flatMap((s) => s.filas.map((f) => f.titulo));
      expect(titulos.sort()).toEqual(
        ["Bebidas", "Cremosos", "General", "Polvorosos", "Porciones de torta"].sort()
      );
    }
  });
});

describe("armarMenuDeCategoria", () => {
  it("lista los productos de esa categoría y termina con Volver", () => {
    const menu = armarMenuDeCategoria(CATALOGO_DE_LIS, "Porciones de torta");
    expect(menu?.tipo).toBe("list");
    if (menu?.tipo === "list") {
      const filas = menu.secciones.flatMap((s) => s.filas);
      expect(filas.map((f) => f.titulo)).toContain("Porción Chocolate");
      expect(filas.at(-1)?.id).toBe(ID_VOLVER_A_CATEGORIAS);
    }
  });

  it("una categoría que no existe no arma nada", () => {
    expect(armarMenuDeCategoria(CATALOGO_DE_LIS, "No existe")).toBeNull();
  });
});

describe("armarMenuDelCatalogo (lo que usa el pipeline)", () => {
  it("con un catálogo grande y sin categoría pedida, cae a la lista de categorías", () => {
    const menu = armarMenuDelCatalogo(CATALOGO_DE_LIS, null);
    expect(menu?.tipo).toBe("list");
    if (menu?.tipo === "list") {
      const titulos = menu.secciones.flatMap((s) => s.filas.map((f) => f.titulo));
      expect(titulos).not.toContain("Porción Chocolate");
      expect(titulos).toContain("Porciones de torta");
    }
  });

  it("pidiendo una categoría, muestra sus productos directamente", () => {
    const menu = armarMenuDelCatalogo(CATALOGO_DE_LIS, "Porciones de torta");
    if (menu?.tipo === "list") {
      const titulos = menu.secciones.flatMap((s) => s.filas.map((f) => f.titulo));
      expect(titulos).toContain("Porción Chocolate");
    }
  });

  it("con un catálogo pequeño, sigue usando la lista plana de siempre (nivel 1)", () => {
    const chico = CATALOGO_DE_LIS.slice(0, 3);
    const menu = armarMenuDelCatalogo(chico, null);
    if (menu?.tipo === "list") {
      const titulos = menu.secciones.flatMap((s) => s.filas.map((f) => f.titulo));
      expect(titulos).toContain("Cremoso 12 oz");
    }
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
