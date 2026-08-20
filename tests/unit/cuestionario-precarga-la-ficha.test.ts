import { describe, expect, it } from "vitest";
import { fusionarFicha, aSecciones } from "@/server/ai/generador/leer-ficha";
import { fusionarBorrador } from "@/server/ai/generador/aplicar";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * Lo que el cuestionario le hace a una ficha que YA existe.
 *
 * `leerBorrador` va a la base, así que no se prueba aquí: lo que sí se puede
 * demostrar sin base es la consecuencia que hacía urgente precargarla — que
 * enviar el cuestionario **reemplaza la sección `negocio` entera**, y partiendo
 * de un formulario en blanco eso borra en silencio lo que nadie volviera a
 * escribir (20-ago-2026).
 */
const APLICADA: FichaDelNegocio = {
  nombre: "Pastelería de prueba",
  queVende: "Vende postres.",
  ubicacion: "Carrera 47 #13b-03",
  horario: { abre: "10:00", cierra: "20:00", dias: [1, 2, 3, 4, 5, 6] },
  vertical: "pedidos",
  catalogo: "Cremoso 12 oz — $18.000",
  variantes: "TOPPINGS: MILO · OREO · AREQUIPE",
  entrega: { haceDomicilios: true, recogerEnLocal: "Sí, en el local" },
  pago: { formas: "transferencia", compruebaUnaPersona: true },
  tono: "Dulce y cercano",
  regalos: "Sí, con tarjeta de cumpleaños",
  saludoInicial: "¡Hola! Bienvenid@",
  reglasPropias: ["una regla propia del negocio"],
  preguntasFrecuentes: [{ pregunta: "¿hacen domicilio?", respuesta: "sí" }],
  escalarSiempre: ["un reclamo"],
  nuncaPrometer: ["pagar en efectivo"],
} as FichaDelNegocio;

/** Lo mínimo que alguien escribiría en un formulario que arrancó vacío. */
const DESDE_CERO = {
  nombre: "Pastelería de prueba",
  queVende: "Vende postres.",
  horario: { abre: "10:00", cierra: "20:00", dias: [1, 2, 3, 4, 5, 6] },
  vertical: "pedidos",
  catalogo: "Cremoso 12 oz — $18.000",
  tono: "Dulce y cercano",
} as FichaDelNegocio;

describe("qué muestra el cuestionario al abrirlo", () => {
  it("sin borrador, muestra la ficha que el agente está usando", () => {
    const visto = fusionarBorrador(APLICADA, null);
    expect(visto).toEqual(APLICADA);
  });

  /**
   * 🔴 El caso real que se escapó a la primera implementación.
   *
   * Un cliente había abierto el cuestionario —lo vio vacío— y escribió UNA
   * regla. Ese borrador de un solo campo no puede tapar una ficha completa:
   * devolverlo tal cual dejaba la pantalla igual de vacía que antes.
   */
  it("un borrador de UN campo no tapa la ficha entera: se pone encima", () => {
    const visto = fusionarBorrador(APLICADA, {
      reglasPropias: ["Tenemos domicilios por una app, este es el enlace"],
    });
    expect(visto.reglasPropias).toEqual(["Tenemos domicilios por una app, este es el enlace"]);
    expect(visto.tono).toBe(APLICADA.tono);
    expect(visto.regalos).toBe(APLICADA.regalos);
    expect(Object.keys(visto).length).toBe(Object.keys(APLICADA).length);
  });

  it("lo que la persona está editando gana sobre lo aplicado", () => {
    const visto = fusionarBorrador(APLICADA, { tono: "Lo estoy cambiando ahora" });
    expect(visto.tono).toBe("Lo estoy cambiando ahora");
  });

  it("un negocio nuevo, sin ficha ni borrador, sigue empezando en blanco", () => {
    expect(fusionarBorrador({}, null)).toEqual({});
  });
});

describe("enviar el cuestionario sobre una ficha que ya existe", () => {
  it("conserva SIEMPRE lo que el cuestionario no posee: flujo y políticas", () => {
    const { ficha, conservadas } = fusionarFicha(
      JSON.stringify(aSecciones(APLICADA)),
      DESDE_CERO,
      ["negocio"]
    );
    expect(conservadas).toEqual(["flujo", "politicas"]);
    expect(ficha.saludoInicial).toBe("¡Hola! Bienvenid@");
    expect(ficha.reglasPropias).toEqual(["una regla propia del negocio"]);
    expect(ficha.escalarSiempre).toEqual(["un reclamo"]);
    expect(ficha.nuncaPrometer).toEqual(["pagar en efectivo"]);
  });

  /**
   * 🔴 La razón de precargar, demostrada.
   *
   * `negocio` SÍ es del cuestionario, así que lo que llegue vacío se lleva por
   * delante lo que había. Con el formulario precargado esto no pasa —llega lo
   * mismo que estaba— pero la prueba deja escrito el precio de no hacerlo, por
   * si alguien piensa en quitar la precarga algún día.
   */
  it("un formulario en blanco SÍ borra lo suyo: por eso hay que precargarlo", () => {
    const { ficha } = fusionarFicha(JSON.stringify(aSecciones(APLICADA)), DESDE_CERO, ["negocio"]);
    expect(ficha.regalos).toBeUndefined();
    expect(ficha.variantes).toBeUndefined();
    expect(ficha.ubicacion).toBeUndefined();
  });

  it("y con el formulario precargado no se pierde nada", () => {
    // Es lo que ahora devuelve `leerBorrador` cuando no hay borrador: la ficha
    // aplicada, aplanada. Enviarla tal cual deja la ficha igual que estaba.
    const { ficha } = fusionarFicha(JSON.stringify(aSecciones(APLICADA)), APLICADA, ["negocio"]);
    expect(ficha).toEqual(APLICADA);
  });

  it("editar un campo cambia ese campo y solo ese", () => {
    const editada = { ...APLICADA, tono: "Más formal" };
    const { ficha } = fusionarFicha(JSON.stringify(aSecciones(APLICADA)), editada, ["negocio"]);
    expect(ficha.tono).toBe("Más formal");
    expect(ficha.regalos).toBe(APLICADA.regalos);
    expect(ficha.variantes).toBe(APLICADA.variantes);
    expect(ficha.saludoInicial).toBe(APLICADA.saludoInicial);
  });
});
