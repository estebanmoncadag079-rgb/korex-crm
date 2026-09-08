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

/*
 * ============================================================
 * "Handoff fantasma": promete un humano y la acción NO es `handoff`
 * ============================================================
 *
 * Fase 10T — mismo molde que `prometeRecurso` (18-ago-2026, catálogo
 * fantasma), aplicado al hallazgo de la auditoría de handoff: el prompt
 * (`generador/generar.ts`) le pide al modelo, para CUALQUIER derivación,
 * decir en una línea "te comunico con alguien del equipo" — pero nada
 * comprobaba que la acción emitida fuera de verdad `handoff`. Se confirmó un
 * caso real ya en código, no hipotético: `pipeline.ts` (reschedule con el
 * servicio de la cita ya borrado del catálogo) mandaba ese texto exacto con
 * un `reply` suelto, sin ningún handoff detrás — el agente seguía activo y
 * respondía normal al siguiente mensaje, dejando al cliente esperando a una
 * persona que nunca llega. Ese caso puntual ya se corrigió directamente en
 * `pipeline.ts`; este guardarraíl es la protección general para cualquier
 * otro camino (presente o futuro) que caiga en el mismo patrón.
 */
const VERBO_DE_DERIVACION = "(?:comunico|paso|conecto|derivo|transfiero)";
const HUMANO_DEL_EQUIPO =
  "(?:alguien(?:\\s+del\\s+equipo)?|una\\s+persona(?:\\s+del\\s+equipo)?|un\\s+asesor(?:a)?|el\\s+equipo)";

const PROMETE_HUMANO: RegExp[] = [
  // "te comunico/paso/conecto/derivo... con alguien/una persona/el equipo"
  new RegExp(`\\bte\\s+${VERBO_DE_DERIVACION}\\b[^.!?]{0,40}?\\bcon\\s+${HUMANO_DEL_EQUIPO}\\b`, "i"),
  // "alguien del equipo/una persona te atiende/contacta/escribe"
  new RegExp(`\\b${HUMANO_DEL_EQUIPO}\\s+te\\s+(?:atiende|contacta|escribe|responde)\\b`, "i"),
];

/**
 * `true` si alguna ORACIÓN (no una pregunta) promete un humano real. Mismo
 * criterio que `prometeRecurso`: por oración, ignorando preguntas — "¿quieres
 * que te comunique con alguien del equipo?" es una oferta, no una promesa.
 */
export function prometeHumanoSinDerivar(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    return PROMETE_HUMANO.some((re) => re.test(oracion));
  });
}

/** La corrección cuando promete un humano sin que la acción sea `handoff`. */
export const CORRECCION_DE_HUMANO_PROMETIDO =
  "ALTO. Tu respuesta le dice al cliente que lo vas a comunicar con una persona o con el equipo, pero tu acción NO es \"handoff\": nadie del equipo se entera y el cliente se queda esperando a alguien que nunca llega. Si de verdad hace falta derivar, cambia tu acción a \"handoff\" con ese mismo farewell. Si no hace falta derivar, no le prometas que lo vas a comunicar con una persona. Responde ÚNICAMENTE el objeto JSON.";

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

/**
 * Marcas de que el mensaje está pidiendo confirmar el pedido.
 *
 * Ampliado el 3-sep-2026: la frase real observada en producción —"¿Me
 * confirmas si todo está correcto para dejar tu pedido en firme?"— NO
 * matcheaba ninguna de las dos marcas originales (el patrón exigía
 * "correcto" pegado al signo de interrogación). Cualquier pregunta que
 * mencione "correcto" es, en este dominio, casi siempre una petición de
 * confirmar el pedido; "en firme" es un modismo específico de este negocio
 * para lo mismo, con o sin signo de interrogación.
 */
const PIDE_CONFIRMAR: RegExp[] = [
  /confirma\s+tu\s+pedido/i,
  /¿\s*est[áa]\s+todo\s+correcto\s*\?/i,
  /¿[^?]*\bcorrecto\b[^?]*\?/i,
  /\ben\s+firme\b/i,
];

/** Marcas de que anuncia un resumen. */
const ANUNCIA_RESUMEN: RegExp[] = [
  /resumen\s+de\s+tu\s+pedido/i,
  /aqu[íi]\s+(?:est[áa]|tienes)\s+(?:el\s+)?resumen/i,
];

/**
 * Un resumen de verdad lleva su total con la cifra.
 *
 * Se exporta porque el pipeline lo usa para saber si el cliente llegó a VER un
 * resumen antes de que el agente cerrara el pedido (guardarraíl del 14-ago).
 *
 * **Incidente real (6-sep-2026, Lucero Vallejo / Lis Pastelería, y una
 * segunda conversación de MALIA el mismo día)**: la versión anterior exigía
 * que tras la palabra "total" viniera INMEDIATAMENTE la cifra
 * (`total\s*:?\s*\*?\s*\$`). El prompt de Lis —escrito por el propio negocio
 * desde el CRM— pide literalmente *"seria algo como TOTAL SIN DOMICILIO: X
 * valor"*, así que su resumen real dice `*TOTAL SIN DOMICILIO:* $19.000`.
 * Con dos palabras de por medio, esta expresión NO reconocía el total, el
 * guardarraíl de `pipeline.ts` concluía "el cliente nunca vio un resumen" y
 * **bloqueaba un cierre legítimo**: el modelo emitía `notify_order`
 * correctamente tras el "Si esta bien" de la clienta, se le forzaba a
 * rehacer el turno, y volvía a mandar el MISMO resumen. La clienta confirmó
 * un pedido que nunca se registró (0 filas en `order_confirmation`), el
 * equipo nunca recibió el aviso automático y tuvo que cerrarlo a mano —
 * todo en silencio, sin handoff ni error en ningún log.
 *
 * Ahora se toleran palabras entre "total" y la cifra (`TOTAL SIN
 * DOMICILIO:`, `TOTAL A PAGAR:`, `TOTAL CON DOMICILIO:`), acotado a la MISMA
 * línea y sin cruzar otro `$`, para no convertirlo en un comodín que dé por
 * bueno cualquier cifra suelta del mensaje.
 */
export const TIENE_TOTAL = /total\b[^\n$]{0,40}\$\s*[\d][\d.,]*/i;

/**
 * Las formas en que una cifra en centavos puede aparecer escrita en un
 * mensaje real. `1900000` → `19.000` (es-CO, la que usa el propio agente),
 * `19,000` y `19000`.
 */
function formasDeLaCifra(cents: number): string[] {
  const pesos = Math.round(cents / 100);
  const conPuntos = pesos.toLocaleString("es-CO", { minimumFractionDigits: 0 });
  return [...new Set([conPuntos, conPuntos.replace(/\./g, ","), String(pesos)])];
}

/**
 * ¿El cliente llegó a VER un total antes de que el agente cerrara el pedido?
 *
 * Dos señales, en orden de fuerza — la primera no depende de CÓMO redacte su
 * resumen cada negocio, que es justo lo que falló el 6-sep-2026 (ver
 * `TIENE_TOTAL`):
 *
 * 1. **El hecho, no el formato**: si el backend ya calculó el total de este
 *    pedido contra el catálogo real (`conversation_state.estado.totalCents`,
 *    Fase 2 — validado por `normalizarPedido`, nunca un número que diga el
 *    modelo) y esa MISMA cifra aparece en algo que el agente ya le mostró al
 *    cliente, entonces el cliente vio el total. Da igual si el mensaje decía
 *    "TOTAL SIN DOMICILIO", "Total:" o "son 19.000 con todo".
 * 2. **Respaldo por texto**: para los negocios sin estado estructurado
 *    (`state_source='prompt'`, donde el backend no conoce ningún total), la
 *    expresión `TIENE_TOTAL` de siempre, ahora tolerante al formato.
 *
 * Mantiene intacta la protección original (14-ago-2026, "pedidos vacíos"): un
 * cierre donde el cliente no vio NINGUNA cifra —ni el backend calculó
 * ninguna— sigue bloqueándose.
 */
export function elClienteVioUnTotal(
  textosMostradosAlCliente: (string | null | undefined)[],
  totalCentsVerificado?: number | null
): boolean {
  const textos = textosMostradosAlCliente.filter((t): t is string => Boolean(t));

  if (typeof totalCentsVerificado === "number" && totalCentsVerificado > 0) {
    const formas = formasDeLaCifra(totalCentsVerificado);
    if (textos.some((t) => formas.some((f) => t.includes(f)))) return true;
  }

  return textos.some((t) => TIENE_TOTAL.test(t));
}

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

/* ============================================================
 * Confirmó y no se cerró (3-sep-2026)
 * ============================================================ */

/**
 * El cliente confirma el pedido ("Correcto", "Sí", "Dale"...) justo después
 * de que el agente le mostró el resumen y preguntó, y en vez de cerrarlo con
 * `notify_order` el modelo vuelve a mandar el MISMO resumen pidiendo
 * confirmar otra vez — como si no hubiera leído la respuesta.
 *
 * Incidente real documentado dos veces en el propio código: Natalia
 * (13-ago-2026, arriba, tres repeticiones hasta que una persona intervino a
 * mano) y uno reportado el 3-sep-2026 (dos repeticiones, mismo patrón).
 *
 * A diferencia de `resumenMalArmado`, aquí el mensaje nuevo del agente está
 * bien formado por sí solo (tiene total, no se despide de más) — el fallo es
 * que NO DEBIÓ mandarse: el cliente ya había dicho que sí. Por eso hace
 * falta mirar el TURNO ANTERIOR del agente y lo que contestó el cliente, no
 * solo el mensaje nuevo.
 *
 * `notify_order` NO tiene ninguna acción de servidor que lo dispare de forma
 * determinista — depende enteramente de que el modelo, leyendo texto libre,
 * decida invocarla. El prompt ya se lo indica (`conducta.ts`, "MOMENTO 2");
 * este guardarraíl es la red para cuando no obedece, igual que las otras
 * siete de este archivo.
 */

/**
 * Afirmación corta e inequívoca: el cliente contesta SOLO esto, no una frase
 * más larga que de casualidad contenga la palabra de paso (p. ej. "sí, pero
 * cámbiame el color" NO cuenta — ahí "sí" no es un cierre, es el inicio de
 * una corrección).
 */
const CONFIRMACION_CORTA =
  /^\s*(?:correcto|s[ií]|dale|listo|confirmo|vale|ok(?:ay)?|de\s+acuerdo|est[áa]\s+bien|perfecto)\s*[.!¡¿?]*\s*$/i;

export function esConfirmacionCorta(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return CONFIRMACION_CORTA.test(texto);
}

/** `true` si el texto pide confirmar el pedido — misma detección que usa `resumenMalArmado`, reutilizada, no duplicada. */
export function pideConfirmarPedido(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PIDE_CONFIRMAR.some((re) => re.test(texto));
}

/**
 * Se evalúa SOLO cuando las tres condiciones se dan juntas: el cliente
 * mandó EXACTAMENTE un mensaje este turno (no varios mezclados) y es una
 * confirmación corta; el último mensaje del agente ANTES de este turno ya
 * pedía confirmar el pedido; y la acción nueva del modelo, en vez de
 * `notify_order`, vuelve a pedir confirmar.
 */
export function confirmoPeroNoSeCerro(input: {
  ultimaRespuestaPrevia: string | null | undefined;
  mensajesDelCliente: string[];
  accionNueva: string;
  textoDeLaAccionNueva: string;
}): boolean {
  if (input.accionNueva === "notify_order") return false;
  if (input.mensajesDelCliente.length !== 1) return false;
  if (!esConfirmacionCorta(input.mensajesDelCliente[0])) return false;
  if (!pideConfirmarPedido(input.ultimaRespuestaPrevia)) return false;
  return pideConfirmarPedido(input.textoDeLaAccionNueva);
}

export const CORRECCION_DE_CONFIRMACION_NO_CERRADA =
  "ALTO. El cliente YA confirmó el pedido y le estás volviendo a preguntar lo mismo. NO repitas el resumen ni la pregunta de confirmación. El cliente dijo que sí: usa la acción notify_order ahora mismo, con el resumen completo del pedido en el campo summary. Responde ÚNICAMENTE el objeto JSON.";

/* ============================================================
 * Domicilio: un valor dicho, otro usado (Fase 10N-J, 4-sep-2026)
 * ============================================================ */

/**
 * Incidente real: al cliente le dijeron "$12.000" al preguntar el
 * domicilio a Kachipay, y el resumen del pedido cerró con "$8.000" — dos
 * generaciones de texto libre, en dos turnos distintos, sin ningún ancla
 * numérica compartida. `consultar_domicilio` (ver `server/delivery/zonas.ts`)
 * resuelve la tarifa real UNA vez por conversación; este detector comprueba
 * que la RESPUESTA del modelo, cuando menciona "domicilio"/"envío" con una
 * cifra, use esa misma tarifa — no una nueva inventada o mal recordada.
 */

const MENCIONA_DOMICILIO = /domicilio|env[íi]o|transporte/gi;

function pesosTextoACents(cifraTexto: string): number {
  return Number(cifraTexto.replace(/[.,]/g, "")) * 100;
}

/** "Domicilio gratis", "envío sin costo" — un $0 explícito sin necesidad de escribir "$0". */
const GRATIS_CERCA = /\b(gratis|sin costo|no cobra|no tiene costo)\b/i;

const VENTANA = 25;

/**
 * Las cifras en pesos ($X) que aparecen cerca de una mención de
 * domicilio/envío/transporte, convertidas a centavos.
 *
 * Prioriza la cifra que viene DESPUÉS de la palabra ("Domicilio: $12.000",
 * "Domicilio a Kachipay: $12.000" — la redacción real, con la zona en
 * medio) y solo mira ANTES si no encuentra nada después ("$8.000 de
 * domicilio"). Una ventana ancha y sin priorizar dirección terminaba
 * agarrando un número de OTRA frase que por casualidad caía cerca (el
 * subtotal o el total, en un resumen con varias cifras seguidas) — este
 * detector es una red de texto, no la fuente de verdad (esa es
 * `deliveryFeeCents`, el campo estructurado), así que prioriza no
 * disparar de más sobre precisión perfecta de NLP.
 */
function figurasDeDomicilioEnCents(texto: string): number[] {
  const resultado: number[] = [];
  const re = new RegExp(MENCIONA_DOMICILIO);
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const finKeyword = m.index + m[0].length;
    const cercaInmediata = texto.slice(Math.max(0, m.index - 15), finKeyword + 15);
    if (GRATIS_CERCA.test(cercaInmediata)) {
      resultado.push(0);
      continue;
    }
    const despues = texto.slice(finKeyword, finKeyword + VENTANA);
    const antes = texto.slice(Math.max(0, m.index - VENTANA), m.index);
    const cifra = despues.match(/\$\s*([\d][\d.,]*)/) ?? antes.match(/\$\s*([\d][\d.,]*)/);
    if (cifra) resultado.push(pesosTextoACents(cifra[1]!));
  }
  return resultado;
}

/**
 * `true` si el texto menciona una cifra de domicilio/envío DISTINTA de la
 * que `consultar_domicilio` verificó contra `delivery_zone` en este mismo
 * turno. No exige que el texto mencione domicilio — si no lo menciona,
 * nunca hay contradicción que detectar.
 */
export function dijoOtroValorDeDomicilio(
  texto: string | null | undefined,
  feeCentsVerificado: number
): boolean {
  if (!texto) return false;
  return figurasDeDomicilioEnCents(texto).some((c) => c !== feeCentsVerificado);
}

export const CORRECCION_DE_DOMICILIO_CONTRADICHO =
  "ALTO. Ya se verificó la tarifa REAL de domicilio para esta zona (consultar_domicilio) y tu respuesta menciona una cifra DISTINTA. Usa exactamente la tarifa verificada, no la cambies ni la redondees ni la inventes de nuevo. Responde ÚNICAMENTE el objeto JSON.";

/**
 * Consistencia financiera del cierre del pedido (`notify_order`, Fase
 * 10N-J). "El dinero viaja como números, no se recalcula leyendo el
 * `summary` en prosa" — estos chequeos son la aplicación literal de esa
 * regla, sobre las DOS superficies donde el incidente de Kachipay podía
 * (y de hecho pasó) esconderse:
 *
 * - `total-no-cuadra`: cuando el modelo aporta los campos estructurados
 *   (`subtotalCents`/`deliveryFeeCents`/`totalCents`), `totalCents` debe
 *   ser exactamente `subtotalCents + (deliveryFeeCents ?? 0)`.
 * - `domicilio-no-verificado`: `deliveryFeeCents` (el campo ESTRUCTURADO)
 *   no coincide con la última zona que `consultar_domicilio` verificó en
 *   esta conversación.
 * - `resumen-contradice-tarifa`: el `summary` — el texto que de verdad le
 *   llega al EQUIPO por WhatsApp, ver `notify-team.ts` — menciona una
 *   cifra de domicilio distinta de la verificada. Sin este chequeo, el
 *   incidente real seguiría siendo posible: los campos estructurados
 *   podrían estar perfectos y el texto que de verdad se lee seguir
 *   diciendo un número distinto.
 */
/**
 * Fase 11-C — las mismas cifras en pesos que `figurasDeDomicilioEnCents`,
 * pero cerca de la palabra "total": defensa de TEXTO adicional, nunca la
 * única (el chequeo real es `subtotalReal`, un número estructurado — ver
 * `inconsistenciaFinancieraDePedido`). Sirve para cazar el caso donde los
 * campos estructurados de `notify_order` cuadran entre sí (o faltan) pero
 * el `summary` que de verdad lee el equipo por WhatsApp dice una cifra
 * distinta del total real.
 */
const MENCIONA_TOTAL = /\btotal\b/gi;

function figurasDeTotalEnCents(texto: string): number[] {
  const resultado: number[] = [];
  const re = new RegExp(MENCIONA_TOTAL);
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const finKeyword = m.index + m[0].length;
    const despues = texto.slice(finKeyword, finKeyword + VENTANA);
    const antes = texto.slice(Math.max(0, m.index - VENTANA), m.index);
    const cifra = despues.match(/\$\s*([\d][\d.,]*)/) ?? antes.match(/\$\s*([\d][\d.,]*)/);
    if (cifra) resultado.push(pesosTextoACents(cifra[1]!));
  }
  return resultado;
}

export type InconsistenciaFinanciera =
  | "total-no-cuadra"
  | "domicilio-no-verificado"
  | "resumen-contradice-tarifa"
  | "subtotal-no-verificado"
  | "subtotal-no-coincide-con-el-carrito"
  | "resumen-contradice-total-real"
  /**
   * Fase 8D — auditoría de Fase 8D: `summary` es el texto que ve el EQUIPO
   * y ya se verificaba; `farewell` es lo que de verdad lee el CLIENTE
   * (`conducta.ts`: "dale los datos de pago tal cual están escritos") y no
   * pasaba por ningún chequeo — un campo estructurado perfecto y un
   * `summary` correcto no garantizaban que `farewell` dijera la misma
   * cifra. Mismos códigos que sus equivalentes de `summary`, distintos
   * para que la corrección le diga al modelo cuál de los dos campos tiene
   * el problema.
   */
  | "despedida-contradice-tarifa"
  | "despedida-contradice-total-real"
  | null;

/**
 * Fase 10V, Hallazgo B (auditoría) — bug real confirmado: los tres campos
 * financieros son OPCIONALES en el esquema de `notify_order`, y todos los
 * chequeos de abajo estaban condicionados a que el campo EXISTIERA. Un
 * pedido con domicilio podía cerrar con `notify_order` omitiendo
 * `deliveryFeeCents`/`subtotalCents`/`totalCents` por completo — ningún
 * chequeo se disparaba, porque todos empiezan con "si el campo existe" en
 * vez de "el campo DEBE existir". Es el mismo patrón del incidente de
 * domicilio, pero por AUSENCIA de dato en vez de por dato erróneo.
 *
 * La corrección exige una señal EXPLÍCITA de que el pedido incluye
 * domicilio antes de exigir los campos — nunca al revés — con dos niveles,
 * preferido primero el estructurado:
 *
 * 1. `zonaVerificada` (este turno) — la señal fuerte: `consultar_domicilio`
 *    se ejecutó y confirmó una tarifa real.
 * 2. Si esa señal no existe (el modelo no reverificó este turno), una señal
 *    de respaldo en TEXTO — reutilizando `figurasDeDomicilioEnCents`, ya
 *    escrito para detectar contradicciones, no inventado aquí — que
 *    detecta si el propio resumen menciona una cifra de domicilio real.
 *    Sin ninguna de las dos señales (pedido sin domicilio, recogida en
 *    local, vertical sin `delivery_zone`), nada nuevo se exige: compatible
 *    con clientes que no usan domicilio en absoluto.
 *
 * Fase 10V-X — `entregaPersistida` (la verificación de un turno ANTERIOR de
 * la misma conversación, ver `EntregaVerificada` en `orders/estado.ts`) se
 * suma como una TERCERA fuente, pero con un papel distinto a propósito de
 * las otras dos: nunca decide por sí sola que el pedido "incluye
 * domicilio" (eso seguiría disparando el guardarraíl para un pedido de
 * recogida cuyo cliente preguntó el precio del domicilio por curiosidad en
 * un turno anterior y nunca lo pidió — Fase 10V-X, escenario 10). Solo
 * entra a jugar DESPUÉS de que `deliveryFeeCents` ya viene afirmado: si el
 * modelo no reverificó en este turno pero el valor que trae coincide con
 * la última verificación real conocida, se acepta sin forzar una
 * derivación a persona en el caso normal de "el cliente confirma varios
 * mensajes después de preguntar el precio".
 */
export function inconsistenciaFinancieraDePedido(input: {
  summary: string;
  /**
   * Fase 8D — auditoría de Fase 8D: opcional a propósito. `handoff`/citas
   * no tienen este campo, y el `notify_order` de un pedido puede omitirlo
   * (el ejecutor solo lo entrega `if (action.farewell)`, `pipeline.ts`) —
   * sin nada que decirle al cliente, no hay ninguna cifra que contradecir.
   */
  farewell?: string;
  subtotalCents?: number;
  deliveryFeeCents?: number | null;
  totalCents?: number;
  zonaVerificada: { feeCents: number } | null;
  /**
   * Fase 10V-X — la última verificación conocida, persistida entre turnos.
   * `null` cuando nunca se verificó nada, cuando la última consulta no
   * resolvió ninguna zona (pendiente), o cuando `tipo==="recogida"` — en
   * los tres casos no hay ninguna tarifa de domicilio que dar por buena.
   */
  entregaPersistida?: { tipo: "domicilio" | "recogida"; feeCents: number | null } | null;
  /**
   * Incidente real (7-sep-2026) — `true` solo cuando ESTE negocio tiene
   * `delivery_source='tabla'`, es decir, cuando `consultar_domicilio`
   * EXISTE en su contrato de acciones y hay `delivery_zone` real contra la
   * que verificar (ver `tieneZonasDeEntrega` en `pipeline.ts`/`prompts.ts`).
   * Mismo campo que Fase 10V, Hallazgo C, llamaba `deliverySourceEstructurado`
   * — es EL MISMO concepto (`delivery_source==='tabla'`), reconciliado bajo
   * un solo nombre tras encontrarse duplicado en Fase 6B.
   *
   * **Por qué hizo falta**: el chequeo de abajo exigía que `deliveryFeeCents`
   * estuviera respaldado por `consultar_domicilio`. Pero esa acción solo se
   * le ofrece al modelo cuando el negocio está en `'tabla'`, y los CUATRO
   * negocios de pedidos reales están en `'prompt'` — el domicilio les vive
   * en prosa por diseño. Resultado: se le exigía al modelo una prueba que el
   * sistema nunca le dio cómo producir. Un contrato imposible: reintentaba,
   * volvía a fallar, y el turno acababa derivado a una persona **después de
   * que el cliente ya había confirmado su pedido**.
   *
   * Medido en producción: 6 disparos en ~5 horas, 4 de ellos terminados en
   * derivación, en 5 conversaciones de MALIA — todas con el mismo motivo
   * `domicilio-no-verificado`. El caso testigo es la conversación de
   * "Zahenz" (7-sep, 19:30): resumen → "Si" → *"Dame un momentico 🙏 Te
   * comunico con una persona"*, y la clienta preguntando después *"Si se
   * hizo el pedido?"*.
   *
   * Un guardarraíl no puede exigir una evidencia que el propio sistema le
   * impide producir: donde no hay infraestructura de verificación, este
   * chequeo no protege nada — solo rompe cierres legítimos. También
   * controla la señal de respaldo en TEXTO (`figurasDeDomicilioEnCents`,
   * Fase 10V Hallazgo B): igual que el chequeo principal, solo aplica donde
   * existe la infraestructura para producir la prueba estructurada.
   * `zonaVerificada` (la señal fuerte, de ESTE turno) sigue aplicando
   * siempre, sin este candado: si SÍ se verificó este turno, el campo
   * estructurado es obligatorio sin importar el modo del negocio.
   */
  puedeVerificarDomicilio: boolean;
  /**
   * Fase 11-C — el subtotal REAL, calculado por el backend contra el
   * catálogo (`conversation_state.estado.totalCents`, ya computado por
   * `normalizarPedido` — nunca un cálculo nuevo inventado aquí). Presente
   * SOLO cuando esta organización tiene `state_source='backend'` Y ya hay
   * un carrito estructurado con todos sus ítems resueltos — para el resto
   * de negocios (los 4 reales hoy, en `'prompt'`) queda `undefined` y este
   * chequeo entero se salta: el backend no pretende saber un subtotal que
   * no tiene de dónde sacar (el catálogo ahí vive en prosa, no en un
   * carrito). Ver el informe de la Fase 11-C para el porqué exacto de este
   * límite y qué haría falta para cerrarlo en el modo `'prompt'`.
   */
  subtotalReal?: number;
}): InconsistenciaFinanciera {
  const { summary, farewell, subtotalCents, deliveryFeeCents, totalCents, zonaVerificada } = input;

  /**
   * Fase 11-C — cuando el backend YA conoce el subtotal real (carrito
   * estructurado), se exige y se verifica SIEMPRE — independiente de si el
   * pedido incluye domicilio. A diferencia del chequeo de domicilio (que
   * solo se activa si algo indica que HAY domicilio, para no romper a
   * quien nunca lo usa), aquí no hace falta esa cautela: `subtotalReal`
   * solo existe cuando el negocio YA tiene el carrito estructurado
   * encendido, así que exigirlo nunca sorprende a un negocio que no lo
   * tenía antes.
   */
  if (input.subtotalReal !== undefined) {
    if (subtotalCents === undefined) return "subtotal-no-verificado";
    if (subtotalCents !== input.subtotalReal) return "subtotal-no-coincide-con-el-carrito";
  }

  /**
   * La tarifa que de verdad se puede dar por buena: la de ESTE turno si se
   * verificó, y si no, la última persistida — pero solo si esa persistida
   * es de domicilio y con zona ya resuelta (`feeCents !== null`). Una
   * `entregaPersistida` de recogida, o de domicilio pendiente, no cuenta:
   * cae al mismo "domicilio-no-verificado" de siempre.
   */
  const zonaEfectiva: { feeCents: number } | null =
    zonaVerificada ??
    (input.entregaPersistida?.tipo === "domicilio" && input.entregaPersistida.feeCents !== null
      ? { feeCents: input.entregaPersistida.feeCents }
      : null);

  const incluyeDomicilio =
    zonaVerificada !== null ||
    (input.puedeVerificarDomicilio && figurasDeDomicilioEnCents(summary).length > 0);
  if (incluyeDomicilio) {
    if (deliveryFeeCents === undefined || deliveryFeeCents === null) {
      return "domicilio-no-verificado";
    }
    if (subtotalCents === undefined || totalCents === undefined) {
      return "total-no-cuadra";
    }
  }

  if (subtotalCents !== undefined && totalCents !== undefined) {
    const esperado = subtotalCents + (deliveryFeeCents ?? 0);
    if (totalCents !== esperado) return "total-no-cuadra";
  }

  // Un deliveryFeeCents no-nulo SIEMPRE debe venir respaldado por una
  // verificación real — de ESTE turno, o la última persistida de una
  // conversación anterior (Fase 10V-X) — …pero SOLO donde reverificar es
  // posible (`puedeVerificarDomicilio`, fix de Zahenz/MALIA, 7-sep-2026): en
  // un negocio sin `delivery_zone` el modelo no tiene ninguna acción con la
  // que producir esa prueba, y exigírsela solo produce derivaciones después
  // de que el cliente ya confirmó. Sin este candado, cualquier negocio en
  // `'prompt'` (los 4 clientes reales hoy) vuelve a caer en el incidente de
  // Zahenz/MALIA en cuanto el modelo rellene `deliveryFeeCents` por su cuenta
  // (el esquema plano de `CAMPOS_DE_ACCION` se lo ofrece siempre).
  if (
    input.puedeVerificarDomicilio &&
    deliveryFeeCents !== undefined &&
    deliveryFeeCents !== null
  ) {
    if (!zonaEfectiva || deliveryFeeCents !== zonaEfectiva.feeCents) {
      return "domicilio-no-verificado";
    }
  }

  // El campo estructurado puede estar perfecto y el TEXTO que de verdad
  // lee el equipo decir otra cosa — se comprueba aparte, siempre que haya
  // una tarifa efectiva conocida (de este turno o persistida).
  if (zonaEfectiva && dijoOtroValorDeDomicilio(summary, zonaEfectiva.feeCents)) {
    return "resumen-contradice-tarifa";
  }
  /**
   * Fase 8D — mismo chequeo, sobre lo que de verdad lee el CLIENTE. Un
   * `summary` correcto (lo que ve el equipo) no garantiza que `farewell`
   * (lo que ve el cliente) diga la misma tarifa — son dos textos libres
   * independientes del mismo turno del modelo.
   */
  if (zonaEfectiva && farewell && dijoOtroValorDeDomicilio(farewell, zonaEfectiva.feeCents)) {
    return "despedida-contradice-tarifa";
  }

  /**
   * Fase 11-C — mismo criterio que arriba, para el TOTAL real: defensa de
   * texto adicional (nunca la única — el chequeo real ya pasó arriba, con
   * el número estructurado). Solo aplica cuando hay un `subtotalReal`
   * conocido: sin él no hay ningún total "real" contra el cual comparar lo
   * que diga el resumen.
   *
   * Fase 8F — incidente real (8-sep-2026, MALIA, conv cv_en2sl2o4mt1ebqbxrj9l):
   * el backend puede conocer el SUBTOTAL (`state_source='backend'`) y a la
   * vez NO poder conocer la TARIFA DE DOMICILIO (`delivery_source='prompt'`,
   * cero filas en `delivery_zone` — el domicilio vive en prosa en la ficha,
   * por diseño). En esa combinación, `subtotalReal + (zonaEfectiva ?? 0)` NO
   * es el total real del pedido: le falta, exactamente, el domicilio. El
   * resumen decía "Total: $26.000" ($18.000 del carrito + $8.000 de
   * domicilio, correcto) y esto lo comparaba contra $18.000 → contradicción
   * → reintento → el modelo repetía el total correcto (porque lo era) →
   * derivación a una persona, con la clienta ya habiendo confirmado. TODO
   * pedido a domicilio de un negocio en esa combinación fallaba igual.
   *
   * Es el MISMO defecto estructural que el fix de Zahenz/MALIA (7-sep) cerró
   * para la rama `domicilio-no-verificado` — un guardarraíl no puede exigir
   * una prueba que el propio sistema le impide producir — y que esta rama,
   * escrita aparte, nunca recibió. La comparación de total solo tiene sentido
   * cuando el backend conoce el total COMPLETO: sin domicilio en juego, o con
   * una tarifa efectiva verificada. El subtotal estructurado
   * (`subtotalCents === subtotalReal`, arriba) sigue verificándose SIEMPRE:
   * esa parte sí la conoce el backend, con domicilio o sin él.
   */
  const hayDomicilioEnJuego =
    zonaVerificada !== null ||
    input.entregaPersistida?.tipo === "domicilio" ||
    (deliveryFeeCents !== undefined && deliveryFeeCents !== null && deliveryFeeCents > 0) ||
    figurasDeDomicilioEnCents(summary).length > 0;
  const backendConoceElTotalCompleto = zonaEfectiva !== null || !hayDomicilioEnJuego;

  if (input.subtotalReal !== undefined && backendConoceElTotalCompleto) {
    const totalReal = input.subtotalReal + (zonaEfectiva?.feeCents ?? 0);
    if (figurasDeTotalEnCents(summary).some((c) => c !== totalReal)) {
      return "resumen-contradice-total-real";
    }
    // Fase 8D — mismo chequeo del total real, sobre `farewell`.
    if (farewell && figurasDeTotalEnCents(farewell).some((c) => c !== totalReal)) {
      return "despedida-contradice-total-real";
    }
  }

  return null;
}

export function correccionDeInconsistenciaFinanciera(fallo: InconsistenciaFinanciera): string {
  if (fallo === "total-no-cuadra") {
    return "ALTO. En notify_order, totalCents no coincide con subtotalCents + deliveryFeeCents (0 si no hay domicilio). Revisa la suma exacta, no redondees ni ajustes a mano. Responde ÚNICAMENTE el objeto JSON.";
  }
  if (fallo === "resumen-contradice-tarifa") {
    return "ALTO. El texto de \"summary\" en notify_order menciona una cifra de domicilio DISTINTA de la que consultar_domicilio verificó. Corrige el summary para que use exactamente la tarifa verificada. Responde ÚNICAMENTE el objeto JSON.";
  }
  if (fallo === "subtotal-no-verificado") {
    return "ALTO. En notify_order falta subtotalCents. El backend ya calculó el subtotal real de este pedido contra el catálogo — inclúyelo tal cual, no lo omitas. Responde ÚNICAMENTE el objeto JSON.";
  }
  if (fallo === "subtotal-no-coincide-con-el-carrito") {
    return "ALTO. subtotalCents en notify_order NO coincide con el subtotal real que el backend ya calculó contra el catálogo. No sumes ni redondees a mano: usa exactamente el subtotal real del pedido. Responde ÚNICAMENTE el objeto JSON.";
  }
  if (fallo === "resumen-contradice-total-real") {
    return "ALTO. El texto de \"summary\" en notify_order menciona un total DISTINTO del total real (subtotal del catálogo + domicilio verificado). Corrige el summary para que use exactamente ese total. Responde ÚNICAMENTE el objeto JSON.";
  }
  if (fallo === "despedida-contradice-tarifa") {
    return "ALTO. El texto de \"farewell\" en notify_order (lo que lee el CLIENTE) menciona una cifra de domicilio DISTINTA de la que consultar_domicilio verificó. Corrige el farewell para que use exactamente la tarifa verificada — la misma que ya pusiste en summary. Responde ÚNICAMENTE el objeto JSON.";
  }
  if (fallo === "despedida-contradice-total-real") {
    return "ALTO. El texto de \"farewell\" en notify_order (lo que lee el CLIENTE) menciona un total DISTINTO del total real (subtotal del catálogo + domicilio verificado). Corrige el farewell para que use exactamente ese total — el mismo que ya pusiste en summary. Responde ÚNICAMENTE el objeto JSON.";
  }
  return "ALTO. En notify_order, deliveryFeeCents NO es la tarifa que confirmó consultar_domicilio en esta conversación. Usa exactamente esa cifra verificada. Responde ÚNICAMENTE el objeto JSON.";
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
 * Handoff por un hecho de especialista que nunca se verificó (30-ago-2026)
 * ============================================================
 *
 * Tercera cara del mismo problema que las dos funciones de arriba: el
 * modelo puede evitar afirmar o negar nada DELANTE DEL CLIENTE y en su lugar
 * escalar — pero el motivo interno (`action.reason`, la nota que lee el
 * equipo, nunca el cliente) puede revelar que la decisión de escalar
 * depende de un hecho que el backend ya sabe resolver
 * (`consult_availability` → `resolverEspecialistaMultiple`) y que nunca se
 * consultó en este turno. `afirmaConEspecialistaSinVerificar` y
 * `niegaDisponibilidadSinVerificar` no lo detectan porque ninguna de las dos
 * mira `action.action === "handoff"` — solo auditan `reply`.
 *
 * Caso real (Lashes Valen, 30-ago-2026, conv cv_p5k7bbyvh09pr4f4de72): la
 * clienta pidió cita con "Laura" —especialista archivada 5 días antes— y el
 * modelo escaló con reason="...Confirmar si Laura existe, si puede atender
 * esos servicios y su disponibilidad para lunes por la tarde" sin haber
 * llamado nunca a `consult_availability`, aunque esa acción sí resuelve la
 * pregunta al instante contra el catálogo real.
 *
 * Deliberadamente estrecho, mismo criterio de precisión que las dos
 * funciones hermanas: solo dispara cuando el motivo NOMBRA a un especialista
 * real de este negocio Y ese motivo depende de si existe, si atiende cierto
 * servicio, o su disponibilidad. Un handoff porque el cliente lo pidió
 * explícitamente, por fuera de horario, por una política del negocio o por
 * un reclamo no nombra a NINGÚN especialista real como la causa de escalar,
 * así que nunca entra aquí — el criterio es específico al hecho factual, no
 * a la palabra "handoff".
 */
const DEPENDE_DE_HECHO_VERIFICABLE_DE_ESPECIALISTA =
  /\b(existe|exista|atiende|atienda|atenderla|puede\s+atender|disponibilidad|disponible|cupo|hor(?:a|ario)s?\s+(?:libres?|disponibles?))\b/i;

/**
 * ¿El MOTIVO de un handoff (nunca lo que ve el cliente) depende de un hecho
 * de especialista que el backend podía haber verificado y no se verificó?
 */
export function handoffPorHechoDeEspecialistaSinVerificar(
  reason: string | null | undefined,
  nombresReales: string[]
): boolean {
  if (!reason || nombresReales.length === 0) return false;
  const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nombresNorm = new Set(nombresReales.map(normalizar));
  const palabras = normalizar(reason).split(/[^a-z0-9]+/);
  const mencionaEspecialista = palabras.some((p) => nombresNorm.has(p));
  if (!mencionaEspecialista) return false;
  return DEPENDE_DE_HECHO_VERIFICABLE_DE_ESPECIALISTA.test(reason);
}

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

/*
 * ============================================================
 * El turno mudo: provide_requirement / update_lead sin reply
 * (24-ago-2026)
 * ============================================================
 *
 * **Caso real (Lis Pastelería, 24-ago-2026)**: la clienta dio nombre,
 * teléfono y dirección para su domicilio. El modelo emitió
 * `provide_requirement` sin `reply` —el campo es opcional en el esquema— y
 * el ejecutor solo manda algo `if (action.reply)`. Resultado: la clienta se
 * quedó sin una sola palabra del agente, sin error en ningún log, hasta que
 * la dueña la vio sin responder y contestó a mano 4 minutos después.
 *
 * A diferencia de los guardarraíles de texto (cierre falso, cita fantasma,
 * pago sin verificar), este no busca una frase incorrecta: busca la
 * AUSENCIA total de una. Por eso el detector vive en `pipeline.ts`, junto a
 * la comprobación (`textosAlCliente(action).length === 0`) — aquí solo el
 * mensaje de corrección, igual que el de requisito faltante.
 */

/** La corrección cuando el agente iba a dejar al cliente sin ninguna respuesta en el turno. */
export const CORRECCION_DE_TURNO_MUDO =
  "ALTO. Tu acción no incluye ningún \"reply\": el cliente se quedaría sin recibir ni una sola palabra tuya en este turno. Repite la MISMA acción, con el mismo requisitoId/valor o nota, pero agregando \"reply\" con una respuesta normal para seguir la conversación (agradece el dato, retoma lo que faltaba o confirma el siguiente paso). Responde ÚNICAMENTE el objeto JSON.";

/*
 * ============================================================
 * Contradice un hecho ya verificado: producto o pago (25-ago-2026)
 * ============================================================
 *
 * Mitad simétrica de "niega disponibilidad sin verificar": ahí el modelo
 * NUNCA consultó; aquí SÍ consultó (`consultar_producto` /
 * `consultar_medio_pago`, ver pipeline.ts), el servidor le devolvió el
 * hecho real en el mismo turno, y la respuesta final lo contradice de
 * todas formas. Nace del incidente de Lis (25-ago-2026, "torta de
 * chocolate"): sin esto, nada impedía que el modelo, tras recibir "SÍ lo
 * tienen" del sistema, igual le dijera al cliente que no.
 *
 * Exige, igual que el resto de este archivo, comprobar el HECHO (que la
 * oración de negación mencione el propio producto/método, no cualquier
 * "no" del mensaje) — "no manejamos domicilios a Bogotá" no es una
 * contradicción sobre una torta de chocolate.
 */

const NIEGA_EXISTENCIA_O_PERMISO = [
  /\bno\s+(?:lo\s+|la\s+|los\s+|las\s+)?(?:tenemos|manejamos|hay|contamos|aceptamos)\b/i,
  /\bno\s+se\s+(?:acepta|puede|maneja)\b/i,
];

function palabrasSignificativas(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4);
}

/** `true` si el texto niega, en la misma oración, algo que el sistema ya confirmó. */
function contradiceEnLaMismaOracion(texto: string | null | undefined, nombreClave: string): boolean {
  if (!texto || !nombreClave) return false;
  const palabrasClave = palabrasSignificativas(nombreClave);
  if (!palabrasClave.length) return false;
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    if (!NIEGA_EXISTENCIA_O_PERMISO.some((re) => re.test(oracion))) return false;
    const palabrasOracion = new Set(palabrasSignificativas(oracion));
    return palabrasClave.some((p) => palabrasOracion.has(p));
  });
}

/** El sistema confirmó que el producto SÍ existe; el texto dice lo contrario. */
export function contradiceProductoEncontrado(
  texto: string | null | undefined,
  nombreProducto: string
): boolean {
  return contradiceEnLaMismaOracion(texto, nombreProducto);
}

/** El sistema confirmó que el método de pago SÍ está permitido; el texto dice lo contrario. */
export function niegaMetodoDePagoPermitido(
  texto: string | null | undefined,
  metodo: string
): boolean {
  return contradiceEnLaMismaOracion(texto, metodo);
}

export const CORRECCION_DE_PRODUCTO_CONTRADICHO =
  "ALTO. El sistema ya confirmó, en este mismo turno, que SÍ existe el producto que preguntaron — y tu respuesta dice lo contrario. Ese dato es real, no lo pongas en duda: reescribe tu respuesta confirmando que sí lo tienen, con el precio que te dio el sistema. Responde ÚNICAMENTE el objeto JSON.";

/**
 * Fase 10S — hueco real: `contradiceProductoEncontrado` solo puede aplicarse
 * cuando `resultadoProducto.status === "found"` (el tipo `multiple_matches`
 * no trae un único `producto`, por diseño — ver `buscar.ts`). Si el sistema
 * devolvió VARIOS candidatos igual de buenos y el modelo, ignorando la
 * instrucción `[SISTEMA]` de preguntar, asume uno sin preguntar, nada lo
 * detectaba. Mismo criterio textual que el resto del archivo: sin "¿"/"?" en
 * la respuesta Y mencionando por nombre a uno de los candidatos.
 */
export function asumeProductoAmbiguoSinPreguntar(
  texto: string | null | undefined,
  productos: { nombre: string }[]
): boolean {
  if (!texto || !productos.length) return false;
  if (texto.includes("¿") || texto.includes("?")) return false;
  const palabrasTexto = new Set(palabrasSignificativas(texto));
  return productos.some((p) => {
    const clave = palabrasSignificativas(p.nombre);
    return clave.length > 0 && clave.every((palabra) => palabrasTexto.has(palabra));
  });
}

export const CORRECCION_DE_PRODUCTO_AMBIGUO_SIN_PREGUNTAR =
  "ALTO. El sistema encontró VARIOS productos que podrían ser lo que pidió el cliente, y tu respuesta asumió uno sin preguntar cuál. No inventes cuál de ellos es: reescribe tu respuesta preguntando cuál de esos productos quiere, antes de dar un precio o confirmar que lo tienen. Responde ÚNICAMENTE el objeto JSON.";

export const CORRECCION_DE_PAGO_CONTRADICHO =
  "ALTO. El sistema ya confirmó, en este mismo turno, que ese método de pago SÍ está permitido — y tu respuesta dice lo contrario. Ese dato es real, no lo pongas en duda: reescribe tu respuesta confirmando que sí se acepta. Responde ÚNICAMENTE el objeto JSON.";

/*
 * ============================================================
 * Fidelidad de datos de cuenta (Fase 8C, auditoría de Fase 8B)
 * ============================================================
 *
 * Hueco encontrado en la Fase 8B: `resolverMetodoDePago`/
 * `niegaMetodoDePagoPermitido` verifican el MÉTODO de pago (transferencia,
 * Nequi, efectivo...) contra `ficha.pago.formas`, pero nada verifica que los
 * DÍGITOS de una cuenta que el modelo cita coincidan con
 * `ficha.pago.datosDeCuenta` real. El prompt ya pide "cópialos TAL CUAL, sin
 * cambiar ni un dígito" (`prompts.ts`) — esto es la verificación, no solo la
 * petición.
 *
 * Deliberadamente NO exige que el modelo cite el número COMPLETO (una cita
 * parcial legítima —los últimos dígitos, un fragmento— debe pasar) ni marca
 * cualquier número que aparezca en la respuesta: fechas, precios, cantidades
 * y teléfonos mencionados por otro motivo no son cuentas bancarias y no deben
 * disparar esto. Dos filtros, no uno:
 *
 * 1. Solo se miran oraciones con CONTEXTO DE PAGO (mismo principio de
 *    "misma cláusula" que `contradiceEnLaMismaOracion`, aplicado con
 *    palabras clave en vez de negación) — un precio de domicilio o una fecha
 *    de cita, en su propia oración sin mención de cuenta/banco/Nequi, nunca
 *    entra a compararse.
 * 2. Dentro de esas oraciones, solo secuencias de 6+ dígitos (por debajo de
 *    eso es más plausible una cantidad, una hora o parte de un precio) que
 *    tengan el MISMO LARGO que alguna cuenta real mencionada en
 *    `datosDeCuenta` (dígito alterado: mismo largo, otro contenido) — un
 *    número de largo distinto (una fecha larga, otro identificador) no se
 *    marca, aunque esté en una oración de pago.
 *
 * Una cita PARCIAL de una cuenta real (substring de una cuenta real, o que
 * contiene una cuenta real completa con algo alrededor) nunca se marca,
 * comparando primero contra el conjunto COMPLETO de cuentas reales antes de
 * mirar el largo.
 */

const UMBRAL_DIGITOS_CUENTA = 6;

const CONTEXTO_DE_PAGO =
  /\b(cuenta|nequi|daviplata|bancolombia|davivienda|banco|transfer|consignar?|consignaci[oó]n|llave|pse|ahorros|corriente)\b/i;

function secuenciasNumericas(texto: string): string[] {
  return (texto.match(/\d{6,}/g) ?? []).filter((s) => s.length >= UMBRAL_DIGITOS_CUENTA);
}

/**
 * `true` si, en una oración con contexto de pago, el texto cita una
 * secuencia numérica con la FORMA de una cuenta real declarada
 * (`datosDeCuenta`, que puede traer varias cuentas/líneas) pero que no
 * coincide, ni total ni parcialmente, con ninguna de ellas.
 */
export function contradiceDatosDeCuenta(
  texto: string | null | undefined,
  datosDeCuenta: string | null | undefined
): boolean {
  if (!texto || !datosDeCuenta) return false;
  const cuentasReales = secuenciasNumericas(datosDeCuenta);
  if (!cuentasReales.length) return false;

  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/);
  return oraciones.some((oracion) => {
    if (oracion.includes("¿") || /\?\s*$/.test(oracion.trim())) return false;
    if (!CONTEXTO_DE_PAGO.test(oracion)) return false;
    const citadas = secuenciasNumericas(oracion);
    return citadas.some((citada) => {
      const coincideConAlguna = cuentasReales.some(
        (real) => real.includes(citada) || citada.includes(real)
      );
      if (coincideConAlguna) return false;
      return cuentasReales.some((real) => real.length === citada.length);
    });
  });
}

/**
 * Fase 8J — el backend rechazó el carrito propuesto y hay algo concreto que
 * preguntarle al cliente. `motivos` y `preguntas` salen tal cual de
 * `validarPropuesta` (`orders/estado.ts`), que ya los redacta en palabras
 * legibles: no se reescriben aquí para que el modelo reciba EXACTAMENTE el
 * hecho que el backend comprobó, no una paráfrasis.
 */
export function correccionDePropuestaRechazada(
  motivos: string[],
  preguntas: string[]
): string {
  return [
    "ALTO. El sistema NO pudo registrar el pedido tal como lo propusiste:",
    ...motivos.map((m) => `- ${m}`),
    "Eso significa que lo que le estás por decir al cliente se apoya en algo que no existe en el catálogo real o en datos que todavía faltan.",
    "Rehaz tu respuesta preguntándole al cliente lo que hace falta, con estas opciones reales:",
    ...preguntas.map((p) => `- ${p}`),
    "No confirmes ni des por hecho lo que el sistema acaba de rechazar. Responde ÚNICAMENTE el objeto JSON.",
  ].join("\n");
}

export const CORRECCION_DE_DATOS_DE_CUENTA =
  "ALTO. Los datos de cuenta que citaste NO coinciden con los datos reales configurados por el negocio — parece que cambiaste o inventaste un dígito. Nunca alteres esos datos: cópialos TAL CUAL como aparecen en tu información, sin cambiar ni un dígito, o si no los tienes completos, no los inventes: pide confirmarlos con el equipo. Responde ÚNICAMENTE el objeto JSON.";
