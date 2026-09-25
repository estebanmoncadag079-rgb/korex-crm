/**
 * Qué quiere el cliente EN ESTE mensaje — Fase 1.5, en memoria.
 *
 * **Por qué existe**: el estado del pedido no puede mandar sobre la intención
 * más reciente. El caso que lo destapó, revisando extracciones reales:
 *
 *     Cliente: «seria el besties cuanto sale el domi?»
 *     Sistema: «¿Cuáles salsas desea?»
 *
 * El cliente preguntó por el domicilio y el sistema siguió cerrando el pedido,
 * porque la capa que decide qué preguntar solo miraba **qué falta en el
 * pedido**, nunca **qué acaba de decir el cliente**.
 *
 * Esto NO decide la respuesta ni toca el flujo conversacional (regla 12): solo
 * clasifica el turno, para que quien decida tenga las dos cosas delante.
 *
 * **Por qué pertenece a este proyecto** (regla 14, la pregunta de control): hoy
 * "qué hacer cuando el cliente pregunta por el horario en mitad de un pedido"
 * solo existe escrito dentro del prompt de cada negocio, y hay que volver a
 * escribirlo —y volver a equivocarse— en cada alta. Aquí se escribe una vez, en
 * el backend, y sirve para todos. Eso es lo que reduce la dependencia del
 * prompt gigante por cliente.
 */
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

export type Intencion =
  /** El "0" de La Churra: empezar de cero, conservando los datos personales. */
  | "reinicio"
  /** Un saludo suelto. **No** reactiva un pedido anterior. */
  | "saludo"
  /** Pregunta por horarios o si está abierto. */
  | "consulta_horario"
  /** Pregunta por entrega, domicilio o demora. */
  | "consulta_entrega"
  /** Pregunta por precios sin elegir nada. */
  | "consulta_precio"
  /** Nombra una presentación: arranca o retoma la compra. */
  | "pedido"
  /** Da una opción del pedido en curso (una salsa, un recubierto). */
  | "opcion"
  /** No encaja en nada de lo anterior. Que decida quien sepa más. */
  | "otra";

export type Lectura = {
  intencion: Intencion;
  /**
   * `true` cuando el cliente pregunta algo que hay que responderle **antes** de
   * seguir pidiéndole datos del pedido. No significa cancelar la compra.
   */
  esperaRespuesta: boolean;
  /** Qué dispara la clasificación, para poder discutirla sin adivinar. */
  porque: string;
  /**
   * El producto que el mensaje nombró, si nombró alguno — **con independencia
   * de la intención**.
   *
   * Nació del Bloqueador 1 de la auditoría (24-sep-2026): *"sería el Besties,
   * pero ¿cuánto cuesta el domicilio?"* es una `consulta_entrega` (la pregunta
   * manda), pero el Besties no puede desaparecer de la interpretación del
   * turno. Antes, en cuanto la consulta ganaba, el producto se perdía y el
   * modelo contestaba el domicilio y se olvidaba del pedido.
   *
   * No es un clasificador aparte: es el mismo `leerIntencion` contando lo que
   * ya sabía. `null` cuando el mensaje no nombra ninguna presentación.
   */
  productoMencionado: string | null;
};

function llave(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SALUDOS = ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "hey", "alo"];
const HORARIO = ["horario", "hora abren", "abren", "abierto", "cierran", "atienden", "hasta que hora"];
const PRECIO = ["precio", "precios", "cuanto vale", "cuanto cuesta", "cuanto sale", "valor"];

/**
 * Los nombres de la entrega. Aparecen tanto en una PREGUNTA ("¿tienen
 * domicilio?") como en una SELECCIÓN ("quiero el besties a domicilio"), y por
 * eso su sola presencia no basta — la distingue `preguntaPorEntrega`.
 */
const ENTREGA_TERMINOS = ["domicilio", "domi", "envio", "envios", "entrega", "entregan", "entregas", "llevan", "reparto"];
/**
 * Palabras que convierten un término de entrega en una PREGUNTA sobre ella.
 * "tiene" cubre también "tienen"; "costo" cubre "costos" — por `includes`. Con
 * ellas, "y que costo tiene el domicilio" (el caso de MALIA, muchas veces sin
 * signo) se lee como consulta aunque el cliente no ponga "?".
 */
const ENTREGA_INDAGA = ["cuanto", "cuesta", "costo", "vale", "sale", "precio", "valor", "cobran", "tiene", "hacen", "hay"];

function preguntaPorHorario(t: string): boolean {
  return HORARIO.some((p) => t.includes(llave(p)));
}

function preguntaPorPrecio(t: string): boolean {
  return PRECIO.some((p) => t.includes(llave(p)));
}

/**
 * ¿El mensaje PREGUNTA por la entrega, o solo la ELIGE?
 *
 * Bloqueador 1 de la auditoría: eran lo mismo para el clasificador viejo —
 * cualquier "domicilio" contaba como consulta— y no lo son. "¿cuánto cuesta el
 * domicilio?" pide respuesta; "quiero el besties a domicilio" es escoger la
 * modalidad, y ese turno sigue siendo un pedido.
 *
 * El criterio, en orden:
 *  1. "demora"/"tarda" es SIEMPRE una pregunta de tiempo, con término o sin él.
 *  2. Sin ningún término de entrega, no hay consulta de entrega que valer.
 *  3. Con una palabra que indaga (cuánto, cuesta, tienen…), es pregunta.
 *  4. "a domicilio" / "por domicilio" es la forma de ELEGIR: no es pregunta,
 *     ni siquiera si trae un signo de interrogación por costumbre.
 *  5. Si no, un término de entrega dentro de una pregunta ("¿me entregan
 *     mañana?") sí cuenta.
 *
 * @param t El mensaje ya normalizado por `llave` (sin signos ni tildes).
 * @param hayPregunta Si el mensaje ORIGINAL traía "?" o "¿" — `llave` los borra.
 */
function preguntaPorEntrega(t: string, hayPregunta: boolean): boolean {
  if (/\b(demora|tarda)\b/.test(t)) return true;
  const term = ENTREGA_TERMINOS.some((w) => t.includes(w));
  if (!term) return false;
  if (ENTREGA_INDAGA.some((w) => t.includes(w))) return true;
  if (/\b(a|por) domicilio\b/.test(t)) return false;
  return hayPregunta;
}

/**
 * @param mensaje El último mensaje del cliente, tal cual lo escribió.
 * @param catalogo Para reconocer presentaciones y opciones por su nombre real,
 *   en vez de una lista de palabras que se queda vieja al primer producto nuevo.
 */
export function leerIntencion(
  mensaje: string,
  catalogo: ProductoDelCatalogo[] = [],
  /**
   * Qué escribe el cliente para empezar de cero. En La Churra es `"0"`, y está
   * en SU prompt — no es una ley universal.
   *
   * Va como parámetro y no clavado en el código porque esta función corre para
   * toda la flota: un negocio que ofrezca listas numeradas tendría un `"0"`
   * legítimo, y un reinicio clavado le borraría el pedido a mitad. Es
   * exactamente la clase de suposición que no escala.
   */
  palabrasDeReinicio: string[] = ["0"]
): Lectura {
  const t = llave(mensaje);
  // `llave` borra los signos, y "?"/"¿" son justo lo que distingue una pregunta
  // de una selección ("¿me entregan mañana?" vs "a domicilio"). Se miran sobre
  // el mensaje original, antes de normalizar.
  const hayPregunta = mensaje.includes("?") || mensaje.includes("¿");

  // El producto se detecta SIEMPRE, gane o no la intención: es lo que hace que
  // una consulta no borre el pedido que venía en el mismo mensaje (Bloqueador 1).
  const producto = catalogo.find((p) => t.includes(llave(p.nombre)));
  const con = (l: Omit<Lectura, "productoMencionado">): Lectura => ({
    ...l,
    productoMencionado: producto?.nombre ?? null,
  });

  if (palabrasDeReinicio.some((p) => t === llave(p))) {
    return {
      intencion: "reinicio",
      esperaRespuesta: false,
      porque: `escribió "${mensaje.trim()}"`,
      productoMencionado: null,
    };
  }

  // La consulta explícita gana al producto: «sería el besties, ¿cuánto cuesta
  // el domi?» es una pregunta de domicilio, no un pedido a secas. El besties no
  // se pierde — viaja en `productoMencionado`. Y una consulta pesa más que un
  // saludo de cortesía delante: «hola, hasta qué hora atienden» es una consulta.
  if (preguntaPorHorario(t)) {
    return con({ intencion: "consulta_horario", esperaRespuesta: true, porque: "preguntó por horario" });
  }
  if (preguntaPorEntrega(t, hayPregunta)) {
    return con({ intencion: "consulta_entrega", esperaRespuesta: true, porque: "preguntó por entrega" });
  }
  if (preguntaPorPrecio(t)) {
    return con({ intencion: "consulta_precio", esperaRespuesta: true, porque: "preguntó por precio" });
  }

  // El producto manda sobre el saludo: «hola, quiero una churrita» es un pedido.
  if (producto) {
    return con({ intencion: "pedido", esperaRespuesta: false, porque: `nombró ${producto.nombre}` });
  }

  const opcion = catalogo
    .flatMap((p) => p.grupos.flatMap((g) => g.opciones))
    .find((o) => t.includes(llave(o.nombre)) || llave(o.nombre).includes(t));
  if (opcion) {
    return { intencion: "opcion", esperaRespuesta: false, porque: `dijo ${opcion.nombre}`, productoMencionado: null };
  }

  if (SALUDOS.some((s) => t === llave(s) || t.startsWith(`${llave(s)} `))) {
    return { intencion: "saludo", esperaRespuesta: false, porque: "es un saludo suelto", productoMencionado: null };
  }

  return { intencion: "otra", esperaRespuesta: false, porque: "no encaja en nada conocido", productoMencionado: null };
}

/**
 * Un pedido a medias vale **hasta el final del día**, en hora de Colombia.
 *
 * Decisión del dueño (15-ago-2026): dentro de la jornada se sigue donde iba;
 * al día siguiente se empieza limpio. Así el cliente que vuelve a los diez
 * minutos no repite lo ya dicho, y al que escribe *"hola"* el martes no se le
 * ofrecen los churros que dejó a medias el lunes.
 *
 * El día se calcula en `America/Bogota` y no en UTC: entre las 19:00 y la
 * medianoche de Colombia ya es el día siguiente en UTC, que es justo la franja
 * de más pedidos de una churrería.
 */
export function pedidoSigueVigente(
  ultimaActividad: Date,
  ahora: Date = new Date(),
  timeZone = "America/Bogota"
): boolean {
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  return dia(ultimaActividad) === dia(ahora);
}

/**
 * Horas sin actividad para dar un pedido por abandonado. Varias horas a
 * propósito: un cliente que sigue pidiendo pasada la medianoche pausa minutos,
 * no horas — así el reinicio nunca le borra el carrito en mitad del pedido.
 */
export const HORAS_PARA_DAR_POR_ABANDONADO = 6;

/**
 * ¿Este pedido viejo quedó abandonado y debe reiniciarse? (Bug 2, 25-sep-2026)
 *
 * Decisión del dueño: reiniciar SOLO si se dan las dos cosas juntas —es de otro
 * día (hora de Colombia) Y lleva `HORAS_PARA_DAR_POR_ABANDONADO` sin actividad—.
 * El día por sí solo no basta: borraría el carrito de quien pide a las 11:50pm
 * y sigue a las 12:10am. El mismo día tampoco reinicia, aunque hayan pasado
 * horas: el cliente puede volver a retomar su pedido dentro de la jornada.
 */
export function pedidoQuedoAbandonado(
  ultimaActividad: Date,
  ahora: Date = new Date(),
  timeZone = "America/Bogota"
): boolean {
  if (pedidoSigueVigente(ultimaActividad, ahora, timeZone)) return false;
  const horasSinActividad = (ahora.getTime() - ultimaActividad.getTime()) / 3_600_000;
  return horasSinActividad >= HORAS_PARA_DAR_POR_ABANDONADO;
}

/** Lo que toca hacer en este turno, con la intención y el estado delante. */
export type PlanDelTurno = {
  /** Vaciar el pedido antes de nada. */
  reiniciar: boolean;
  /** Hay que contestar esto ANTES de seguir pidiendo datos. */
  responderPrimero: Intencion | null;
  /**
   * …y en el MISMO mensaje seguir con lo que falte del pedido.
   *
   * Decisión del dueño (15-ago-2026). **El motivo no es ahorrar mensajes**: es
   * que dejar la consulta contestada y el pedido colgando obliga al cliente a
   * retomarlo por su cuenta, y a un negocio a vigilar los que se quedan a
   * medias. Que menos mensajes salga más barato es un efecto secundario, no el
   * criterio — el criterio es el de la regla 1.
   */
  continuarEnElMismoMensaje: boolean;
};

/**
 * Junta las dos cosas que hasta ahora no se miraban juntas: **qué acaba de
 * decir el cliente** y **qué le falta al pedido**.
 *
 * @param hayPedidoEnCurso Si el estado trae algo que continuar.
 */
export function planDelTurno(lectura: Lectura, hayPedidoEnCurso: boolean): PlanDelTurno {
  if (lectura.intencion === "reinicio") {
    return { reiniciar: true, responderPrimero: null, continuarEnElMismoMensaje: false };
  }
  if (lectura.esperaRespuesta) {
    return {
      reiniciar: false,
      responderPrimero: lectura.intencion,
      // Solo se retoma si de verdad había algo que retomar: a quien solo
      // preguntó el horario no se le empieza a pedir la salsa.
      continuarEnElMismoMensaje: hayPedidoEnCurso,
    };
  }
  return { reiniciar: false, responderPrimero: null, continuarEnElMismoMensaje: hayPedidoEnCurso };
}

/**
 * De qué preguntó el cliente, en palabras que el modelo pueda usar.
 *
 * Solo las tres consultas explícitas llegan aquí: son las únicas con
 * `esperaRespuesta: true`.
 */
const TEMA: Partial<Record<Intencion, string>> = {
  consulta_horario: "el horario del negocio",
  consulta_entrega: "la entrega o el domicilio",
  consulta_precio: "los precios",
};

/**
 * Instrucción de brevedad, SOLO para `consulta_entrega` (Bug 4, 25-sep-2026).
 *
 * El conocimiento del negocio trae el domicilio, sus restricciones y quién
 * paga todo junto en un solo bloque ("## Cómo lo recibe", `generador/generar.ts`)
 * — pensado para el RESUMEN del pedido, no para una pregunta suelta. Sin esta
 * instrucción, "¿hacen domicilio?" recibía ese bloque entero. El backend ya
 * sabe con certeza que la pregunta fue puntual (`consulta_entrega`); esto le
 * dice al modelo CUÁNTO contestar, sin tocar la ficha ni quitarle al backend
 * ninguna autoridad sobre precios o cifras.
 *
 * Acotado a `consulta_entrega` a propósito: es donde se reportó el problema
 * real. No se generaliza a horario/precio sin evidencia de que les pase igual.
 */
const ACOTADO: Partial<Record<Intencion, string>> = {
  consulta_entrega:
    "Contesta en una frase corta si hacen domicilio o no (y el tiempo aproximado, si lo sabes). NO listes restricciones, política de quién paga el domicilio ni otras condiciones — eso va en el resumen final del pedido, no aquí. Si el cliente pregunta directamente por una de esas cosas, ahí sí contéstala.",
};

/**
 * El plan del turno, escrito para que lo lea el modelo.
 *
 * 24-sep-2026 — este módulo llevaba desde el 15-ago con sus pruebas en verde
 * y sin que lo llamara nadie. Mientras tanto seguía pasando lo que vino a
 * resolver (MALIA, conv cv_zgm286k69bz1hmprf87a):
 *
 *     17:15:42  CLIENTE  Y que costo tiene el domicilio?
 *     17:15:58  BOT      Perfecto 😊 ¿Qué quieres y cuántos?
 *
 * Dieciséis segundos — no fue una carrera de turnos. Fue que la capa que
 * decide qué preguntar solo miraba qué le falta al pedido.
 *
 * Esta función NO redacta la respuesta ni elige producto: traduce el plan a
 * una instrucción. Devuelve `null` cuando no hay nada que priorizar —la
 * inmensa mayoría de los turnos— para no meter ruido en un prompt que el
 * modelo lee entero cada vez.
 *
 * 🛑 El REINICIO no se representa aquí. Ya es determinista y corre ANTES de
 * llamar al modelo (`matchesReinicio`/`borrarEstado` en `pipeline.ts`): pedirle al
 * modelo que colabore en algo que el servidor ya resolvió solo abre la puerta
 * a que un turno confuso arrastre un pedido ya cancelado.
 */
export function bloqueDelPlan(
  lectura: Lectura,
  plan: PlanDelTurno,
  /**
   * Si el servidor SABE si hay un pedido a medias, o solo lo supone.
   *
   * Con `state_source='prompt'` no hay fila de `conversation_state` que leer,
   * así que `plan.continuarEnElMismoMensaje` llega en `false` por ignorancia,
   * no por evidencia. Decirle al modelo «no hay ningún pedido en curso»
   * entonces es una afirmación que el backend no puede sostener — y en mitad
   * de un pedido a medias le haría soltar el hilo. Lo destapó
   * Camilabrandcol, que no tiene nada de esto encendido.
   *
   * Es la segunda regla del plan aplicada a sí misma: sin evidencia
   * suficiente, se representa «no se sabe»; no se rellena por inferencia.
   */
  sabemosSiHayPedido = true
): string | null {
  if (!plan.responderPrimero) return null;
  const tema = TEMA[plan.responderPrimero];
  if (!tema) return null;
  const seguir = plan.continuarEnElMismoMensaje
    ? "Y en el MISMO mensaje sigue con el punto del pedido que toque — sin saltarte el orden ni adelantar otros puntos."
    : sabemosSiHayPedido
      ? "No hay ningún pedido en curso: contesta y ya. No empieces a pedirle datos que no te ha pedido."
      : "Si ya venía un pedido a medias, sigue con el punto que toque en el MISMO mensaje — sin saltarte el orden ni adelantar otros puntos. Si no venía ninguno, contesta y ya.";
  // Cuando la pregunta llega pegada a un producto ("sería el besties, ¿cuánto
  // cuesta el domi?"), se le recuerda al modelo para que contestar la consulta
  // no le haga soltar el pedido (Bloqueador 1, §3.3).
  const producto = lectura.productoMencionado
    ? `\nEl cliente además nombró ${lectura.productoMencionado}: tómalo como parte del pedido, no lo dejes caer por contestar la pregunta.`
    : "";
  const acotado = ACOTADO[plan.responderPrimero] ? `\n${ACOTADO[plan.responderPrimero]}` : "";
  return (
    // `[SISTEMA]`: el mismo canal por el que viaja TODO hecho verificado del
    // pipeline (ver `pipeline.ts`, los `[SISTEMA]` de producto y de pago). Es
    // una instrucción del backend, no un mensaje del cliente — la marca evita
    // que el modelo la lea como si la hubiera escrito la persona (§7).
    "[SISTEMA] PLAN DEL TURNO (lo decidió el servidor con lo que acaba de escribir el cliente):\n" +
    `🛑 Antes de pedirle nada más, CONTÉSTALE lo que preguntó: ${tema} (${lectura.porque}).\n` +
    seguir +
    producto +
    acotado
  );
}
