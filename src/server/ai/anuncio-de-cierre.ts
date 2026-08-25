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

/**
 * ¿Este texto le está diciendo al cliente que su CITA quedó agendada?
 *
 * Mismo problema que el cierre falso, con otra cara: el servidor sabe si la
 * cita existe —la escribe él—, pero quien redacta es un modelo, y un modelo
 * confirma cosas que no pasaron.
 *
 * **Caso real (7-ago-2026, probando el salón antes de su primer día)**: a un
 * "si confirmo" suelto, sin nada agendado en la conversación, respondió *"¡Te
 * agendamos para el jueves 13 de agosto a las 10:00 con Laura para Baño de
 * acrílico o poligel!"* — con `reply`, no con `book_appointment`. Se inventó
 * el servicio, el día, la hora y la especialista. **No se guardó ninguna
 * cita**, y la clienta se habría presentado a un salón que no la espera.
 *
 * El prompt ya lo prohíbe con todas las letras ("NUNCA digas quedaste
 * agendada usando reply"). No bastó: por eso se comprueba en el servidor.
 */
const ANUNCIOS_DE_CITA: RegExp[] = [
  /\b(?:qued(?:as|aste|ó|o)|est(?:ás|as))\s+agendad[oa]\b/i,
  // Sin `\b` al final: en JS no hay límite de palabra después de una vocal
  // acentuada, así que "te reservé" no matcheaba aunque "te reservamos" sí.
  /\bte\s+(?:la\s+)?(?:agend(?:amos|é|e)|reserv(?:amos|é|e)|apart(?:amos|é|e))/i,
  /\b(?:tu\s+)?cita\s+(?:ya\s+)?(?:qued(?:ó|o|a)|est[áa])\s+(?:agendada|confirmada|reservada|lista)\b/i,
  /\bcita\s+agendada\s+con\s+éxito\b/i,
  /\bya\s+(?:te\s+)?(?:la\s+)?(?:dej[éeo]|dejamos)\s+agendada\b/i,
];

export function anunciaCitaAgendada(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return ANUNCIOS_DE_CITA.some((re) => re.test(texto));
}

/** La corrección cuando confirmó una cita que nadie agendó. */
export const CORRECCION_DE_CITA_FANTASMA =
  "ALTO. Tu respuesta le dice al cliente que su cita quedó agendada, pero NO emitiste book_appointment ni reschedule_appointment en este turno: la cita NO existe y el cliente se presentaría un día que nadie lo espera. Si tienes servicio, fecha y hora confirmados por el cliente, emite la ACCIÓN de verdad. Si te falta algún dato o el cliente no ha confirmado, pregúntaselo con reply SIN dar nada por agendado. Responde ÚNICAMENTE el objeto JSON.";

/* ============================================================
 * Prometió un recurso y nunca lo envió (18-ago-2026)
 * ============================================================ */

/**
 * El agente escribe "te comparto nuestro catálogo" —o "aquí tienes la foto"—
 * con `reply`, sin haber emitido `send_image`: el cliente lee la promesa y no
 * recibe nada, ni el archivo ni el enlace.
 *
 * Mismo patrón que la cita fantasma, con otra cara: el servidor sabe si un
 * recurso se mandó de verdad —lo decide `send_image`, la única acción que
 * ejecuta un envío—, pero quien redacta es un modelo, y confirma un envío
 * que no hizo.
 *
 * **Medido en producción (18-ago-2026), corrigiendo un primer filtro
 * demasiado amplio** (capturaba "te comparto nuestras delicias" —un menú en
 * texto de La Churra, sin ningún recurso de por medio— como si fuera el mismo
 * fallo): con el filtro exacto —promete "catálogo", "foto", "imagen", "PDF" o
 * "documento"— el patrón apareció en **3 conversaciones de dos negocios
 * distintos**, y solo 1 de cada 6 promesas ejecutó de verdad `send_image`. Una
 * de esas conversaciones **no era de pruebas**: una clienta con una cita real
 * agendada el 14-ago pidió el catálogo el 18-ago y el fallo ocurrió en vivo,
 * minutos antes de escribir esto. No es un problema de una sola conversación
 * contaminada — a diferencia del guardarraíl del horario que se descartó ese
 * mismo día por la misma clase de medición.
 */
const VERBO_DE_ENVIO = "(?:comparto|env[ií]o|muestro|adjunto|mando|paso)";

/**
 * Palabras que casi siempre implican un ARCHIVO o recurso visual, no un simple
 * listado en texto. "Menú" y "carta" quedan fuera a propósito: un negocio de
 * pedidos dice "te muestro nuestro menú: [precios en texto]" todo el tiempo
 * sin que exista ningún PDF detrás, y eso es una respuesta correcta — es
 * justo el falso positivo que la primera versión de este filtro cometió.
 */
const RECURSO_VISUAL = "(?:cat[áa]logo|foto(?:s)?|imag(?:en|enes)|pdf|documento)";

/*
 * Sin `\b` tras `est[áa]`: en JS no hay límite de palabra después de una vocal
 * acentuada (mismo motivo por el que `ANUNCIOS_DE_CITA` no lo usa tras
 * "reservé"/"agendé") — con él, "Aquí está la foto" no cazaba.
 */
const PROMETE_RECURSO: RegExp[] = [
  // "te comparto/envío/muestro... [el/la/nuestro(a)(s)]... catálogo/foto/PDF"
  new RegExp(
    `\\bte\\s+${VERBO_DE_ENVIO}\\b[^.!?]{0,40}?\\b${RECURSO_VISUAL}\\b`,
    "i"
  ),
  // "aquí tienes/está el catálogo/la foto..."
  new RegExp(
    `\\baqu[íi]\\s+(?:te\\s+)?(?:tienes\\b|est[áa])[^.!?]{0,30}?\\b${RECURSO_VISUAL}\\b`,
    "i"
  ),
];

/**
 * `true` si el texto le promete al cliente un catálogo, una foto o un
 * documento — sin decir si de verdad se mandó (eso lo decide la acción, no
 * el texto: ver el uso en `pipeline.ts`).
 *
 * Se evalúa ORACIÓN por oración, no el texto entero de un tirón: una promesa
 * cumplida no debe camuflarse por una pregunta en otra parte del mismo
 * mensaje, y una oferta ("¿te envío el catálogo?") no debe contar como
 * promesa solo porque el signo de interrogación queda lejos, al final de la
 * frase, y no pegado a la palabra del recurso.
 */
export function prometeRecurso(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    return PROMETE_RECURSO.some((re) => re.test(oracion));
  });
}

/** La corrección cuando promete un recurso sin haber emitido `send_image`. */
export const CORRECCION_DE_RECURSO_PROMETIDO =
  'ALTO. Tu respuesta le dice al cliente que le compartes un catálogo, una foto o un documento, pero NO emitiste send_image en este turno: nada se envía y el cliente se queda esperando algo que nunca llega. Si el recurso está en la lista de FOTOS QUE PUEDES ENVIAR, emite send_image con su etiqueta EXACTA, copiada tal cual de esa lista. Si no hay ninguna con ese nombre, dilo con reply y NO prometas un envío que no puedes cumplir. Responde ÚNICAMENTE el objeto JSON.';

/* ============================================================
 * Producto que desaparece del pedido (9-ago-2026)
 * ============================================================ */

/**
 * El cliente pide un tamaño, el agente le pregunta los toppings, el cliente
 * nombra OTRO tamaño — y el primero se esfuma del pedido sin que nadie lo note.
 *
 * **Caso real (Lis, 8-ago-2026)**: "Cremoso de 7 Oz" → el agente pregunta el
 * topping → "Quiero un cremoso de 16 Oz" → *"¡Qué delicia! Un Cremoso de 16
 * oz…"*. El de 7 oz nunca volvió a aparecer. El cliente no lo nota hasta el
 * resumen, si es que lo nota: se paga uno y se esperaban dos.
 *
 * Se intentó primero por prompt (regla en el contrato de acciones). Verificado
 * contra el pipeline real: **funciona cuando el cliente dice "y también uno de
 * 16", y NO cuando dice "quiero un cremoso de 16"** — justo el caso reportado.
 * Tercer guardarraíl que acaba en el servidor por lo mismo que los otros dos:
 * el prompt no basta.
 *
 * Se detecta por la MEDIDA (7 oz, 16 oz, 500 ml…) y no por el nombre del
 * producto, porque es lo que distingue las variantes que se confunden entre sí
 * y no depende del catálogo de cada negocio.
 */
const MEDIDA = /(\d{1,4})\s*(oz|onz|onzas?|ml|cc|lt?|litros?|gr?|gramos?|kg|cm|pulgadas?)\b/gi;

/** Medidas normalizadas que aparecen en un texto: "7 Oz" y "7oz" → "7oz". */
export function medidasEn(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const encontradas = new Set<string>();
  for (const m of texto.matchAll(MEDIDA)) {
    encontradas.add(`${m[1]}${m[2]!.toLowerCase()}`);
  }
  return [...encontradas];
}

/**
 * El cliente dijo explícitamente que CAMBIA de opción. Ahí sustituir es lo
 * correcto y el guardarraíl debe callarse.
 */
const CAMBIO_EXPLICITO =
  /\b(mejor|en\s+vez|en\s+lugar|c[áa]mbi(?:a|alo|amelo)|cambio|no,?\s+mejor|ya\s+no\s+quiero|cancela)\b/i;

/**
 * ¿La respuesta se olvidó de un producto que seguía vivo?
 *
 * Devuelve las medidas que el agente tenía sobre la mesa y ha dejado caer.
 * Vacío = todo en orden.
 */
export function productosOlvidados(input: {
  /** Lo que el agente dijo en su turno anterior (ahí está lo que estaba en curso). */
  ultimaRespuestaDelAgente: string | null | undefined;
  /** Lo que el cliente ha escrito sin responder todavía. */
  mensajesDelCliente: string[];
  /** Lo que el agente va a contestar ahora. */
  respuestaNueva: string;
}): string[] {
  // Si el cliente anuncia un cambio, sustituir es lo que toca.
  if (input.mensajesDelCliente.some((t) => CAMBIO_EXPLICITO.test(t))) return [];

  const enCurso = medidasEn(input.ultimaRespuestaDelAgente);
  if (enCurso.length === 0) return [];

  const nuevasDelCliente = input.mensajesDelCliente.flatMap(medidasEn);
  // Solo interesa cuando el cliente introdujo una medida DISTINTA: ahí es donde
  // el modelo sustituye en silencio.
  const introdujoOtra = nuevasDelCliente.some((m) => !enCurso.includes(m));
  if (!introdujoOtra) return [];

  const enLaRespuesta = medidasEn(input.respuestaNueva);
  return enCurso.filter((m) => !enLaRespuesta.includes(m));
}

/** La corrección cuando se dejó caer un producto que el cliente ya había pedido. */
export const CORRECCION_DE_PRODUCTO_OLVIDADO =
  "ALTO. El cliente ya había pedido un producto y en tu respuesta desapareció: solo hablas del último que nombró. No lo sustituyas por tu cuenta. Si el cliente lo está SUMANDO, lleva los DOS y pide lo que falte de cada uno. Si no está claro si lo suma o lo cambia, pregúntaselo en UNA línea ('¿te lo agrego al de antes o lo cambiamos?') sin descartar nada todavía. Responde ÚNICAMENTE el objeto JSON.";

/* ============================================================
 * El resumen mal armado (12-ago-2026)
 * ============================================================ */

/**
 * El resumen del pedido sale roto, de dos maneras que son la misma:
 *
 * **A · `cierre-prematuro`** — el agente pide confirmar el pedido y en el MISMO
 * mensaje se despide, como si el cliente ya hubiera dicho que sí. Para él la
 * conversación terminó ahí: cuando el cliente contesta "confirmo", **nunca
 * manda los datos de pago**. Alguien del equipo tiene que escribirlos a mano —
 * y al escribir desde el celular activa el relevo humano, que silencia al
 * agente 2 horas. De ahí el círculo: el bot falla el cierre, la dueña
 * interviene, y su intervención apaga al bot.
 *
 * **B · `sin-contenido`** — anuncia "aquí está el resumen de tu pedido" y no
 * escribe ningún resumen: sin productos, sin total, sin la regla del domicilio.
 * El cliente confirma a ciegas algo que no vio.
 *
 * **Medido en producción (Lis Pastelería, 31-jul a 12-ago)**: de 24 resúmenes,
 * **19 con cierre prematuro (79 %)** y **3 sin contenido (12 %)**. La Churra,
 * con otra estructura de prompt: 0 de 12.
 *
 * **La causa raíz era del prompt y se corrigió allí primero** (12-ago): las dos
 * plantillas —la de antes de confirmar y la de después— vivían pegadas en la
 * misma sección, así que el modelo las leía como un bloque y las concatenaba.
 * Se partieron en "MOMENTO 1" y "MOMENTO 2" con un corte explícito, y se
 * verificó contra el pipeline real que el flujo completo salía bien.
 *
 * Este guardarraíl es la RED, no el arreglo: existe porque el fallo llevaba
 * dos semanas costando pedidos y la dueña ya había perdido la confianza en el
 * agente. Si el prompt cumple, no salta nunca y no cuesta nada.
 *
 * Como `productosOlvidados`, **no deriva a una persona** si insiste: se
 * registra y sale como está. Sacar a un humano en cada pedido sería peor.
 */

/** Marcas de que el mensaje está pidiendo confirmar el pedido. */
const PIDE_CONFIRMAR: RegExp[] = [
  /confirma\s+tu\s+pedido/i,
  /¿\s*est[áa]\s+todo\s+correcto\s*\?/i,
];

/** Marcas de que anuncia un resumen. */
const ANUNCIA_RESUMEN: RegExp[] = [
  /resumen\s+de\s+tu\s+pedido/i,
  /aqu[íi]\s+(?:est[áa]|tienes)\s+(?:el\s+)?resumen/i,
];

/**
 * Un total con cifra. Es lo que distingue un resumen de verdad de un anuncio
 * vacío: puede faltar cualquier viñeta, pero un resumen sin total no es nada.
 */
/**
 * Un resumen de verdad lleva su total con la cifra.
 *
 * Se exporta porque el pipeline lo usa para saber si el cliente llegó a VER un
 * resumen antes de que el agente cerrara el pedido (guardarraíl del 14-ago).
 */
export const TIENE_TOTAL = /total\s*:?\s*\*?\s*\$\s*[\d][\d.,]*/i;

/**
 * Marcas INEQUÍVOCAS del mensaje de despedida (el que va DESPUÉS de confirmar).
 *
 * Se eligen a propósito frases que solo existen en esa plantilla. "Gracias por
 * elegirnos" quedó fuera aunque aparece en la despedida: también abre resúmenes
 * legítimos ("¡Gracias por elegirnos, Leidy! Aquí está el resumen…"), y un
 * guardarraíl que salta de más molesta en las conversaciones sanas.
 */
const MARCAS_DE_DESPEDIDA: RegExp[] = [
  /marca\s*0\s*para\s+volver\s+a\s+empezar/i,
  // "todo" opcional a propósito: el caso real de Leidy decía "ya lo estamos
  // preparando con mucho amor para ti", sin esa palabra. Dar el pedido por
  // puesto en marcha ANTES de que el cliente confirme es el fallo, lleve o no
  // la palabra exacta de la plantilla.
  /estamos\s+preparando\s+(?:todo\s+)?con\s+mucho\s+amor/i,
  /para\s+el\s+pago\s*:/i,
  /\bllave\s*:?\s*\*?\s*\d{6,}/i,
];

export type FalloDeResumen = "cierre-prematuro" | "sin-contenido" | null;

/** Qué le pasa al resumen que el agente va a mandar. `null` = está bien. */
export function resumenMalArmado(
  texto: string | null | undefined
): FalloDeResumen {
  if (!texto) return null;

  const pideConfirmar = PIDE_CONFIRMAR.some((re) => re.test(texto));
  const anunciaResumen = ANUNCIA_RESUMEN.some((re) => re.test(texto));
  if (!pideConfirmar && !anunciaResumen) return null;

  // A: pide confirmar y ya se despide (o suelta los datos de pago) en el mismo
  // mensaje. Es el fallo caro: deja al cliente sin saber a dónde transferir.
  if (pideConfirmar && MARCAS_DE_DESPEDIDA.some((re) => re.test(texto))) {
    return "cierre-prematuro";
  }

  /*
   * B: anuncia un resumen —o pide que lo confirmen— y no hay total.
   *
   * Lo de pedir confirmación cuenta igual desde el 14-ago: el agente repasó el
   * pedido y remató con "¿Está todo correcto?" SIN la cifra. El cliente estaba
   * confirmando un precio que nadie le dijo.
   */
  if ((anunciaResumen || pideConfirmar) && !TIENE_TOTAL.test(texto)) {
    return "sin-contenido";
  }

  return null;
}

/** La corrección cuando el resumen sale mal armado. */
export function correccionDeResumen(fallo: FalloDeResumen): string {
  if (fallo === "cierre-prematuro") {
    return "ALTO. En el MISMO mensaje le pides al cliente que confirme su pedido y ya te despides (o le das los datos de pago). Son DOS momentos distintos: el cliente todavía NO ha confirmado. Tu mensaje debe TERMINAR justo después de preguntar si está todo correcto — sin despedida, sin 'marca 0', sin datos de pago, sin decir que ya lo estás preparando. Esos textos van en el mensaje SIGUIENTE, cuando el cliente diga que sí. Reescribe SOLO el resumen y la petición de confirmación. Responde ÚNICAMENTE el objeto JSON.";
  }
  return "ALTO. Anuncias el resumen del pedido pero no escribiste ningún resumen: falta el detalle y falta el total. El cliente no puede confirmar algo que no ve. Escribe el resumen COMPLETO con el formato de tus instrucciones: cada producto con su cantidad y precio, los toppings, los datos de entrega, la línea del domicilio si aplica, y el total con la cifra. Responde ÚNICAMENTE el objeto JSON.";
}

/** "¿cuánto es el total?" en las formas en que la gente lo pregunta de verdad. */
const PIDE_EL_TOTAL =
  /(cu[aá]nto (es|ser[ií]a|me sale|sale|vale|queda|cuesta)( el| en)? (total|todo)|cu[aá]l (es|ser[ií]a) el total|el total\s*\?|cu[aá]nto es en total|cu[aá]nto te debo)/i;

/**
 * La SUMA, anunciada como tal. No vale enumerar los precios sueltos.
 *
 * Caso real: preguntaron el total de dos productos y el agente contestó "un
 * Polvoroso cuesta $19.000 y un Cremoso $12.000" — los datos estaban, la
 * respuesta no. Quien pregunta el total quiere una cifra, no una lista para
 * sumar de cabeza.
 */
const HAY_TOTAL =
  /(total|suma|son|ser[ií]an?|en total)[^.\n]{0,25}\$\s*\d|\$\s*[\d.,]+[^.\n]{0,15}(en total|de total)/i;

/**
 * ¿Le preguntaron el total y contestó sin darlo?
 *
 * Medido el 14-ago en Lis, en dos escenarios distintos: *"¿cuánto es el
 * total?"* y el agente respondió *"solo necesito que me confirmes el topping"*.
 * El topping no cambia el precio. Su prompt ya se lo prohibía —"si te pregunta
 * cuánto es el total, dale el total"— y lo hizo igual: es de esas órdenes que el
 * modelo incumple porque le parece más ordenado terminar el pedido primero.
 *
 * Solo cuenta si el agente **ya había nombrado algún precio**: si preguntan el
 * total antes de pedir nada, lo correcto es preguntar qué quiere, no inventar
 * una cifra.
 */
export function noDioElTotal(input: {
  mensajesDelCliente: string[];
  respuesta: string;
}): boolean {
  if (!input.mensajesDelCliente.some((m) => PIDE_EL_TOTAL.test(m))) return false;
  return !HAY_TOTAL.test(input.respuesta);
}

/**
 * La corrección cuando le piden el total y no lo da.
 *
 * Contempla los dos casos a propósito. La primera versión solo saltaba si el
 * agente ya había escrito precios, y se le escapó el caso real: el cliente pidió
 * *"un polvoroso de 12 y un cremoso de 7"* —los dos en su catálogo— y el agente
 * respondió pidiendo el topping sin haber nombrado una sola cifra antes. Podía
 * sumar perfectamente: los precios están en su conocimiento, no hacía falta que
 * los hubiera escrito.
 *
 * Ahora salta siempre que pidan el total sin recibirlo, y es la corrección la
 * que distingue: si de verdad no hay nada pedido, que pregunte qué quiere. Así
 * no se le empuja nunca a inventarse una cifra.
 */
export const CORRECCION_SIN_TOTAL =
  "ALTO. El cliente te preguntó CUÁNTO ES EL TOTAL y no se lo diste. Si ya te dijo qué quiere, suma lo que tiene pedido con los precios de tu conocimiento y dale la cifra AHORA, aunque falten detalles que no cambian el precio (el topping, el sabor, si es regalo). Si falta algo que SÍ cambia el precio, dale el total de lo que hay y di qué falta por sumar. Solo si todavía no ha pedido nada, pregúntale qué desea — pero nunca te inventes una cifra. Responde ÚNICAMENTE el objeto JSON.";

/** La corrección cuando el agente cierra un pedido que el cliente nunca vio. */
export const CORRECCION_SIN_RESUMEN =
  "ALTO. Vas a dar el pedido por cerrado y el cliente NUNCA ha visto un resumen: en esta conversación no le has enseñado qué pidió ni cuánto suma. Que él escriba \"confirmo\" no confirma nada si no hay nada que confirmar — y el equipo recibiría un pedido sin producto, sin datos y sin total. Antes de cerrar, muéstrale el resumen completo con lo que lleva, sus opciones, los datos de entrega y el total con la cifra, y pídele que confirme. Si todavía te falta algún dato, pídeselo en vez del resumen. Responde ÚNICAMENTE el objeto JSON.";

/* ============================================================
 * Requisito declarado sin cumplir, y la acción ya está cerrando
 * (19-ago-2026)
 * ============================================================
 *
 * El octavo guardarraíl, y el primero que corre en LOS DOS verticales con
 * el mismo código: `book_appointment` y `notify_order` comparten el mismo
 * hueco (ninguno exige nada declarado cuando `stateSource='prompt'`, que es
 * toda la flota real — auditado en
 * docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md).
 *
 * A diferencia de los otros siete, este no detecta nada en el TEXTO: la
 * comprobación es de datos (`faltantes()`, en `server/contacts.ts`), así
 * que vive en `pipeline.ts`, junto a la llamada que la resuelve. Aquí solo
 * vive el mensaje de corrección, igual que los demás.
 */

/**
 * La corrección cuando faltan requisitos obligatorios antes de cerrar.
 *
 * Cubre los dos casos a la vez: si el cliente YA dio el dato en su mensaje
 * (lo más común — "soy Valentina, quiero la cita a las 3"), pide
 * `provide_requirement`; si no, pide preguntarlo con `reply`. Nunca
 * `book_appointment`/`notify_order` en este mismo turno: ambos exigen que
 * el requisito ya esté satisfecho ANTES de intentarlos de nuevo.
 */
export function correccionDeRequisitoFaltante(faltan: { id: string; etiqueta: string }[]): string {
  const lista = faltan.map((r) => `${r.id} (${r.etiqueta})`).join(", ");
  return `ALTO. Antes de cerrar, este negocio necesita: ${lista}. Si el cliente ya te lo dio en su mensaje (mira lo que acaba de escribir), emite {"action":"provide_requirement","requisitoId":"<el id exacto de arriba>","valor":"<lo que dijo>","reply":"..."} — "reply" es tu respuesta normal para seguir la conversación. Si no te lo ha dado, pregúntaselo con reply y NO ejecutes la acción de cierre en este turno: solo cuando ya tengas el dato. Responde ÚNICAMENTE el objeto JSON.`;
}

/* ============================================================
 * Confirmó una especialista sin haber consultado disponibilidad
 * (19-ago-2026)
 * ============================================================
 *
 * *"¡Perfecto! Un retoque de Volumen Ruso con Hilary. ¿Para qué día y hora
 * te gustaría agendar?"* — Hilary no atiende ese servicio, y el modelo
 * nunca llamó a `consult_availability` para comprobarlo. Es la misma
 * familia que `prometeRecurso`: narra en vez de ejecutar. Otro caso real el
 * mismo día, más caro: el agente le dio a una clienta 3 horas concretas
 * para DOS especialistas distintas en el mismo mensaje ("Podríamos
 * agendarte... con Geimar... a las 3:30pm. Y a tu mami... con Laura...
 * 4:00pm o 4:30pm"), sin una sola llamada de por medio.
 *
 * A diferencia de los guardarraíles anteriores, este **no adivina por
 * texto**. Medir contra mensajes reales de la flota (docs/korexia/
 * 105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md) mostró que un regex de
 * "frases de confirmación" habría disparado con preguntas legítimas como
 * *"¿Qué tipo de servicio te gustaría agendar con Valentina?"* — el mismo
 * texto que confirma bien ("¡Perfecto! ... con Hilary.") también aparece en
 * respuestas correctas, así que el TEXTO solo no basta.
 *
 * Lo que sí es un hecho, no una interpretación: `pipeline.ts` ya sabe
 * cuántas veces se llamó a `consult_availability` EN ESE TURNO (la
 * variable `consultas` del bucle que resuelve la acción interna). Si es
 * cero y la respuesta AFIRMA algo mencionando a una especialista real
 * —no lo pregunta—, es una promesa sin verificar. Comprobar el hecho, no
 * el prompt.
 */

/**
 * ¿Esta respuesta AFIRMA algo (no lo pregunta) nombrando a una especialista
 * real de este negocio?
 *
 * Se evalúa por ORACIÓN, igual que `prometeRecurso`: una pregunta legítima
 * sobre qué servicio agendar con alguien ("¿Qué tipo de servicio te
 * gustaría agendar con Valentina?") no debe camuflarse por llevar el
 * nombre — la promesa está en la oración, no en la palabra suelta.
 *
 * `nombresReales` son los `staffNames` de los servicios de ESTE negocio —
 * nunca un nombre hardcodeado: el mismo negocio decide quiénes existen.
 */
export function afirmaConEspecialistaSinVerificar(
  texto: string | null | undefined,
  nombresReales: string[]
): boolean {
  if (!texto || nombresReales.length === 0) return false;
  const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nombresNorm = new Set(nombresReales.map(normalizar));
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    const palabras = normalizar(oracion).split(/[^a-z0-9]+/);
    return palabras.some((p) => nombresNorm.has(p));
  });
}

/*
 * ============================================================
 * Niega disponibilidad sin haber consultado (19-ago-2026)
 * ============================================================
 *
 * Mitad simétrica de la de arriba: en vez de prometer de más, el agente
 * NIEGA de más. Medido contra los mensajes reales de Lashes Valen antes de
 * escribir el criterio (docs/korexia/109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md):
 * 7 candidatos, 4 alucinados y 3 legítimos — y dos de los legítimos
 * revelaron el riesgo real: negar UNA HORA PUNTUAL que el cliente propuso
 * puede apoyarse, con razón, en lo que el propio agente ofreció en el turno
 * inmediato anterior ("tengo 2:00 PM" → cliente pide 6:30 → "esa hora no
 * está disponible" es una deducción válida, no una invención).
 *
 * Por eso el criterio NO cubre cualquier negación: solo las que además (a)
 * son categóricas — niegan TODO un periodo o TODOS los horarios, nunca una
 * hora puntual — o (b) no mencionan ninguna hora explícita, que es la marca
 * de una afirmación inventada de la nada y no una deducción sobre una hora
 * que el cliente sí propuso.
 */

/** Una hora explícita en el texto: "6:30 PM", "6:30", "las 2 pm". */
const HORA_EXPLICITA_EN_TEXTO =
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.?\s*m\.?|p\.?\s*m\.?)\b|\b\d{1,2}:\d{2}\b/i;

/**
 * Negaciones categóricas: "ese horario ya no está disponible" (referencia
 * vaga, sin la hora al lado — a diferencia de "a las 6:30 PM no está
 * disponible", que sí la nombra), o negar TODO un periodo o TODOS los
 * horarios de una vez.
 */
const NIEGA_DISPONIBILIDAD: RegExp[] = [
  // "ese horario/esa hora/esa cita ya no está disponible"
  /\b(?:ese|esa|el|la)\s+(?:horario|hora|cita)\b[^.!?]{0,15}\bno\s+est(?:á|a)\s+disponible\b/i,
  // "ya no ten(go|emos) citas/horarios/cupo/disponibilidad ... disponibles"
  /\b(?:ya\s+)?no\s+ten(?:go|emos)\b[^.!?]{0,25}\b(?:citas?|horarios?|disponibilidad|cupo)\b[^.!?]{0,25}\bdisponibles?\b/i,
  // "no ten(go|emos) ningún horario/ninguna disponibilidad"
  /\bno\s+ten(?:go|emos)\s+ning(?:ún|una)\b[^.!?]{0,20}\b(?:horario|disponibilidad|cita|cupo)\b/i,
  // "ya no ten(go|emos) disponibilidad" (sin repetir la palabra "disponible" dos veces)
  /\b(?:ya\s+)?no\s+ten(?:go|emos)\s+disponibilidad\b/i,
];

/**
 * `true` si el texto niega disponibilidad de forma categórica — nunca por
 * una hora puntual que el cliente haya podido proponer, que se excluye a
 * propósito (ver arriba).
 */
export function niegaDisponibilidadSinVerificar(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    if (HORA_EXPLICITA_EN_TEXTO.test(oracion)) return false;
    return NIEGA_DISPONIBILIDAD.some((re) => re.test(oracion));
  });
}

/** La corrección cuando confirma o niega disponibilidad sin haberla consultado. */
export const CORRECCION_DE_DISPONIBILIDAD_SIN_VERIFICAR =
  "ALTO. Tu respuesta afirma o niega disponibilidad (con una especialista, un horario o un periodo) sin haber llamado a consult_availability en este turno para comprobarlo: podrías estar equivocado, en cualquiera de los dos sentidos, y el cliente se queda con algo que no es cierto — puede perder una venta real o presentarse a una cita que no existe. Si el cliente ya te dio el servicio, llama a consult_availability con ese servicio (y esa especialista, si la mencionó) AHORA, antes de decir nada más. Si todavía no sabes el servicio, pregúntaselo con reply sin afirmar ni negar nada todavía. Responde ÚNICAMENTE el objeto JSON.";

/*
 * ============================================================
 * Confirma un pago que nadie verificó (24-ago-2026)
 * ============================================================
 *
 * **Caso real (Lis Pastelería, 24-ago-2026)**: la clienta escribió "Pago por
 * nequi" —declarando el MEDIO que iba a usar, sin comprobante todavía— y el
 * agente respondió *"¡Recibimos tu pago con éxito! 🎉 Ya estamos preparando
 * tu pedido con mucho amor..."*. No existía ningún pago: ni comprobante, ni
 * verificación humana, ni una acción de cobro — nada. El prompt YA lo
 * prohibía con todas las letras ("NUNCA des un pago por bueno... no digas
 * 'pago confirmado', 'ya me llegó' ni 'listo, recibido el dinero'" —
 * `prompts.ts`) y no bastó, la misma lección que la cita fantasma y el
 * cierre falso: una regla crítica que vive solo en el prompt, el modelo la
 * incumple.
 *
 * **Medido contra 82 respuestas reales de los tres negocios** (60 días,
 * filtradas por "pago", "comprobante", "nequi", "daviplata",
 * "transferencia", "bancolombia", "llave"): el patrón correcto SIEMPRE
 * habla de recibir el COMPROBANTE y pasarlo a verificar ("recibimos tu
 * comprobante... lo pasamos al equipo para que lo verifiquen"; "estamos
 * validando tu pago"). Ni una sola vez, en 82 mensajes reales, el agente
 * dice "recibimos tu pago" a secas — la única excepción es este incidente.
 * Por eso el detector no necesita saber si hubo o no un `[COMPROBANTE]` en
 * el turno: no hay una forma legítima de decirlo así en este proyecto,
 * comprobante real o no (el prompt pide "pasarlo a verificar" incluso
 * cuando SÍ llegó uno).
 */

const CONFIRMA_PAGO: RegExp[] = [
  // "recibimos/recibí tu pago" — nunca "recibimos tu comprobante (de
  // pago)", que ya queda fuera porque la oración con "comprobante" se
  // descarta antes de probar estos patrones.
  /\brecib(?:imos|[íi]|iste|ió)\s+(?:tu\s+|el\s+|su\s+)?pago\b/i,
  // "pago con éxito / exitoso / confirmado / recibido correctamente"
  /\bpago\s+(?:ha\s+sido\s+|fue\s+)?(?:con\s+[ée]xito|exitoso|confirmado|recibido\s+correctamente)\b/i,
  // "confirmamos/confirmo tu pago" — no "tu pedido" ni "tu cita", que sí
  // son afirmaciones correctas y no las toca este patrón.
  /\bconfirm(?:amos|o)\s+(?:tu\s+|el\s+|su\s+)?pago\b/i,
  // "ya (nos/te) llegó tu pago"
  /\b(?:ya\s+)?(?:nos\s+|te\s+)?lleg[óo]\s+(?:tu\s+|el\s+|su\s+)?pago\b/i,
];

/**
 * `true` si el texto afirma que un pago se recibió, llegó o se confirmó.
 *
 * Por oración, igual que `prometeRecurso` y compañía: una pregunta legítima
 * ("¿cómo confirmo el pago?", típica de un FAQ) no debe camuflarse por
 * llevar las mismas palabras, y una oración que ya habla de "comprobante"
 * —recibirlo, pasarlo a verificar— es exactamente el patrón correcto, no el
 * fallo.
 */
export function confirmaPagoSinVerificar(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    if (/comprobante/i.test(oracion)) return false;
    return CONFIRMA_PAGO.some((re) => re.test(oracion));
  });
}

/** La corrección cuando el agente da un pago por recibido sin que nadie lo haya verificado. */
export const CORRECCION_DE_PAGO_SIN_VERIFICAR =
  "ALTO. Tu respuesta le dice al cliente que su pago fue recibido, confirmado o exitoso, y eso NO es cierto: tú no puedes verificar un pago, ni viendo un comprobante — puede estar retocado, ser de otro pedido o de otra cuenta. NUNCA digas 'pago confirmado', 'recibimos tu pago' ni 'ya nos llegó'. Si el cliente mandó un comprobante, dile que lo pasas al equipo para verificarlo y sigue con el pedido con normalidad. Si el cliente solo dijo CÓMO va a pagar (por ejemplo 'pago por nequi', sin comprobante todavía), pídele que haga la transferencia y te envíe la captura — no des nada por pagado. Responde ÚNICAMENTE el objeto JSON.";
