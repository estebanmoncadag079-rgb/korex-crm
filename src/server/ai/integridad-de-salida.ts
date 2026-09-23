/**
 * La última comprobación antes de que un texto salga hacia el cliente.
 *
 * ## Por qué hace falta una capa más
 *
 * 22-sep-2026, MALIA con GPT-5 mini: una respuesta llegó a WhatsApp con
 * `}]}]}` pegado al final y restos del formato interno del modelo. Lo primero
 * que se miró fue por qué el adaptador la dejó pasar — y la respuesta es que
 * hizo exactamente lo que le toca. `extractJson` comprueba que haya un objeto
 * JSON; Zod comprueba que ese objeto cumpla el contrato. **Las dos cosas son
 * ciertas de un objeto impecable cuyo campo `reply` trae basura DENTRO de las
 * comillas.** La validación estructural no opina sobre el texto, y nadie más
 * lo estaba mirando.
 *
 * Por eso esto es una capa aparte y no un parche en el adaptador: el adaptador
 * valida la FORMA de la respuesta; esto valida el CONTENIDO que va a leer una
 * persona. Son dos preguntas distintas y fallan por motivos distintos.
 *
 * ## Por qué es tan corto de manga
 *
 * Un falso positivo aquí no es un mensaje feo: es un cliente que pregunta un
 * precio y recibe "te paso con una persona". Cuesta lo mismo que el fallo que
 * intenta evitar. Así que el detector solo reconoce **lo que ningún mensaje de
 * WhatsApp de verdad contiene**, y cada motivo está atado a evidencia real:
 *
 * - `resto-estructural` y `texto-interno` salen del caso medido.
 * - `truncado` no es una heurística: lo dice el proveedor (`finish_reason`).
 * - `vacio` es una respuesta que no existe.
 *
 * Deliberadamente NO detecta: repetición degenerada (un párrafo que se repite
 * cuatro veces), texto en otro idioma, ni "respuestas malas". Lo primero no se
 * ha visto todavía en este sistema y su umbral es justo el tipo de número que
 * se inventa y empieza a bloquear listas legítimas; los otros dos no tienen
 * detector honesto aquí. Ver docs/korexia/190.
 *
 * ## Qué NO es esto
 *
 * No es el salvavidas de cierre (`recuperacion-de-turno.ts`, Gemini): aquel
 * rescata un pedido que el modelo no cerró, y corre al final del turno. Esto
 * mira un string y dice si se puede enviar. Son capas independientes y no se
 * llaman entre sí.
 */

export type MotivoDeDegeneracion =
  /** Cierres de JSON sin nada que cierren: el caso real `}]}]}`. */
  | "resto-estructural"
  /** Vocabulario de la máquina en un texto para una persona. */
  | "texto-interno"
  /** El proveedor cortó la respuesta a mitad (`finish_reason: "length"`). */
  | "truncado"
  /** No hay texto que enviar. */
  | "vacio";

export type Degeneracion = {
  motivo: MotivoDeDegeneracion;
  /** Lo que lo delató, recortado para que quepa en un log sin ahogarlo. */
  evidencia: string;
};

/**
 * Restos del andamiaje de JSON.
 *
 * Tres o más llaves/corchetes seguidos. Por sí solo daría falsos positivos con
 * un JSON legítimo escrito como texto (`{"a":{"b":[1]}}` termina en `]}}`), así
 * que además se exige que el texto esté DESCUADRADO —más cierres que
 * aperturas—, que es lo que distingue un resto arrastrado de un ejemplo bien
 * escrito.
 */
const RACHA_ESTRUCTURAL = /[{}[\]]{3,}/g;

/**
 * Lo que solo existe del lado de la máquina.
 *
 * `"action":` con comillas y dos puntos, no la palabra "acción": el contrato
 * colándose en el texto, no alguien hablando de una acción.
 */
const TEXTO_INTERNO = /response_format|json_schema|<\|[a-z_]+\|>|"action"\s*:|```json/i;

function recortar(s: string, n = 120): string {
  const limpio = s.replace(/\s+/g, " ").trim();
  return limpio.length > n ? `${limpio.slice(0, n)}…` : limpio;
}

function descuadrado(texto: string): boolean {
  let abiertos = 0;
  let cerrados = 0;
  for (const c of texto) {
    if (c === "{" || c === "[") abiertos++;
    else if (c === "}" || c === "]") cerrados++;
  }
  return cerrados > abiertos;
}

/**
 * ¿Este texto es basura que no puede llegar al cliente?
 *
 * Función pura: no lee estado, no llama a nadie, no registra nada. Devuelve
 * `null` cuando el texto se puede enviar — que es el caso de la inmensa
 * mayoría, y el que hay que proteger.
 *
 * `finishReason` es lo que informó el proveedor en ESA llamada, cuando se
 * tiene. Sin él, el detector sigue funcionando con lo que se ve en el texto.
 */
export function textoDegenerado(
  texto: string,
  opts?: { finishReason?: string | null }
): Degeneracion | null {
  if (texto.trim().length === 0) {
    return { motivo: "vacio", evidencia: "(sin texto)" };
  }

  // Primero lo que dice el proveedor: es un hecho, no una inferencia sobre el
  // texto, y explica POR QUÉ salió mal cuando además hay restos.
  if (opts?.finishReason === "length") {
    return { motivo: "truncado", evidencia: recortar(texto.slice(-120)) };
  }

  const rachas = texto.match(RACHA_ESTRUCTURAL);
  if (rachas && descuadrado(texto)) {
    const peor = rachas.reduce((a, b) => (b.length > a.length ? b : a));
    return { motivo: "resto-estructural", evidencia: recortar(peor) };
  }

  const interno = texto.match(TEXTO_INTERNO);
  if (interno) {
    return { motivo: "texto-interno", evidencia: recortar(interno[0]) };
  }

  return null;
}

/**
 * El primer texto degenerado de un lote, o `null` si todos se pueden enviar.
 *
 * Una acción puede llevar más de un texto al cliente (`notify_order` manda el
 * resumen al equipo y la despedida al cliente), y basta con que UNO esté roto
 * para que el turno no sirva: enviar la mitad buena de un cierre es peor que
 * no enviar nada, porque el cliente se queda creyendo que su pedido existe.
 */
export function primerTextoDegenerado(
  textos: string[],
  opts?: { finishReason?: string | null }
): Degeneracion | null {
  for (const t of textos) {
    const d = textoDegenerado(t, opts);
    if (d) return d;
  }
  return null;
}

/**
 * Lo que se le dice al modelo cuando su respuesta salió corrompida.
 *
 * Pide **la misma respuesta**, no una nueva: el contenido que había decidido
 * dar suele estar bien y lo que falló fue cómo lo emitió. Dejarlo libre para
 * replantear el turno cambiaría la conversación por un problema de formato, y
 * un turno reescrito desde cero es justo lo que hace que un cliente reciba una
 * respuesta que no viene a cuento de lo que preguntó.
 *
 * Vive aquí y no en `anuncio-de-cierre.ts` (donde están las demás
 * correcciones) porque no es un guardarraíl de conducta: es la corrección que
 * acompaña a ESTE detector, y separarlos es como se acaba con una corrección
 * que ya no describe lo que su detector detecta.
 */
export const CORRECCION_DE_SALIDA_DEGENERADA = [
  "STRICT: tu respuesta anterior salió corrompida (restos del formato de",
  "respuesta, texto interno del sistema, o cortada a mitad) y NO se envió.",
  "Vuelve a dar la MISMA respuesta que ibas a dar: la misma acción y el mismo",
  "contenido, solo que con el texto limpio y completo. No replantees el turno",
  "ni cambies de tema. Responde ÚNICAMENTE el objeto JSON del contrato.",
].join(" ");
