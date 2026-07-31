import { describe, expect, it } from "vitest";

/**
 * El embudo tiene que reflejar la realidad sin que nadie arrastre tarjetas: un
 * pedido confirmado que deja el lead en "Nuevo" convierte el tablero en un
 * adorno y falsea cualquier cuenta de cuántos cerraron.
 *
 * Lo que se prueba aquí es a DÓNDE se mueve, que es lo delicado: el cliente
 * puede renombrar, reordenar y agregar etapas desde el tablero, así que la
 * decisión no puede depender de los nombres sembrados.
 */

import {
  arranqueDelEmbudo,
  cierreDelEmbudo,
  type EtapaEmbudo,
} from "@/server/inbox/lead-activity";

/** El embudo que se siembra al dar de alta un cliente (provisioning). */
const SEMBRADO: EtapaEmbudo[] = [
  { id: "s1", position: 0, kind: "open" }, // Nuevo
  { id: "s2", position: 1, kind: "open" }, // En conversación
  { id: "s3", position: 2, kind: "open" }, // Interesado
  { id: "s4", position: 3, kind: "won" }, // Cliente
  { id: "s5", position: 4, kind: "lost" }, // Perdido
];

describe("arranque: de dónde a dónde sale un lead nuevo", () => {
  it("pasa de la primera etapa abierta a la segunda", () => {
    expect(arranqueDelEmbudo(SEMBRADO)).toEqual({
      desde: SEMBRADO[0],
      hacia: SEMBRADO[1],
    });
  });

  it("se guía por el orden, no por cómo lleguen de la consulta", () => {
    const desordenadas = [SEMBRADO[3]!, SEMBRADO[2]!, SEMBRADO[0]!, SEMBRADO[1]!];
    expect(arranqueDelEmbudo(desordenadas)).toEqual({
      desde: SEMBRADO[0],
      hacia: SEMBRADO[1],
    });
  });

  it("ignora las anclas de cierre aunque queden de primeras", () => {
    // Un cliente puede arrastrar "Cliente" al principio del tablero; ganar no
    // puede ser el destino de alguien que apenas escribió.
    const rara: EtapaEmbudo[] = [
      { id: "won", position: 0, kind: "won" },
      { id: "a", position: 1, kind: "open" },
      { id: "b", position: 2, kind: "open" },
    ];
    expect(arranqueDelEmbudo(rara)).toEqual({
      desde: rara[1],
      hacia: rara[2],
    });
  });

  it("no mueve nada si solo hay una etapa abierta", () => {
    const minimo: EtapaEmbudo[] = [
      { id: "a", position: 0, kind: "open" },
      { id: "won", position: 1, kind: "won" },
    ];
    expect(arranqueDelEmbudo(minimo)).toBeNull();
  });

  it("aguanta un embudo vacío sin reventar", () => {
    expect(arranqueDelEmbudo([])).toBeNull();
  });
});

describe("cierre: dónde cae un pedido confirmado", () => {
  it("va a la etapa marcada como ganada, no a la última", () => {
    // "Perdido" queda después de "Cliente" en el orden sembrado: cerrar por
    // posición mandaría todas las ventas a la columna de perdidos.
    expect(cierreDelEmbudo(SEMBRADO)?.id).toBe("s4");
  });

  it("encuentra la etapa de cierre aunque la hayan movido de sitio", () => {
    const movida: EtapaEmbudo[] = [
      { id: "won", position: 9, kind: "won" },
      { id: "a", position: 0, kind: "open" },
    ];
    expect(cierreDelEmbudo(movida)?.id).toBe("won");
  });

  it("devuelve null si el embudo se quedó sin etapa de cierre", () => {
    const sinCierre: EtapaEmbudo[] = [
      { id: "a", position: 0, kind: "open" },
      { id: "b", position: 1, kind: "open" },
    ];
    expect(cierreDelEmbudo(sinCierre)).toBeNull();
  });
});

/**
 * Dónde NACE un lead, que es el caso que rompía el tablero.
 *
 * Lo normal es que escriba primero el cliente y el lead nazca en "Nuevo". Pero
 * el negocio también inicia conversaciones (retomar a alguien, responder algo
 * visto en otro sitio), y entonces los mensajes salen ANTES de que exista el
 * lead: no hay tarjeta que mover. Cuando el cliente por fin contestaba, el lead
 * nacía en "Nuevo" y se quedaba ahí aunque la conversación tuviera veinte
 * mensajes.
 *
 * Pasó en producción con el contacto 573005619176 el 30-jul-2026: dos mensajes
 * del negocio a las 16:40:13 y el lead creado a las 16:40:43.
 */
describe("dónde nace un lead según quién habló primero", () => {
  const arranque = arranqueDelEmbudo(SEMBRADO)!;

  /** Réplica de la decisión de `onLeadActivity`, sin tocar la base. */
  const etapaAlNacer = (yaLeEscribimos: boolean) =>
    yaLeEscribimos ? arranque.hacia.id : arranque.desde.id;

  it("si escribe primero el cliente, nace en la primera etapa", () => {
    expect(etapaAlNacer(false)).toBe("s1");
  });

  it("si el negocio ya le había escrito, nace en la segunda", () => {
    expect(etapaAlNacer(true)).toBe("s2");
  });

  it("nunca nace en una etapa de cierre, ni ganada ni perdida", () => {
    const cierres = SEMBRADO.filter((s) => s.kind !== "open").map((s) => s.id);
    expect(cierres).not.toContain(etapaAlNacer(true));
    expect(cierres).not.toContain(etapaAlNacer(false));
  });

  it("respeta el orden del cliente aunque renombre o reordene las etapas", () => {
    const reordenado: EtapaEmbudo[] = [
      { id: "z", position: 9, kind: "open" },
      { id: "a", position: 1, kind: "open" },
      { id: "m", position: 5, kind: "open" },
    ];
    const otro = arranqueDelEmbudo(reordenado)!;
    expect(otro.desde.id).toBe("a");
    expect(otro.hacia.id).toBe("m");
  });
});
