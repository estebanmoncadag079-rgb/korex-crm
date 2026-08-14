import { describe, expect, it } from "vitest";
import {
  compararCatalogo,
  compararFilas,
  type ServicioGuardado,
} from "@/lib/catalogo-diff";

/**
 * Comparar la lista escrita por el cliente contra su catálogo cargado.
 *
 * Es la costura entre las dos mitades que no se hablaban: lo que el cliente
 * escribe en el alta y lo que se ve en la pantalla de Servicios, donde se marca
 * quién atiende cada cosa.
 */

const GUARDADOS: ServicioGuardado[] = [
  { id: "s1", name: "Volumen Ruso", category: "Pestañas", priceCents: 13500000, durationMin: 150 },
  { id: "s2", name: "Lifting de pestañas", category: "Cejas", priceCents: 8000000, durationMin: 60 },
];

const TIPICA = 60;

describe("compararCatalogo", () => {
  it("una lista idéntica no propone ningún cambio", () => {
    const d = compararCatalogo({
      texto: "Volumen Ruso — $135.000 · 150 min\nLifting de pestañas — $80.000 · 60 min",
      guardados: GUARDADOS,
      duracionTipicaMin: TIPICA,
    });
    expect(d).toMatchObject({ nuevos: [], sobrantes: [], cambios: [], sinCambios: 2 });
  });

  it("reconoce el mismo servicio aunque cambien mayúsculas y tildes", () => {
    const d = compararCatalogo({
      texto: "VOLUMEN RUSO — $135.000 · 150 min\nlifting de pestanas — $80.000 · 60 min",
      guardados: GUARDADOS,
      duracionTipicaMin: TIPICA,
    });
    expect(d.nuevos).toHaveLength(0);
    expect(d.sobrantes).toHaveLength(0);
  });

  it("un servicio añadido a la lista sale como nuevo", () => {
    const d = compararCatalogo({
      texto:
        "Volumen Ruso — $135.000 · 150 min\nLifting de pestañas — $80.000 · 60 min\nVolumen 6D — $180.000 · 180 min",
      guardados: GUARDADOS,
      duracionTipicaMin: TIPICA,
    });
    expect(d.nuevos.map((n) => n.nombre)).toEqual(["Volumen 6D"]);
  });

  it("un servicio que desaparece de la lista sale como sobrante", () => {
    const d = compararCatalogo({
      texto: "Volumen Ruso — $135.000 · 150 min",
      guardados: GUARDADOS,
      duracionTipicaMin: TIPICA,
    });
    expect(d.sobrantes.map((s) => s.name)).toEqual(["Lifting de pestañas"]);
  });

  it("detecta el precio y la duración distintos, con el antes y el después", () => {
    const d = compararCatalogo({
      texto: "Volumen Ruso — $150.000 · 180 min\nLifting de pestañas — $80.000 · 60 min",
      guardados: GUARDADOS,
      duracionTipicaMin: TIPICA,
    });
    expect(d.cambios).toEqual([
      {
        id: "s1",
        nombre: "Volumen Ruso",
        precioAntes: 13500000,
        precioAhora: 15000000,
        duracionAntes: 150,
        duracionAhora: 180,
      },
    ]);
  });

  /**
   * Lo más peligroso de todo: una línea sin precio no significa "vale 0".
   * Interpretarlo así pondría el catálogo entero a cero en una sola
   * sincronización, y el agente lo repetiría a cada clienta.
   */
  it("una línea sin precio ni minutos NO cambia lo que ya estaba", () => {
    const d = compararCatalogo({
      texto: "Volumen Ruso\nLifting de pestañas",
      guardados: GUARDADOS,
      duracionTipicaMin: TIPICA,
    });
    expect(d.cambios).toEqual([]);
    expect(d.sinCambios).toBe(2);
  });

  it("el mismo servicio repetido en la lista no se crea dos veces", () => {
    const d = compararCatalogo({
      texto: "Volumen 6D — $180.000 · 180 min\nVOLUMEN 6D — $180.000 · 180 min",
      guardados: [],
      duracionTipicaMin: TIPICA,
    });
    expect(d.nuevos).toHaveLength(1);
  });

  it("con el catálogo vacío, todo lo escrito es nuevo y no sobra nada", () => {
    const d = compararCatalogo({
      texto: "PESTAÑAS\nVolumen Ruso — $135.000 · 150 min",
      guardados: [],
      duracionTipicaMin: TIPICA,
    });
    expect(d.nuevos.map((n) => n.nombre)).toEqual(["Volumen Ruso"]);
    expect(d.sobrantes).toEqual([]);
  });

  /**
   * Lo que manda la pantalla son las filas YA revisadas, con la categoría en su
   * propio campo. La primera versión reconstruía un texto y metía la categoría
   * en el nombre ("Volumen Ruso [Pestañas]"): no casaba con nada guardado y
   * habría duplicado el catálogo entero en la primera sincronización.
   */
  it("las filas revisadas casan por nombre, con la categoría aparte", () => {
    const d = compararFilas({
      filas: [
        { nombre: "Volumen Ruso", categoria: "Pestañas", precio: 135000, duracionMin: 150 },
        { nombre: "Lifting de pestañas", categoria: "Cejas", precio: 80000, duracionMin: 60 },
      ],
      guardados: GUARDADOS,
    });
    expect(d).toMatchObject({ nuevos: [], sobrantes: [], cambios: [], sinCambios: 2 });
  });

  it("con la lista vacía no propone borrar el catálogo entero por accidente", () => {
    const d = compararCatalogo({ texto: "", guardados: GUARDADOS, duracionTipicaMin: TIPICA });
    // Sí los marca como sobrantes —es lo que la lista dice—, pero nada se
    // archiva sin que una persona lo confirme en pantalla.
    expect(d.sobrantes).toHaveLength(2);
    expect(d.nuevos).toEqual([]);
  });
});
