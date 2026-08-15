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
const ENTREGA = ["domicilio", "domi", "entrega", "entregan", "llevan", "demora", "tarda", "cuanto se demora", "envio"];
const PRECIO = ["precio", "precios", "cuanto vale", "cuanto cuesta", "cuanto sale", "valor"];

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

  if (palabrasDeReinicio.some((p) => t === llave(p))) {
    return { intencion: "reinicio", esperaRespuesta: false, porque: `escribió "${mensaje.trim()}"` };
  }

  // El producto manda sobre el saludo: «hola, quiero una churrita» es un pedido.
  const producto = catalogo.find((p) => t.includes(llave(p.nombre)));
  if (producto) {
    return {
      intencion: "pedido",
      esperaRespuesta: false,
      porque: `nombró ${producto.nombre}`,
    };
  }

  // Una consulta pesa más que un saludo de cortesía delante: «hola, hasta qué
  // hora atienden» es una consulta, no un saludo.
  const consulta = ([
    ["consulta_horario", HORARIO],
    ["consulta_entrega", ENTREGA],
    ["consulta_precio", PRECIO],
  ] as const).find(([, palabras]) => palabras.some((p) => t.includes(llave(p))));
  if (consulta) {
    return {
      intencion: consulta[0],
      esperaRespuesta: true,
      porque: `preguntó por ${consulta[0].replace("consulta_", "")}`,
    };
  }

  const opcion = catalogo
    .flatMap((p) => p.grupos.flatMap((g) => g.opciones))
    .find((o) => t.includes(llave(o.nombre)) || llave(o.nombre).includes(t));
  if (opcion) {
    return { intencion: "opcion", esperaRespuesta: false, porque: `dijo ${opcion.nombre}` };
  }

  if (SALUDOS.some((s) => t === llave(s) || t.startsWith(`${llave(s)} `))) {
    return { intencion: "saludo", esperaRespuesta: false, porque: "es un saludo suelto" };
  }

  return { intencion: "otra", esperaRespuesta: false, porque: "no encaja en nada conocido" };
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
