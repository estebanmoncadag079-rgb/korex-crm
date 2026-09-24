import { describe, expect, it } from "vitest";
import { comoTexto } from "@/server/orders/extraer";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * Una ficha incompleta no puede escribir `undefined` en el prompt.
 *
 * Incidente real (Lis Pastelería, 23-sep-2026, conv cv_oyhwvt9l5vn4hm020mtb).
 * El bloque que lee el modelo en cada turno salía así:
 *
 *     PEDIDO EN CURSO — no vuelvas a preguntar nada de esto:
 *     1 × Cremoso 12 oz (topping: MARACUYÁ, LIMÓN) · undefined: ya está · …
 *
 * La causa está en el dato, no en el código: el requisito `direccion` de Lis
 * tiene `etiqueta` y `tipo` sin definir, mientras que los de La Churra y MALIA
 * los traen completos. Pero el núcleo no puede confiar en que una ficha esté
 * bien rellenada: **se corrige el dato Y se pone la guarda**, porque la ficha
 * la escribe una persona desde el CRM y siempre podrá quedar a medias.
 *
 * Por qué se cae al `id` y no se omite la línea: el propósito de este bloque
 * es "no vuelvas a preguntar nada de esto". Saltarse el requisito devolvería
 * al agente justo el comportamiento que queremos evitar —volver a pedir algo
 * que el cliente ya dio—, y `direccion` se lee bastante mejor que nada.
 *
 * `tipo` ausente se trata como dato PERSONAL (no se repite su valor en el
 * prompt, solo "ya está"). Es el lado seguro: ante la duda, un dato de una
 * persona no se copia.
 */
function conRequisitos(datos: Record<string, string>): EstadoDelPedido {
  return {
    ...estadoVacio(),
    items: [
      {
        ofrecible: { id: "p1", nombre: "Cremoso 12 oz" },
        cantidad: 1,
        seleccion: [],
        gruposDeclinados: [],
        totalCents: 1800000,
      },
    ],
    totalCents: 1800000,
    datos,
  };
}

/** Tal cual está hoy en la ficha de Lis: sin etiqueta y sin tipo. */
const REQUISITO_INCOMPLETO = {
  id: "direccion",
  obligatorio: true,
} as unknown as Requisito;

const REQUISITO_COMPLETO: Requisito = {
  id: "direccion",
  tipo: "direccion",
  etiqueta: "la direccion de entrega",
  obligatorio: true,
};

describe("comoTexto: una ficha a medias no ensucia el prompt", () => {
  it("BUG REAL: un requisito sin etiqueta NO puede imprimir 'undefined'", () => {
    const texto = comoTexto(conRequisitos({ direccion: "Cra 46B#51-28" }), [], [
      REQUISITO_INCOMPLETO,
    ]);
    expect(texto).not.toContain("undefined");
  });

  it("se cae al id del requisito, para no perder el 'no lo vuelvas a preguntar'", () => {
    const texto = comoTexto(conRequisitos({ direccion: "Cra 46B#51-28" }), [], [
      REQUISITO_INCOMPLETO,
    ]);
    expect(texto).toContain("direccion: ya está");
  });

  it("sin tipo, el valor se trata como PERSONAL y no se copia al prompt", () => {
    const texto = comoTexto(conRequisitos({ direccion: "Cra 46B#51-28" }), [], [
      REQUISITO_INCOMPLETO,
    ]);
    expect(texto).not.toContain("Cra 46B#51-28");
  });

  it("una etiqueta vacía o de puros espacios cuenta como ausente", () => {
    const enBlanco = { id: "direccion", tipo: "direccion", etiqueta: "   ", obligatorio: true } as Requisito;
    const texto = comoTexto(conRequisitos({ direccion: "Cra 5" }), [], [enBlanco]);
    expect(texto).not.toContain("undefined");
    expect(texto).toContain("direccion: ya está");
  });

  it("REGRESIÓN: una ficha bien configurada no cambia en nada", () => {
    const texto = comoTexto(conRequisitos({ direccion: "Cra 46B#51-28" }), [], [
      REQUISITO_COMPLETO,
    ]);
    expect(texto).toContain("la direccion de entrega: ya está");
    expect(texto).not.toContain("direccion: ya está");
  });

  it("REGRESIÓN: un requisito de tipo texto sigue mostrando su valor", () => {
    const nombre: Requisito = {
      id: "nombre",
      tipo: "texto",
      etiqueta: "el nombre de quien lo pide",
      obligatorio: true,
    };
    const texto = comoTexto(conRequisitos({ nombre: "Nicole" }), [], [nombre]);
    expect(texto).toContain("el nombre de quien lo pide: Nicole");
  });
});
