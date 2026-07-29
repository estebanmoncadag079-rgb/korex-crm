import { describe, expect, it } from "vitest";

/**
 * Los guiones del Laboratorio arrastraron meses siendo de una ferretería
 * mexicana mientras los clientes reales vendían comida: el reporte evaluaba al
 * agente con preguntas que su negocio no podía responder.
 *
 * Estas pruebas fijan las dos reglas que evitan que vuelva a pasar: nada de
 * catálogos ajenos, y nada de productos concretos — el Laboratorio lo corre
 * cada cliente contra SU conocimiento.
 */

import {
  elegirRespuesta,
  PERSONAS,
  PERSONA_LABELS,
  reglasDe,
  RESPUESTAS_COMUNES,
} from "@/server/lab/personas";
import { HISTORY_LIMIT } from "@/server/ai/pipeline";
import { MAX_RESPUESTAS_REACTIVAS } from "@/server/lab/runner";

const guiones = PERSONAS.flatMap((p) => p.script).join(" \n ").toLowerCase();

describe("estructura de las personas", () => {
  it("son seis y sus claves no chocan", () => {
    expect(PERSONAS).toHaveLength(6);
    expect(new Set(PERSONAS.map((p) => p.key)).size).toBe(6);
  });

  it("cada persona tiene su teléfono sintético propio", () => {
    const phones = PERSONAS.map((p) => p.phone);
    expect(new Set(phones).size).toBe(phones.length);
    // Bloque reservado: ningún número real termina en tantos ceros seguidos.
    for (const phone of phones) expect(phone).toMatch(/0{8}\d$/);
  });

  it("ninguna se queda sin guión", () => {
    for (const p of PERSONAS) expect(p.script.length).toBeGreaterThanOrEqual(4);
  });

  it("el reporte sabe nombrar todas las personas", () => {
    for (const p of PERSONAS) expect(PERSONA_LABELS[p.key]).toBe(p.label);
  });
});

describe("los guiones no traen catálogos ajenos", () => {
  it("no queda rastro de la ferretería", () => {
    for (const palabra of [
      "taladro",
      "martillo",
      "desarmador",
      "clavos",
      "lijadora",
      "pintura",
      "tiner",
      "cemento",
      "mxn",
      "spei",
    ]) {
      expect(guiones).not.toContain(palabra);
    }
  });

  it("no nombra productos de un negocio concreto", () => {
    // Un guión que pida "una Besties" hace fallar a la pastelería por no tener
    // algo que nunca vendió: el juez lo marca rojo y el reporte miente.
    for (const producto of ["besties", "churrit", "family box", "torta de"]) {
      expect(guiones).not.toContain(producto);
    }
  });
});

describe("el comprador decidido puede llegar a cerrar el pedido", () => {
  const decidido = PERSONAS.find((p) => p.key === "comprador_decidido")!;
  const texto = decidido.script.join(" ").toLowerCase();

  it("da los datos que el agente necesita para avisar al equipo", () => {
    // Sin dirección ni forma de pago el agente no puede emitir notify_order, y
    // el escenario más importante del Laboratorio se quedaría a medias.
    expect(texto).toMatch(/carrera|calle|apartamento/);
    expect(texto).toMatch(/efectivo|transferencia|tarjeta/);
    expect(texto).toMatch(/domicilio|recoger/);
  });

  it("contesta cuando el agente le pide confirmar", () => {
    // El guion se acababa sin decir "sí": el agente esperaba una confirmación
    // que nunca llegaba y el pedido no salía hacia el equipo.
    const elegida = elegirRespuesta(
      reglasDe(decidido),
      new Set(),
      "*¿Está todo correcto, Churr@?* 😊"
    );
    expect(elegida?.texto.toLowerCase()).toMatch(/confirmo|as[ií] est[aá]/);
  });
});

/**
 * El simulacro era un diálogo de sordos: el agente preguntaba "¿qué salsa?" y
 * el cliente contestaba, imperturbable, la siguiente línea de su guion. Cada
 * pedido cerraba con "Salsa: POR CONFIRMAR · Teléfono: POR CONFIRMAR" y el juez
 * marcaba rojo — un rojo que era del banco de pruebas, no del agente.
 */
describe("el cliente simulado contesta lo que le preguntan", () => {
  const sinUsar = () => new Set<number>();

  it("da el teléfono que el agente le pide", () => {
    const elegida = elegirRespuesta(
      RESPUESTAS_COMUNES,
      sinUsar(),
      "¿Me confirmas tu número de contacto?"
    );
    expect(elegida?.texto).toMatch(/este mismo/i);
  });

  it("elige por el agente cuando le ofrecen opciones", () => {
    const elegida = elegirRespuesta(
      RESPUESTAS_COMUNES,
      sinUsar(),
      "¿Qué salsa prefieres?"
    );
    expect(elegida?.texto).toMatch(/recomienden/i);
  });

  it("solo reacciona a preguntas, no a menciones de paso", () => {
    // "Entrega: Carrera 15..." dentro de un resumen NO es una pregunta: si
    // disparara una respuesta, el cliente se pondría a hablar solo.
    const elegida = elegirRespuesta(
      RESPUESTAS_COMUNES,
      sinUsar(),
      "Listo. Dirección de entrega: Carrera 15 # 8-40."
    );
    expect(elegida).toBeNull();
  });

  it("no repite la misma respuesta dos veces", () => {
    const primera = elegirRespuesta(
      RESPUESTAS_COMUNES,
      sinUsar(),
      "¿Cuál es tu nombre?"
    );
    expect(primera).not.toBeNull();
    const repetida = elegirRespuesta(
      RESPUESTAS_COMUNES,
      new Set([primera!.indice]),
      "¿Cuál es tu nombre?"
    );
    expect(repetida?.indice).not.toBe(primera!.indice);
  });

  it("las reglas de la persona ganan a las comunes", () => {
    // El de modismos existe para probar que el agente entiende a quien escribe
    // mal: contestarle en español de manual lo desactivaría a mitad de charla.
    const modismos = PERSONAS.find((p) => p.key === "errores_modismos")!;
    const elegida = elegirRespuesta(
      reglasDe(modismos),
      sinUsar(),
      "¿Qué salsa prefieres?"
    );
    expect(elegida?.texto).toBe("la q ustedes vean parce");
  });

  it("ninguna respuesta común compromete a comprar", () => {
    // El preguntón de precios tiene que poder irse sin pedir nada: si una
    // respuesta común dijera "sí, confirmo", su escenario dejaría de existir.
    const comunes = RESPUESTAS_COMUNES.map((r) => r.responde.toLowerCase()).join(" ");
    expect(comunes).not.toMatch(/confirmo|lo quiero|s[ií], p[ií]delo/);
  });

  it("la conversación más larga posible cabe en la memoria del agente", () => {
    // Las respuestas reactivas alargan la charla, y el agente solo lee los
    // últimos HISTORY_LIMIT mensajes. Si un guion crece de más, la simulación
    // empieza a olvidar su propio principio y el juez califica a un agente
    // amnésico creyendo que califica al de producción. Este test es la alarma.
    const guionMasLargo = Math.max(...PERSONAS.map((p) => p.script.length));
    const delCliente = guionMasLargo + MAX_RESPUESTAS_REACTIVAS;
    expect(delCliente * 2).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it("las respuestas tampoco nombran productos concretos", () => {
    const texto = PERSONAS.flatMap((p) => p.respuestas ?? [])
      .concat(RESPUESTAS_COMUNES)
      .map((r) => r.responde.toLowerCase())
      .join(" ");
    for (const producto of ["besties", "churrit", "family box", "torta de"]) {
      expect(texto).not.toContain(producto);
    }
  });
});
