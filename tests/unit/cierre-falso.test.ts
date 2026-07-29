import { describe, expect, it } from "vitest";

/**
 * El 29 jul 2026 el agente de La Churra le dijo a un cliente, a las 2:04 de la
 * tarde y con el negocio abierto desde las 12:30, que "ya cerramos" y que su
 * pedido "queda reagendado para mañana".
 *
 * El horario estaba bien configurado y el prompt decía ABIERTO tres veces. Lo
 * que falló: a las 12:42 el agente había mandado ese mismo mensaje en esa misma
 * conversación, y a partir de ahí lo repitió palabra por palabra en cada turno
 * — prefiere ser coherente con lo que ya dijo antes que con el dato del sistema.
 * Medido contra el modelo real de producción con el historial real:
 * 5 de cada 6 turnos reproducían el cierre falso. Sin ese historial: 0 de 8.
 *
 * Estas pruebas cubren las dos barreras que se pusieron: retirarle del historial
 * lo que ya no es cierto, y no dejar salir el mensaje si aun así lo escribe.
 */

import { anunciaCierre, MENSAJE_RETIRADO } from "@/server/ai/anuncio-de-cierre";
import { textosAlCliente, toChatHistory } from "@/server/ai/pipeline";

const CIERRE_FALSO =
  "¡Hola Churr@! 💛 En este momento ya cerramos, pero tranquil@: te tomo el pedido ahora mismo y *queda reagendado para mañana apenas abramos (12:30 pm)* 🥨✨";

describe("detectar que un mensaje anuncia un cierre", () => {
  it("caza el mensaje exacto que salió a producción", () => {
    expect(anunciaCierre(CIERRE_FALSO)).toBe(true);
  });

  it.each([
    "En este momento ya cerramos",
    "estamos cerrados por hoy",
    "Ya estamos cerrad@s, Churr@",
    "tu pedido queda reagendado para mañana",
    "te lo preparamos apenas abramos",
    "te escribo cuando abramos",
    "abrimos mañana a las 12:30",
    "ya no estamos atendiendo",
    "nos escribiste fuera del horario de atención",
  ])("caza: %s", (texto) => {
    expect(anunciaCierre(texto)).toBe(true);
  });

  /**
   * Los falsos positivos no son gratis: silencian una respuesta correcta y, si
   * se repiten, mandan la conversación a una persona. Informar el horario es
   * justo lo que el negocio quiere que haga, y dice "cerramos" en la frase.
   */
  it.each([
    "Nuestro horario es de 12:30 pm a 8:30 pm",
    "Hoy cerramos a las 8:30 pm, así que llegas de sobra",
    "Ya cerramos a las 8:30 pm todos los días",
    "¡Sí, estamos abiertos ahora mismo!",
    "No cerramos al mediodía, atendemos corrido",
    "Abrimos todos los días desde las 12:30",
    "¡Hola Churr@! ¿Qué se te antoja?",
    "Tu pedido sale en 30 minutos",
  ])("no se activa con: %s", (texto) => {
    expect(anunciaCierre(texto)).toBe(false);
  });

  it("no se cae con texto vacío ni nulo", () => {
    expect(anunciaCierre(null)).toBe(false);
    expect(anunciaCierre(undefined)).toBe(false);
    expect(anunciaCierre("")).toBe(false);
  });
});

describe("historial curado cuando el negocio está abierto", () => {
  it("le retira el texto del cierre falso que él mismo escribió", () => {
    const turno = toChatHistory(
      [{ direction: "out", text: CIERRE_FALSO, aiGenerated: true }],
      "abierto"
    )[0]!;
    expect(turno.role).toBe("assistant");
    expect(JSON.parse(turno.content).text).toBe(MENSAJE_RETIRADO);
    expect(turno.content).not.toContain("reagendado");
  });

  /**
   * Se retira el texto, NO el turno: si desaparece, el agente pierde a qué
   * responde el cliente en el mensaje siguiente.
   */
  it("conserva la posición y el envoltorio de acción", () => {
    const turnos = toChatHistory(
      [
        { direction: "in", text: "hola", aiGenerated: false },
        { direction: "out", text: CIERRE_FALSO, aiGenerated: true },
        { direction: "in", text: "Buena tarde", aiGenerated: false },
      ],
      "abierto"
    );
    expect(turnos.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.parse(turnos[1]!.content).action).toBe("reply");
  });

  it("con el negocio cerrado el mensaje era cierto y se mantiene", () => {
    const turno = toChatHistory(
      [{ direction: "out", text: CIERRE_FALSO, aiGenerated: true }],
      "cerrado"
    )[0]!;
    expect(JSON.parse(turno.content).text).toBe(CIERRE_FALSO);
  });

  it("sin horario configurado no inventa una corrección", () => {
    const turno = toChatHistory(
      [{ direction: "out", text: CIERRE_FALSO, aiGenerated: true }],
      null
    )[0]!;
    expect(JSON.parse(turno.content).text).toBe(CIERRE_FALSO);
  });

  it("no toca las respuestas buenas", () => {
    const buena = "¡Hola Churr@! 🥨 ¿Qué se te antoja?";
    const turno = toChatHistory(
      [{ direction: "out", text: buena, aiGenerated: true }],
      "abierto"
    )[0]!;
    expect(JSON.parse(turno.content).text).toBe(buena);
  });
});

/**
 * El guardrail mira TODO lo que el cliente puede acabar leyendo, no solo el
 * `reply`: una despedida o un resumen de pedido marcado como "reagendado para
 * mañana" con el negocio abierto manda a la cocina algo que nadie prepara hoy.
 */
describe("textos de una acción que llegan al cliente", () => {
  it("mira el texto de un reply", () => {
    expect(textosAlCliente({ action: "reply", text: CIERRE_FALSO })).toEqual([
      CIERRE_FALSO,
    ]);
  });

  it("mira la despedida de un handoff", () => {
    expect(
      textosAlCliente({ action: "handoff", reason: "cliente", farewell: CIERRE_FALSO })
    ).toContain(CIERRE_FALSO);
  });

  it("mira el resumen y la despedida de un pedido", () => {
    const textos = textosAlCliente({
      action: "notify_order",
      summary: "Churrita — Entrega: reagendada para mañana",
      farewell: "¡Gracias, Churr@!",
    });
    expect(textos.some(anunciaCierre)).toBe(true);
  });

  it("mira el reply opcional de update_lead y move_stage", () => {
    expect(
      textosAlCliente({ action: "update_lead", note: "n", reply: CIERRE_FALSO })
    ).toEqual([CIERRE_FALSO]);
    expect(
      textosAlCliente({ action: "move_stage", stage: "Interesado", reply: CIERRE_FALSO })
    ).toEqual([CIERRE_FALSO]);
  });

  it("no mira nada cuando el agente calla", () => {
    expect(textosAlCliente({ action: "none" })).toEqual([]);
    expect(textosAlCliente({ action: "handoff", reason: "cliente" })).toEqual([]);
  });
});
