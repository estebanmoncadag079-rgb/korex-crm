import { describe, expect, it } from "vitest";
import { leerCatalogoPegado } from "@/lib/catalogo-texto";

/**
 * 13-ago-2026. Un negocio de citas solo podía cargar sus servicios de uno en
 * uno; el salón tiene 46. Esto lee la lista que el dueño ya tiene escrita, con
 * el formato que use — porque nadie escribe su carta en un formato.
 */
describe("leerCatalogoPegado", () => {
  it("lee la lista tal y como la escribe un salón", () => {
    const filas = leerCatalogoPegado(`
      PESTAÑAS
      Volumen ruso — $150.000 · 180 min
      Lifting de pestañas $80.000 (60 minutos)

      CEJAS
      Cejas en henna - 30000 - 45min
    `);

    expect(filas).toHaveLength(3);
    expect(filas[0]).toEqual({
      nombre: "Volumen ruso",
      precio: 150000,
      duracionMin: 180,
      categoria: "PESTAÑAS",
    });
    expect(filas[1]).toEqual({
      nombre: "Lifting de pestañas",
      precio: 80000,
      duracionMin: 60,
      categoria: "PESTAÑAS",
    });
    expect(filas[2]).toEqual({
      nombre: "Cejas en henna",
      precio: 30000,
      duracionMin: 45,
      categoria: "CEJAS",
    });
  });

  it("no confunde los minutos con el precio", () => {
    // "45 min" trae un número que, leído como precio, daría $45.
    const [fila] = leerCatalogoPegado("Diseño de cejas 45 min");
    expect(fila?.duracionMin).toBe(45);
    expect(fila?.precio).toBeNull();
    expect(fila?.nombre).toBe("Diseño de cejas");
  });

  it("deja en null lo que no entiende, en vez de inventarlo", () => {
    const [fila] = leerCatalogoPegado("Manicure semipermanente");
    expect(fila).toEqual({
      nombre: "Manicure semipermanente",
      precio: null,
      duracionMin: null,
      categoria: null,
    });
  });

  it("acepta viñetas y líneas en blanco", () => {
    const filas = leerCatalogoPegado("• Uña individual $8.000\n\n- Press On $60.000");
    expect(filas.map((f) => f.nombre)).toEqual(["Uña individual", "Press On"]);
    expect(filas.map((f) => f.precio)).toEqual([8000, 60000]);
  });

  it("una sección con dos puntos también agrupa", () => {
    const filas = leerCatalogoPegado("Labios:\nHidralips $60.000");
    expect(filas).toHaveLength(1);
    expect(filas[0]?.categoria).toBe("Labios");
  });

  it("un nombre largo sin precio es un servicio, no una sección", () => {
    const filas = leerCatalogoPegado(
      "Retoque de volumen ruso hasta veinte días después"
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.categoria).toBeNull();
  });

  it("con una lista vacía no devuelve nada", () => {
    expect(leerCatalogoPegado("   \n\n  ")).toEqual([]);
  });
});
