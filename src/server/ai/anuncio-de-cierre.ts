/**
 * ¿Este texto le está diciendo al cliente que el negocio NO está atendiendo?
 *
 * Existe porque el estado del negocio lo calcula el servidor con certeza, pero
 * quien redacta el mensaje es un modelo — y un modelo puede contradecir un dato
 * cierto. Pasó en producción el 29 jul 2026: el agente respondió "ya cerramos,
 * queda reagendado para mañana" a las 12:42, ese mensaje quedó en el historial
 * de la conversación, y a partir de ahí lo repitió palabra por palabra a las
 * 12:54 y a las 14:04 con el negocio ABIERTO. Medido contra el modelo real con
 * ese historial: 5 de cada 6 turnos reproducían el cierre falso, pese a que el
 * prompt decía ABIERTO tres veces (arriba, en las instrucciones y en el
 * recordatorio final). Un cliente que quiere comprar HOY y lee "cerramos" se va.
 *
 * Se usa en dos sitios y por eso vive aparte: para limpiar el historial que ve
 * el agente (`toChatHistory`) y para frenar el mensaje antes de que salga
 * (`runAgentTurn`).
 */

/**
 * Afirmaciones de "no estamos atendiendo". Cada una exige el estado PRESENTE:
 * informar la hora de cierre es correcto y no debe activarlas.
 */
const ANUNCIOS_DE_CIERRE: RegExp[] = [
  // "ya cerramos" / "ya cerró" — pero NO "ya cerramos a las 8:30 pm", que es
  // decir el horario, ni "cerramos a las 8:30": eso es informar, no cerrar.
  /\bya\s+cerra(?:mos|ron)\b(?!\s*(?:a\s+la|al?\s+las?|\d))/i,
  /\bya\s+(?:est(?:amos|á|a)\s+)?cerrad[oa]s?\b/i,
  /\bestamos\s+cerrad[oa@]s?\b/i,
  /\bcerramos\s+por\s+hoy\b/i,
  /\bcerrad[oa@]s?\s+por\s+hoy\b/i,
  /\bya\s+no\s+(?:estamos\s+)?(?:atendemos|atendiendo|estamos\s+atendiendo)\b/i,
  /\bfuera\s+de(?:l)?\s+(?:nuestro\s+)?horario\b/i,
  // Reagendar solo existe en este proyecto para el caso "cerrado".
  /\breagenda(?:d[oa]s?|r|mos|remos)\b/i,
  /\bapenas\s+abr(?:amos|imos)\b/i,
  /\bcuando\s+abr(?:amos|imos)\b/i,
  /\babrimos\s+mañana\b/i,
  /\bmañana\s+(?:apenas\s+)?abr(?:imos|amos)\b/i,
];

/**
 * `true` si el texto le anuncia al cliente que el negocio no atiende ahora.
 *
 * Deliberadamente estrecho: solo frases que afirman el estado presente. Un falso
 * positivo silencia una respuesta buena (el turno se rehace y, si insiste, lo
 * toma una persona); un falso negativo deja salir la mentira que costó la venta.
 */
export function anunciaCierre(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return ANUNCIOS_DE_CIERRE.some((re) => re.test(texto));
}

/**
 * Lo que ve el agente en lugar de un mensaje suyo que ya no es cierto.
 *
 * No se borra ni se omite: quitar el turno le hace perder el hilo de a qué
 * responde el cliente. Se conserva la posición y el envoltorio de acción —que es
 * lo que le mantiene el formato— y se le retira solo la frase copiable, diciéndole
 * por qué. Sin esto, el modelo prefiere ser coherente con lo que ya escribió
 * antes que con el dato que le da el sistema.
 */
export const MENSAJE_RETIRADO =
  "(mensaje retirado por el sistema: anunciaba un cierre que NO corresponde — el negocio está ABIERTO ahora mismo. No lo repitas ni te bases en él.)";

/**
 * La corrección que se le da al agente cuando su respuesta anunciaba un cierre
 * falso, para que rehaga el turno. Va como mensaje de sistema al final: es lo
 * último que lee y no ensucia el historial guardado.
 */
export const CORRECCION_DE_CIERRE_FALSO =
  "ALTO. Tu respuesta anterior le anunciaba al cliente que el negocio cerró o que su pedido queda para mañana, y eso es FALSO: el negocio está ABIERTO ahora mismo (lo calcula el sistema, no es opinión). Reescribe tu respuesta atendiendo con normalidad, sin mencionar cierres, reagendamientos ni horarios de apertura. Responde ÚNICAMENTE el objeto JSON.";
