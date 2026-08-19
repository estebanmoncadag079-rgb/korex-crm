import { describe, expect, it } from "vitest";
import { categoriasDe } from "@/components/services/services-client";

/**
 * Las categorías del catálogo salen de los propios servicios: no hay tabla de
 * categorías, y no la hay a propósito (ver el comentario de `categoriasDe`).
 *
 * Lo que se prueba aquí es lo que hace útil al desplegable: que no aparezca
 * tres veces la misma categoría escrita de tres formas, que es exactamente en
 * lo que degenera un campo de texto libre en un catálogo de 46 servicios.
 */

function srv(name: string, category: string | null, archivedAt: string | null = null) {
  return { id: name, name, category, priceCents: 1000, durationMin: 30, archivedAt };
}

describe("categoriasDe", () => {
  it("saca las categorías que el negocio usa, ordenadas", () => {
    expect(
      categoriasDe([srv("a", "Uñas"), srv("b", "Cejas"), srv("c", "Pestañas")])
    ).toEqual(["Cejas", "Pestañas", "Uñas"]);
  });

  it("no repite la misma categoría escrita distinto", () => {
    expect(categoriasDe([srv("a", "Pestañas"), srv("b", "pestañas"), srv("c", "PESTAÑAS")])).toEqual(
      ["Pestañas"]
    );
  });

  it("ignora las vacías y los espacios sueltos", () => {
    expect(categoriasDe([srv("a", null), srv("b", ""), srv("c", "   "), srv("d", "Uñas")])).toEqual(
      ["Uñas"]
    );
  });

  it("recorta los espacios de los lados", () => {
    expect(categoriasDe([srv("a", "  Cejas  ")])).toEqual(["Cejas"]);
  });

  /*
   * Incluye las de los archivados: si se reactiva un servicio, su categoría no
   * puede aparecer como si fuera nueva ni obligar a volver a escribirla.
   */
  it("incluye las categorías de los servicios archivados", () => {
    expect(categoriasDe([srv("a", "Uñas"), srv("b", "Depilación", "2026-08-01")])).toEqual([
      "Depilación",
      "Uñas",
    ]);
  });

  it("ordena en español (la ñ y las tildes en su sitio)", () => {
    expect(categoriasDe([srv("a", "Uñas"), srv("b", "Cejas"), srv("c", "Añadidos")])).toEqual([
      "Añadidos",
      "Cejas",
      "Uñas",
    ]);
  });

  it("sin servicios, no hay categorías", () => {
    expect(categoriasDe([])).toEqual([]);
  });
});
