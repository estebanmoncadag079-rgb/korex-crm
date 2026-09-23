import { describe, expect, it } from "vitest";
import { renderCatalogoDePedidos } from "@/server/catalog/render";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * Incidente real (28-ago-2026, cliente nuevo con dos presentaciones de un
 * mismo producto): el agente dijo que los toppings solo aplicaban a UNA de
 * dos presentaciones que en realidad los tenían ambas. Causa raíz encontrada
 * en `renderCatalogoDePedidos`, no en el modelo de datos (que sí sabía qué
 * grupo era de qué producto) ni en el LLM:
 *
 * 1. La línea "(elige N ...)" de cada producto solo listaba grupos
 *    OBLIGATORIOS (`minimo >= 1`); un grupo opcional como "Toppings"
 *    (`minimo: 0`) quedaba invisible junto a su propio producto.
 * 2. El bloque separado de opciones no decía a qué producto(s) pertenecía
 *    cada grupo — ni cuando el grupo era único de un producto, ni cuando
 *    (por tener el mismo nombre y las mismas opciones) se combinaba entre
 *    varios. El agente tenía que ADIVINAR la relación producto → opciones.
 *
 * La corrección es estructural (aplica a cualquier negocio de pedidos con
 * grupos opcionales o compartidos entre productos), no una regla para un
 * cliente puntual.
 */

function grupo(
  nombre: string,
  minimo: number,
  maximo: number,
  opciones: { nombre: string; precioExtraCents?: number }[]
) {
  return {
    id: `pog_${nombre.toLowerCase().replace(/\s+/g, "_")}`,
    nombre,
    minimo,
    maximo,
    permiteRepeticion: false,
    opciones: opciones.map((o, i) => ({
      id: `popt_${nombre}_${i}`,
      nombre: o.nombre,
      precioExtraCents: o.precioExtraCents ?? 0,
    })),
  };
}

function producto(nombre: string, precioCents: number, grupos: ReturnType<typeof grupo>[] = []): ProductoDelCatalogo {
  return {
    id: `prod_${nombre.toLowerCase().replace(/\s+/g, "_")}`,
    nombre,
    categoria: null,
    precioCents,
    descripcion: null,
    grupos,
  };
}

describe("renderCatalogoDePedidos: relación producto → opciones", () => {
  it("un grupo OPCIONAL (mínimo 0) aparece junto a su propio producto, no solo en el bloque aparte", () => {
    const toppings = grupo("Toppings", 0, 9, [
      { nombre: "Chips de chocolate", precioExtraCents: 200_000 },
      { nombre: "Arequipe", precioExtraCents: 200_000 },
    ]);
    const texto = renderCatalogoDePedidos([producto("Torta Grande", 1_800_000, [toppings])]);

    const lineaDelProducto = texto.split("\n").find((l) => l.startsWith("Torta Grande"));
    expect(lineaDelProducto).toContain("toppings");
    expect(lineaDelProducto).toContain("opcional");
  });

  it("un grupo compartido por dos productos se combina en un bloque, atribuido a AMBOS", () => {
    const sabor = grupo("Sabor", 1, 1, [{ nombre: "Vainilla" }, { nombre: "Chocolate" }]);
    const texto = renderCatalogoDePedidos([
      producto("Torta Grande", 1_800_000, [sabor]),
      producto("Torta Pequeña", 1_000_000, [
        { ...sabor, id: "pog_sabor_2" }, // mismo nombre y mismas opciones: es el mismo grupo lógico
      ]),
    ]);

    const bloque = texto.split("\n").find((l) => l.startsWith("SABOR"));
    expect(bloque).toBeTruthy();
    expect(bloque).toContain("Torta Grande");
    expect(bloque).toContain("Torta Pequeña");
    // Un solo bloque, no uno repetido por producto.
    expect(texto.match(/^SABOR/gm)).toHaveLength(1);
  });

  it("un grupo que solo existe en UN producto queda atribuido solo a ese producto", () => {
    const soloDeLaGrande = grupo("Cobertura", 0, 3, [{ nombre: "Chispas" }]);
    const texto = renderCatalogoDePedidos([
      producto("Torta Grande", 1_800_000, [soloDeLaGrande]),
      producto("Torta Pequeña", 1_000_000, []),
    ]);

    const bloque = texto.split("\n").find((l) => l.startsWith("COBERTURA"));
    expect(bloque).toContain("Torta Grande");
    expect(bloque).not.toContain("Torta Pequeña");
  });

  it("no duplica la 's' cuando el nombre del grupo ya viene en plural (evita 'toppingss')", () => {
    const toppings = grupo("Toppings", 0, 9, [{ nombre: "Oreo" }, { nombre: "M&M" }]);
    const texto = renderCatalogoDePedidos([producto("Torta Grande", 1_800_000, [toppings])]);

    expect(texto).not.toMatch(/toppingss/i);
  });

  it("dos grupos con el MISMO nombre pero opciones distintas NO se combinan", () => {
    const sabor16 = grupo("Sabor", 1, 1, [{ nombre: "Vainilla" }, { nombre: "Chocolate" }]);
    const sabor8 = grupo("Sabor", 1, 1, [{ nombre: "Fresa" }]);
    const texto = renderCatalogoDePedidos([
      producto("Torta Grande", 1_800_000, [sabor16]),
      producto("Torta Pequeña", 1_000_000, [sabor8]),
    ]);

    expect(texto.match(/^SABOR/gm)).toHaveLength(2);
  });

  it("un grupo OBLIGATORIO sigue diciendo 'elige N' (comportamiento de siempre, sin regresión)", () => {
    const sabor = grupo("Sabor", 1, 1, [{ nombre: "Vainilla" }]);
    const texto = renderCatalogoDePedidos([producto("Torta", 1_800_000, [sabor])]);

    const lineaDelProducto = texto.split("\n").find((l) => l.startsWith("Torta"));
    expect(lineaDelProducto).toContain("elige 1 sabor");
  });

  it("un producto sin ningún grupo se ve igual que siempre (sin paréntesis vacío)", () => {
    const texto = renderCatalogoDePedidos([producto("Botella de Agua", 300_000)]);
    expect(texto).toBe("Botella de Agua — $3.000");
  });
});

/**
 * Incidente real (MALIA, 22-sep-2026): las opciones llegaban al prompt
 * aplastadas en una sola línea —`MILO · OREO · AREQUIPE · FRESA · …`— y el
 * agente las repetía al cliente tal cual, en contra de las reglas de
 * presentación del propio negocio, que piden listas.
 *
 * Es un fallo de FORMATO ESTRUCTURAL del dato, no una regla de MALIA: el
 * separador ` · ` lo escribía el renderer común a los cinco negocios. La
 * viñeta `• ` no se inventa aquí — es la que ya usa `textoPlanoDeMenu`
 * (`catalog/menu.ts`) para las listas que lee un cliente por WhatsApp, y la
 * que `catalogo-texto.ts` sabe leer de vuelta.
 *
 * Por qué importa que sea el renderer y no el prompt: el modelo copia los
 * datos duros TAL CUAL (regla de `ESTILO` en conducta.ts). Si le llegan en
 * una línea, los manda en una línea por mucho que otra instrucción diga
 * "haz listas".
 */
describe("renderCatalogoDePedidos: las opciones se leen como lista", () => {
  it("cada opción va en su propia línea con viñeta, no separadas por ' · '", () => {
    const sabor = grupo("Sabor", 1, 1, [
      { nombre: "MILO" },
      { nombre: "OREO" },
      { nombre: "AREQUIPE" },
      { nombre: "FRESA" },
    ]);
    const texto = renderCatalogoDePedidos([producto("Pavé Cremoso 7 oz", 1_200_000, [sabor])]);

    expect(texto).toContain("• MILO\n• OREO\n• AREQUIPE\n• FRESA");
    expect(texto).not.toContain("MILO · OREO");
  });

  it("la cabecera del bloque sigue diciendo a qué productos aplica, y la lista va debajo", () => {
    const sabor = grupo("Sabor", 1, 1, [{ nombre: "MILO" }, { nombre: "OREO" }]);
    const texto = renderCatalogoDePedidos([
      producto("Pavé 7 oz", 1_200_000, [sabor]),
      producto("Pavé 8 oz", 1_500_000, [{ ...sabor, id: "pog_sabor_2" }]),
    ]);

    const lineas = texto.split("\n");
    const i = lineas.findIndex((l) => l.startsWith("SABOR"));
    expect(lineas[i]).toContain("aplica a: Pavé 7 oz, Pavé 8 oz");
    expect(lineas[i + 1]).toBe("• MILO");
    expect(lineas[i + 2]).toBe("• OREO");
  });

  it("el precio extra de una opción sigue pegado a su propia línea", () => {
    const adiciones = grupo("Adiciones", 0, 3, [
      { nombre: "Arequipe", precioExtraCents: 200_000 },
      { nombre: "Oreo" },
    ]);
    const texto = renderCatalogoDePedidos([producto("Torta", 1_800_000, [adiciones])]);

    expect(texto).toContain("• Arequipe $2.000");
    expect(texto).toContain("• Oreo");
  });
});
