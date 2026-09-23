import { describe, expect, it } from "vitest";
import { CADENCIA, meta } from "@/server/ai/generador/conducta";
import { requisitosParaElPrompt } from "@/server/ai/prompts";

/**
 * El contrato de cadencia (22-sep-2026, MALIA con GPT-5 mini).
 *
 * Una clienta escribió *"para encargar por fa dos cremosos de 7 onzas / para
 * un detalle"* y el agente le devolvió, en un solo mensaje, las opciones, si
 * era regalo, el nombre, el celular, la modalidad de entrega y la forma de
 * pago. Un muro.
 *
 * La causa no era el modelo saltándose una regla: era la regla. `meta()`
 * decía literalmente *"agrupa lo que va junto"* y *"Una pregunta por mensaje
 * alarga el pedido y cansa"*, sin ningún techo. GPT-5 mini es más literal
 * que el modelo con el que se escribió esa frase y la aplicó hasta el final:
 * agrupó TODO.
 *
 * Lo que se arregla aquí NO es "que pregunte menos". Es poner un límite
 * explícito a lo que el agente PIDE —un punto del orden por mensaje— sin
 * tocar lo que el cliente puede DAR. Las dos mitades tienen que estar: solo
 * la primera convierte el chat en un formulario de una pregunta por turno,
 * que es el fallo contrario y cuesta lo mismo.
 */
describe("el contrato de cadencia limita lo que el bot PIDE", () => {
  it("pedidos: ya no queda la instrucción que invitaba a agrupar sin techo", () => {
    const t = meta("pedidos");
    expect(t).not.toMatch(/agrupa lo que va junto/i);
    expect(t).not.toMatch(/una pregunta por mensaje alarga/i);
  });

  it("citas: tampoco, y por la misma razón", () => {
    const t = meta("citas");
    expect(t).not.toMatch(/una pregunta por mensaje alarga/i);
    expect(t).not.toMatch(/pregúntale el día y la preferencia de persona\s*\n?\s*en el MISMO mensaje/i);
  });

  it("el techo es UN punto del orden por mensaje, y está escrito", () => {
    expect(CADENCIA).toMatch(/el primer punto que sigue sin resolver, y solo ese/i);
  });

  it("prohíbe explícitamente mezclar preguntas de dos puntos distintos", () => {
    expect(CADENCIA).toMatch(/nunca juntes preguntas de dos puntos/i);
  });

  it("NO degenera en 'una pregunta por mensaje': un punto puede llevar varias", () => {
    // El fallo contrario. Sin esta línea, el techo de arriba se lee como un
    // formulario de una pregunta por turno, que alarga el pedido igual.
    expect(CADENCIA).toMatch(/no es "una pregunta por mensaje"/i);
    expect(CADENCIA).toMatch(/varias preguntas si van juntas/i);
  });

  it("contestar, recomendar o saludar no cuenta contra el techo", () => {
    expect(CADENCIA).toMatch(/contestar no cuenta como pedir/i);
  });
});

describe("la regla de absorción: el límite no alcanza al cliente", () => {
  it("dice que el límite es de lo que pide el bot, no de lo que da el cliente", () => {
    expect(CADENCIA).toMatch(/el límite es de lo que TÚ pides, nunca de lo que él te puede dar/i);
  });

  it("lo que el cliente adelanta se apunta y da esos puntos por resueltos", () => {
    expect(CADENCIA).toMatch(/apúntala toda\s+y da esos puntos por resueltos/i);
  });

  it("y no se le vuelve a preguntar cuando llegue ese punto", () => {
    expect(CADENCIA).toMatch(/ni se\s+la vuelvas a preguntar cuando llegues ahí/i);
  });

  it("absorber hace SALTAR puntos: el siguiente objetivo es el primero en blanco", () => {
    expect(CADENCIA).toMatch(/saltar varios puntos de una vez/i);
  });
});

describe("los dos verticales llevan la MISMA doctrina", () => {
  it("pedidos y citas comparten el contrato literal, no una copia que derive", () => {
    expect(meta("pedidos")).toContain(CADENCIA);
    expect(meta("citas")).toContain(CADENCIA);
  });
});

/**
 * Los requisitos declarados por el negocio se leían como una orden de
 * preguntarlos YA ("Si todavía no te lo ha dado, pregúntaselo con reply"),
 * que es exactamente la munición del muro: una lista de datos + permiso para
 * pedirlos todos. Saber QUÉ hace falta para cerrar y decidir QUÉ se pide en
 * este mensaje son dos cosas distintas, y el texto tiene que separarlas.
 */
describe("los requisitos de cierre no son la lista de preguntas de este turno", () => {
  const REQS = [
    { id: "nombre", etiqueta: "Nombre de quien viene", obligatorio: true },
    { id: "cedula", etiqueta: "Número de documento", obligatorio: true },
  ];

  it("se rotulan como requisitos para CERRAR, no como lo que toca preguntar", () => {
    const t = requisitosParaElPrompt(REQS)!;
    expect(t).toMatch(/antes de cerrar/i);
    expect(t).toMatch(/no es la lista de lo que preguntas en este mensaje/i);
  });

  it("remite al orden y al techo de un punto por mensaje", () => {
    const t = requisitosParaElPrompt(REQS)!;
    expect(t).toMatch(/cuando le toque su turno en el orden/i);
  });

  it("mantiene intacta la parte que SÍ era correcta: la acción que guarda el dato", () => {
    const t = requisitosParaElPrompt(REQS)!;
    expect(t).toContain("provide_requirement");
    expect(t).toMatch(/sin\s+esta acción el dato NO se guarda/i);
  });

  it("sigue ausente cuando el negocio no declaró nada obligatorio", () => {
    expect(requisitosParaElPrompt(undefined)).toBeNull();
    expect(requisitosParaElPrompt([{ id: "x", etiqueta: "y", obligatorio: false }])).toBeNull();
  });
});
