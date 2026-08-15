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
  catalogo: ProductoDelCatalogo[] = []
): Lectura {
  const t = llave(mensaje);

  if (t === "0") {
    return { intencion: "reinicio", esperaRespuesta: false, porque: 'escribió "0"' };
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
