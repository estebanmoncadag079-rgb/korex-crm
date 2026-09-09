import { describe, expect, it } from "vitest";
import { gruposAmbiguos, obligaAPagarUnExtra, opcionesAmbiguas } from "@/lib/catalogo-ambiguedad";

/**
 * Incidente real (MALIA, 8-sep-2026). El "Pavé Cremoso 8 oz" tenía los sabores
 * y los toppings revueltos en un solo grupo `Topping` de `max_select: 1`, con
 * tres nombres repetidos dentro. Una clienta escribió "Sin toppings" TRES
 * veces y el agente le preguntó CUATRO: el sabor ya ocupaba el único cupo, el
 * carrito se rechazaba en cada turno, y no había forma de salir del bucle.
 *
 * Ese día la suite entera pasó (209 archivos, 2064 pruebas, cero fallos): el
 * código estaba bien, lo roto era el DATO. Por eso esta comprobación mira el
 * catálogo, no el código.
 */
describe("opciones que el agente no puede distinguir", () => {
  it("EL CASO REAL: sabores y toppings con el mismo nombre en un grupo", () => {
    const grupoTopping8oz = [
      { nombre: "Leche Klim" },
      { nombre: "Milo" },
      { nombre: "Maracuyá" },
      { nombre: "Arequipe" },
      { nombre: "Limón" },
      { nombre: "Leche Klim" }, // el topping de $2.000
      { nombre: "Milo" },
      { nombre: "M&M" },
      { nombre: "Arequipe" },
      { nombre: "Oreo" },
      { nombre: "Fresas con crema" },
    ];
    expect(opcionesAmbiguas(grupoTopping8oz).sort()).toEqual([
      "Arequipe",
      "Leche Klim",
      "Milo",
    ]);
  });

  it("el mismo producto BIEN cargado (16 oz, grupos separados) no avisa nada", () => {
    const sabores = [
      { nombre: "Milo" },
      { nombre: "Maracuyá" },
      { nombre: "Arequipe" },
      { nombre: "Limón" },
      { nombre: "Fresas con crema" },
      { nombre: "Leche Klim" },
    ];
    const toppings = [
      { nombre: "Lecherita" },
      { nombre: "Arequipe" },
      { nombre: "Oreo" },
      { nombre: "Leche Klim" },
      { nombre: "Milo" },
    ];
    // Repetir un nombre ENTRE grupos distintos es normal y correcto: el
    // arequipe existe como sabor y como topping, y el agente sabe cuál es
    // cuál porque están en grupos distintos.
    expect(opcionesAmbiguas(sabores)).toEqual([]);
    expect(opcionesAmbiguas(toppings)).toEqual([]);
  });

  it("compara como compara el agente: sin tildes, sin mayúsculas, sin espacios de sobra", () => {
    expect(opcionesAmbiguas([{ nombre: "Maracuyá" }, { nombre: "maracuya" }])).toEqual([
      "Maracuyá",
    ]);
    expect(opcionesAmbiguas([{ nombre: "Oreo" }, { nombre: "  OREO  " }])).toEqual(["Oreo"]);
  });

  it("devuelve la grafía que escribió el negocio, para que la reconozca", () => {
    // No la normalizada: quien lea el aviso tiene que ver lo que tiene cargado.
    expect(opcionesAmbiguas([{ nombre: "Chips de Chocolate" }, { nombre: "chips de chocolate" }])).toEqual([
      "Chips de Chocolate",
    ]);
  });

  it("tres iguales se reportan una sola vez, no dos", () => {
    expect(opcionesAmbiguas([{ nombre: "Milo" }, { nombre: "Milo" }, { nombre: "Milo" }])).toEqual([
      "Milo",
    ]);
  });

  it("un grupo sano, uno vacío y los nombres en blanco no avisan nada", () => {
    expect(opcionesAmbiguas([{ nombre: "Milo" }, { nombre: "Oreo" }])).toEqual([]);
    expect(opcionesAmbiguas([])).toEqual([]);
    expect(opcionesAmbiguas([{ nombre: "   " }, { nombre: "" }])).toEqual([]);
  });
});

/**
 * La causa RAÍZ del mismo incidente, y la más grave: no eran las opciones
 * repetidas, eran los dos grupos llamados igual. El Pavé de 8 oz tenía
 * `Topping` (6 sabores) y `Topping` (9 toppings de $2.000) porque alguien
 * renombró el grupo `Sabor`.
 */
describe("grupos que el agente no puede distinguir", () => {
  it("EL CASO REAL: dos grupos del mismo producto llamados igual", () => {
    // Un solo nombre en la respuesta, porque el nombre repetido ES uno solo:
    // decir «Topping» y «Topping» no le aclararía nada a quien lea el aviso.
    // La pantalla distingue este caso del de dos nombres parecidos.
    expect(gruposAmbiguos([{ nombre: "Topping" }, { nombre: "Topping" }])).toEqual(["Topping"]);
  });

  it("LA TRAMPA LATENTE: 'Topping' y 'Toppings' también son el mismo grupo para el agente", () => {
    // El Pavé de 16 oz tiene justo ese par. A una persona le parecen dos
    // nombres distintos; a `coincideGrupo` (prefijo mutuo) no.
    expect(gruposAmbiguos([{ nombre: "Topping" }, { nombre: "Toppings" }]).sort()).toEqual([
      "Topping",
      "Toppings",
    ]);
  });

  it("nombres de verdad distintos no avisan nada", () => {
    expect(gruposAmbiguos([{ nombre: "Sabor" }, { nombre: "Toppings" }])).toEqual([]);
    expect(gruposAmbiguos([{ nombre: "Tamaño" }, { nombre: "Salsa" }, { nombre: "Bebida" }])).toEqual([]);
  });

  it("un solo grupo, o ninguno, nunca es ambiguo", () => {
    expect(gruposAmbiguos([{ nombre: "Sabor" }])).toEqual([]);
    expect(gruposAmbiguos([])).toEqual([]);
  });

  it("los tres implicados salen cuando son tres", () => {
    const r = gruposAmbiguos([{ nombre: "Extra" }, { nombre: "Extras" }, { nombre: "Salsa" }]);
    expect(r.sort()).toEqual(["Extra", "Extras"]);
  });
});

/**
 * La causa raíz del bucle de MALIA (8-sep-2026): el grupo `Topping` del Pavé
 * de 8 oz, nueve opciones de $2.000 cada una, estaba marcado como OBLIGATORIO.
 * Un grupo obligatorio no se puede rechazar (`normalizar.ts`: "el grupo sigue
 * pendiente y `faltaDelItem` lo va a seguir pidiendo"), así que "Sin toppings"
 * no tenía forma de ser aceptado. La clienta lo dijo tres veces; el agente
 * preguntó cuatro.
 */
describe("grupos que obligan a pagar un extra", () => {
  it("EL CASO REAL: obligatorio y todas las opciones cuestan", () => {
    expect(
      obligaAPagarUnExtra({
        minimo: 1,
        opciones: [
          { precioExtraCents: 200000 },
          { precioExtraCents: 200000 },
          { precioExtraCents: 200000 },
        ],
      })
    ).toBe(true);
  });

  it("el mismo grupo como OPCIONAL no avisa: así debía estar cargado", () => {
    expect(
      obligaAPagarUnExtra({ minimo: 0, opciones: [{ precioExtraCents: 200000 }] })
    ).toBe(false);
  });

  it("un sabor obligatorio y gratis —lo normal— no avisa", () => {
    expect(
      obligaAPagarUnExtra({
        minimo: 1,
        opciones: [{ precioExtraCents: 0 }, { precioExtraCents: 0 }],
      })
    ).toBe(false);
  });

  it("elegir entre una incluida y una más cara es legítimo: no avisa", () => {
    // Un tamaño, una presentación: hay que elegir, pero se puede elegir la que
    // no cuesta nada. El cliente no queda atrapado.
    expect(
      obligaAPagarUnExtra({
        minimo: 1,
        opciones: [{ precioExtraCents: 0 }, { precioExtraCents: 800000 }],
      })
    ).toBe(false);
  });

  it("un grupo sin opciones cargadas no avisa por esto", () => {
    // Le falta otra cosa —cargar las opciones—, y ese aviso ya existe aparte.
    expect(obligaAPagarUnExtra({ minimo: 1, opciones: [] })).toBe(false);
  });
});
