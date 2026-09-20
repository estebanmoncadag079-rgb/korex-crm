import { describe, expect, it } from "vitest";
import {
  aSecciones,
  camposSinDueño,
  esPorSecciones,
  leerFicha,
  serializarComoEstaba,
} from "@/server/ai/generador/leer-ficha";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * Una ficha completa, con **todos** los campos del tipo rellenos.
 *
 * El tipo es `Required<FichaDelNegocio>` **a propósito, y es media prueba**: si
 * mañana alguien añade un campo a la ficha y no lo pone aquí, **esto ni siquiera
 * compila**. Sin eso, la comprobación de campos sin dueño dependía de que
 * alguien recordara actualizar este objeto — y el 20-ago-2026 no lo recordé: se
 * añadió `canales`, la prueba siguió en verde, y el campo se habría perdido al
 * guardar sin que nada avisara.
 */
const FICHA: Required<FichaDelNegocio> = {
  nombre: "Negocio de prueba",
  queVende: "Vende cosas.",
  ubicacion: "Una dirección",
  horario: { abre: "09:00", cierra: "18:00", dias: [1, 2, 3, 4, 5] },
  observacionesHorario: "El local abre una hora más tarde que el WhatsApp.",
  vertical: "pedidos",
  catalogo: "Algo — $10.000",
  duracionTipicaMin: 30,
  variantes: "OPCIONES: a · b",
  entrega: { haceDomicilios: true, como: "En moto" },
  canales: [{ nombre: "Una app de domicilios", enlace: "https://ejemplo.test/negocio" }],
  pago: { formas: "transferencia", compruebaUnaPersona: true },
  tono: "cercano",
  regalos: "Sí, con tarjeta.",
  saludoInicial: "Hola",
  menu: { opciones: [{ id: "pedido", etiqueta: "Hacer un pedido" }] },
  reglasPropias: ["una regla propia"],
  preguntasFrecuentes: [{ pregunta: "¿abren domingo?", respuesta: "no" }],
  escalarSiempre: ["un reclamo"],
  nuncaPrometer: ["algo que no se puede"],
  cierre: {
    requisitos: [
      { id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true },
    ],
  },
};

describe("el formato en que se guarda una ficha", () => {
  /**
   * 20-ago-2026: `aplicarFicha` es el ÚNICO camino que crea fichas (el alta y
   * `/admin` pasan por él) y serializaba con `serializarComoEstaba`, que
   * conserva el formato encontrado. Para una ficha nueva no hay nada que
   * conservar, así que caía al formato plano: **todo negocio nuevo nacía en el
   * formato anterior al 15-ago**, y solo se convertía a mano.
   */
  it("una ficha NUEVA nace por secciones, no en el formato viejo", () => {
    const guardado = JSON.parse(serializarComoEstaba(null, FICHA));
    expect(esPorSecciones(guardado)).toBe(true);
    expect(guardado).toHaveProperty("negocio");
    expect(guardado).toHaveProperty("flujo");
    expect(guardado).toHaveProperty("politicas");
  });

  it("y da igual si llega null, undefined o una cadena vacía", () => {
    for (const vacio of [null, undefined, "", "   "]) {
      expect(esPorSecciones(JSON.parse(serializarComoEstaba(vacio, FICHA)))).toBe(true);
    }
  });

  /**
   * La otra mitad de la regla, y la que protege a quien ya existe: rellenar un
   * formulario NO puede convertirle los datos a nadie. La conversión de una
   * ficha que ya existe sigue siendo un acto explícito (`convertir:ficha`).
   */
  it("una ficha PLANA que ya existe sigue plana", () => {
    const plana = JSON.stringify(FICHA);
    const guardado = JSON.parse(serializarComoEstaba(plana, FICHA));
    expect(esPorSecciones(guardado)).toBe(false);
    expect(guardado).toHaveProperty("nombre");
  });

  it("una ficha POR SECCIONES sigue por secciones", () => {
    const porSecciones = JSON.stringify(aSecciones(FICHA));
    expect(esPorSecciones(JSON.parse(serializarComoEstaba(porSecciones, FICHA)))).toBe(true);
  });

  it("una ficha ilegible se respeta como estaba: no se decide por ella", () => {
    const guardado = JSON.parse(serializarComoEstaba("{ esto no es json", FICHA));
    expect(esPorSecciones(guardado)).toBe(false);
  });

  /**
   * 🔴 La prueba que evita una pérdida silenciosa.
   *
   * `aSecciones` reparte los campos a mano y **descarta lo que no esté en la
   * lista**. Mientras la ficha nueva se guardaba plana eso no se notaba; desde
   * hoy, un campo sin sección desaparecería al guardarlo. Ya pasó una vez con
   * `escalarSiempre` y `nuncaPrometer` (ver el comentario de `camposSinDueño`).
   *
   * Si esta prueba falla, la respuesta NO es quitarla: es asignar el campo
   * nuevo a su sección en `SECCIONES`.
   */
  it("ningún campo de la ficha se queda sin sección — si no, se perdería al guardar", () => {
    const huerfanos = camposSinDueño(FICHA);
    expect(
      huerfanos,
      `estos campos no están en ninguna sección y se perderían al guardar: ${huerfanos.join(", ")}`
    ).toEqual([]);
  });

  /** Guardar y volver a leer no puede cambiar el contenido, solo la forma. */
  it("guardar una ficha nueva y releerla devuelve exactamente lo mismo", () => {
    const releida = leerFicha(serializarComoEstaba(null, FICHA));
    expect(releida).toEqual(FICHA);
  });
});
