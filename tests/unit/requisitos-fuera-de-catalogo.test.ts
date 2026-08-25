import { describe, expect, it } from "vitest";
import {
  fusionarRequisitosDelCatalogo,
  type Requisito,
} from "@/server/ai/generador/ficha";

/**
 * "Datos que deben solicitarse antes de confirmar" solo gestiona el catálogo
 * de contacto (nombre/telefono/email/documento). Un negocio de pedidos con
 * domicilio migrado con `migrar:requisitos` puede tener además "direccion"
 * declarado — esa pantalla no lo pregunta, así que no debe borrarlo.
 *
 * Bug real (25-ago-2026, Lis): antes de esto, el schema de entrada rechazaba
 * con un 400 cualquier requisito fuera de las cuatro opciones del catálogo,
 * así que el negocio no podía guardar NADA en el cuestionario — y si solo se
 * hubiera relajado la validación sin tocar esta lógica, terminar el
 * cuestionario habría borrado "direccion" en silencio al reconstruir el
 * array solo desde el catálogo.
 */

const DIRECCION: Requisito = {
  id: "direccion",
  tipo: "direccion",
  etiqueta: "la dirección de entrega",
  obligatorio: true,
  soloSi: "entrega.haceDomicilios",
};

describe("fusionarRequisitosDelCatalogo", () => {
  it("preserva un requisito declarado fuera del catálogo de esta pantalla", () => {
    const resultado = fusionarRequisitosDelCatalogo(
      [{ id: "nombre" }, { id: "telefono" }],
      [{ id: "nombre", tipo: "texto", etiqueta: "x", obligatorio: true }, DIRECCION]
    );

    expect(resultado.some((r) => r.id === "direccion")).toBe(true);
  });

  it("aplica lo marcado en el catálogo (nombre y teléfono, no correo ni documento)", () => {
    const resultado = fusionarRequisitosDelCatalogo(
      [{ id: "nombre" }, { id: "telefono" }],
      [DIRECCION]
    );

    const ids = resultado.map((r) => r.id).sort();
    expect(ids).toEqual(["direccion", "nombre", "telefono"]);
  });

  it("sin requisitos previos, no inventa nada fuera de lo marcado", () => {
    const resultado = fusionarRequisitosDelCatalogo([{ id: "nombre" }], undefined);

    expect(resultado.map((r) => r.id)).toEqual(["nombre"]);
  });

  it("desmarcar un requisito del catálogo lo quita, sin tocar lo de fuera", () => {
    const resultado = fusionarRequisitosDelCatalogo(
      [{ id: "telefono" }],
      [
        { id: "nombre", tipo: "texto", etiqueta: "x", obligatorio: true },
        DIRECCION,
      ]
    );

    expect(resultado.some((r) => r.id === "nombre")).toBe(false);
    expect(resultado.some((r) => r.id === "direccion")).toBe(true);
    expect(resultado.some((r) => r.id === "telefono")).toBe(true);
  });
});
