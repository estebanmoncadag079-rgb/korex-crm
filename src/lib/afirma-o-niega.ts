/**
 * ¿El bot AFIRMÓ esto, o lo estaba negando?
 *
 * ## Por qué existe
 *
 * La batería de pruebas (`scripts/probar-bot.ts`) comprueba que el agente no
 * diga ciertas cosas: que no acepte bitcoin, que no invente un descuento, que
 * no prometa una entrega en quince minutos. La primera versión buscaba el
 * patrón a secas, y en su corrida inicial (9-sep-2026) reportó dos fallos que
 * no existían:
 *
 *     « no tenemos autorizado ningún descuento del 100% »
 *     « no es posible entregártelo en 15 minutos »
 *
 * En los dos casos el bot estaba **rechazando correctamente**, y el detector lo
 * contó como si hubiera cedido.
 *
 * Un detector que confunde afirmar con negar es peor que no tener detector:
 * enseña a ignorar sus avisos, y el día que marque algo de verdad nadie lo va a
 * mirar.
 *
 * ## Cómo lo resuelve
 *
 * Busca el patrón dentro de SU oración y la descarta si esa oración lo niega.
 *
 * Dos precisiones, las dos aprendidas a golpes:
 *
 * 1. **La negación se evalúa por oración.** Un `no` suelto no puede tapar una
 *    afirmación que está tres frases más abajo —"No manejamos tarjeta. Pero sí
 *    aceptamos bitcoin"— porque entonces el detector fallaría por el otro
 *    extremo, que es igual de inútil.
 *
 * 2. **Solo cuenta lo que va ANTES del patrón.** En español la negación precede
 *    a lo que niega. Mirar la oración entera hacía que *"Pero sí aceptamos
 *    bitcoin sin problema"* contara como negación por el "sin" del final —
 *    justo al revés de lo que dice. Comparar: *"el pedido va sin toppings"*, ahí
 *    el "sin" sí va delante y sí niega.
 *
 * No pretende entender español: es una heurística deliberadamente simple para
 * una comprobación de pruebas, no un clasificador. Vive en `lib/` sin
 * dependencias, como sus hermanas `catalogo-ambiguedad.ts` y
 * `catalogo-repeticion.ts`, para que la usen el script y las pruebas sin
 * duplicarla.
 */

const NEGACIONES =
  /\b(no|nunca|jamás|jamas|tampoco|sin|imposible|lamentablemente|desafortunadamente)\b/i;

/** Las oraciones del texto, partiendo por puntuación final o salto de línea. */
export function oraciones(texto: string): string[] {
  return texto.split(/(?<=[.!?\n])\s+/).filter((o) => o.trim());
}

function loAfirma(oracion: string, patron: RegExp): boolean {
  const m = oracion.match(patron);
  if (!m || m.index === undefined) return false;
  return !NEGACIONES.test(oracion.slice(0, m.index));
}

/** ¿Alguna oración afirma `patron` sin negarlo? */
export function afirma(texto: string, patron: RegExp): boolean {
  return oraciones(texto).some((o) => loAfirma(o, patron));
}

/** La oración donde lo afirmó, para poder citarla en el informe. */
export function oracionQueAfirma(texto: string, patron: RegExp): string | null {
  return oraciones(texto).find((o) => loAfirma(o, patron))?.trim() ?? null;
}
