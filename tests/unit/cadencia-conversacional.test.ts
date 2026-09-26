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

  /*
   * Doc 200 (26-sep-2026): el techo ya no es "un punto de un orden numerado"
   * —ese guion se retiró—, sino una regla por defecto sobre QUÉ va junto. Lo
   * que estas pruebas protegen sigue igual: ni el muro de Yuli, ni un
   * formulario de una pregunta por turno.
   */
  it("sin guion fijo: responde y pide lo que falta en el orden natural", () => {
    expect(CADENCIA).toMatch(/No hay un guion fijo/);
  });

  it("prohíbe el muro: no mezclar elegir lo que quiere con pedir datos personales", () => {
    expect(CADENCIA).toMatch(/No mezcles\*\* elegir lo que quiere con pedir datos personales/);
    expect(CADENCIA).toMatch(/ni le sueltes de golpe todo lo que falta/i);
  });

  it("NO degenera en 'una pregunta por mensaje': los datos de contacto y entrega van juntos", () => {
    expect(CADENCIA).toMatch(/datos de contacto y de entrega\*\*[\s\S]{0,200}pídelos juntos, en un solo mensaje/i);
    expect(CADENCIA).toMatch(/de TODO lo que pidió, en el mismo mensaje/);
  });

  it("contestar, recomendar o saludar no cuenta contra el techo", () => {
    expect(CADENCIA).toMatch(/contestar no cuenta como pedir/i);
  });
});

describe("la regla de absorción: el límite no alcanza al cliente", () => {
  it("dice que el límite es de lo que pide el bot, no de lo que da el cliente", () => {
    expect(CADENCIA).toMatch(/el límite es de lo que TÚ pides, nunca de lo que él te puede dar/i);
  });

  it("lo que el cliente adelanta se apunta y se da por resuelto", () => {
    expect(CADENCIA).toMatch(/apúntala toda y\s+dala por resuelta/i);
  });

  it("y no se le vuelve a preguntar después", () => {
    expect(CADENCIA).toMatch(/ni se la vuelvas a\s+preguntar después/i);
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

  it("remite a la regla de cómo pedir: los datos juntos, no un muro", () => {
    const t = requisitosParaElPrompt(REQS)!;
    expect(t).toMatch(/Cómo lo pides/);
    expect(t).not.toMatch(/su turno en el orden/i);
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

/**
 * Dos instrucciones viejas seguían contradiciendo a `CADENCIA` (22-sep-2026,
 * detectado en la auditoría del propio dueño antes de regenerar).
 *
 * Las dos nacieron el 17-ago-2026 contra un fallo real y distinto: el agente
 * hacía una RONDA DE PREGUNTAS POR PRODUCTO, y repetía cosas que el cliente ya
 * había contestado. La corrección de entonces fue "pregunta de todos a la vez",
 * y era correcta para ese eje.
 *
 * El problema es que había DOS ejes y solo se nombró uno. Resolver el punto
 * activo para TODOS los productos de golpe está bien —ese es el eje de las
 * cosas pedidas—; juntar el día, la hora y los datos personales en un mensaje
 * es el muro —ese es el eje de los puntos del orden—. Escritas como estaban,
 * las dos frases autorizaban lo segundo mientras pedían lo primero.
 *
 * Lo que se conserva intacto: anotarlo todo desde el primer mensaje, tratar
 * varios servicios como UNA visita para calcular el tiempo, y no repreguntar.
 */
describe("ningún bloque viejo contradice el techo de un punto por mensaje", () => {
  it("citas: ya no manda preguntar el día, la hora y los datos de una tacada", () => {
    // Día y hora son el punto 2; el nombre y el celular son el punto 4.
    expect(meta("citas")).not.toMatch(/una vez el día, una\s+vez la hora y una vez sus datos/i);
  });

  it("citas: varios servicios son una sola visita, sin una ronda por servicio", () => {
    const t = meta("citas");
    expect(t).toMatch(/Nada\s+de una ronda de preguntas por servicio/i);
    // Y lo que sí había que conservar de la lección del 17-ago sigue ahí.
    expect(t).toMatch(/una sola visita/i);
    expect(t).toMatch(/tiempo de todos juntos/i);
  });

  it("pedidos: ya no manda preguntar en UN mensaje lo que falte de cada cosa", () => {
    expect(meta("pedidos")).not.toMatch(/pregunta en UN mensaje lo que falte de cada cosa/i);
  });

  it("pedidos: las opciones de TODAS las cosas en el mismo mensaje", () => {
    const t = meta("pedidos");
    expect(t).toMatch(/pregunta las opciones de TODAS las cosas en el\s+mismo mensaje/i);
    // La lección del 17-ago que sí seguía siendo correcta.
    expect(t).toMatch(/anótalo todo de una vez/i);
    expect(t).toMatch(/no se lo vuelvas a preguntar/i);
  });

  it("EL DETECTOR DETECTA: las frases viejas disparan las comprobaciones de arriba", () => {
    // Sin esto, los cuatro `not.toMatch` de arriba estarían verdes aunque el
    // patrón no encontrara nada nunca — que es como un guardarraíl deja de
    // servir sin avisar (misma cautela que `generador-de-prompt.test.ts`).
    const viejoCitas =
      "**Anótalos todos** y trátalos como una sola visita: pregunta una vez el día, una\nvez la hora y una vez sus datos.";
    const viejoPedidos =
      "**Anótalo todo de una vez** y pregunta en UN mensaje lo que falte de cada cosa,\ndiciendo de cuál es cada pregunta.";
    expect(viejoCitas).toMatch(/una vez el día, una\s+vez la hora y una vez sus datos/i);
    expect(viejoPedidos).toMatch(/pregunta en UN mensaje lo que falte de cada cosa/i);
  });
});
