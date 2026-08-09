import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";

/**
 * Quién habla en una conversación: el agente o una persona.
 *
 * Tomar la conversación es fácil (basta escribir), devolverla también tiene
 * que serlo — si no, el bot se queda mudo para siempre y el cliente escribe
 * al vacío. Tres caminos de vuelta, los mismos que el bot anterior:
 *   1. el operador lo dice ("te dejo con el asistente") o usa el atajo #bot;
 *   2. el cliente escribe 0 (volver al menú);
 *   3. pasan horas sin que nadie conteste.
 */

/** El cliente pide volver al principio. */
export const RESUME_COMMAND = "0";

/** Horas de silencio tras las que el agente retoma solo. */
export const HANDOFF_RESUME_HOURS = 2;

/**
 * A quién se nombra al devolver el turno.
 *
 * `encargado` está aquí a propósito, por pedido del dueño: escribir "#bot" en
 * el chat le queda rarísimo al cliente, y "te dejo con un encargado" suena a
 * negocio normal. **El precio es un falso positivo posible**: si un operador
 * usa esa frase queriendo pasar a una PERSONA de verdad, el agente retomará.
 * Para eso está el botón de la bandeja, que es explícito.
 *
 * ⚠️ **Ese falso positivo YA OCURRIÓ** (Lis, 8-ago-2026, 23:59). Un operador
 * escribió "Te dejo con el encargado" para anunciar que seguía una persona; se
 * limpió el relevo y el agente respondió **tres segundos después**,
 * contradiciéndolo delante de la clienta. Se le planteó al dueño el 9-ago y
 * **decidió mantenerlo**: la frase natural le importa más que el caso raro.
 * Queda anotado para que nadie lo trate como un bug nuevo si vuelve a pasar —
 * y para que quien mire este código sepa que el riesgo es real, no teórico.
 *
 * Si algún día se revisa: en Colombia "el encargado" es casi siempre una
 * persona. Las alternativas para devolver el turno sin ambigüedad son "te dejo
 * con el asistente", "con el bot", el atajo #bot y el botón IA/Humano.
 */
const QUIEN_ATIENDE = "agente|asistente|bot|ia|encargado|encargada";

/**
 * Frases con las que el operador le devuelve el turno al agente. Exigen
 * nombrar a quien atiende para no dispararse con una frase cualquiera
 * ("te dejo la dirección" NO devuelve el turno).
 *
 * La ventana de 40 caracteres entre el verbo y el nombre deja pasar el relleno
 * natural ("te dejo *con un* encargado") sin llegar a unir dos frases
 * distintas de un mismo mensaje.
 */
const RETURN_PHRASES: RegExp[] = [
  // "te dejo con el agente", "los dejo con un encargado"
  new RegExp(`\\b(te|los|le|la)\\s+dejo\\b[\\s\\S]{0,40}\\b(${QUIEN_ATIENDE})\\b`, "i"),
  // "continúa el asistente", "sigue con el bot"
  new RegExp(
    `\\b(contin[úu]a|contin[úu]e|sigue|segu[ií]s)\\b[\\s\\S]{0,40}\\b(${QUIEN_ATIENDE})\\b`,
    "i"
  ),
  // "te atiende el asistente", "te ayuda un encargado"
  new RegExp(
    `\\bte\\s+(atiende|ayuda|contin[úu]a)\\b[\\s\\S]{0,40}\\b(${QUIEN_ATIENDE})\\b`,
    "i"
  ),
  // "te paso con el encargado", "te comunico con un asistente"
  new RegExp(
    `\\b(te|los|le|la)\\s+(paso|comunico|transfiero|derivo)\\b[\\s\\S]{0,40}\\b(${QUIEN_ATIENDE})\\b`,
    "i"
  ),
  // "en un momento te atiende...", "ya viene el encargado"
  new RegExp(`\\b(ya\\s+viene|ahora\\s+te\\s+atiende)\\b[\\s\\S]{0,40}\\b(${QUIEN_ATIENDE})\\b`, "i"),
];

/** Atajos escritos a propósito: NO se le envían al cliente. */
const RETURN_SHORTCUTS = /^\s*#(bot|ia|agente)\s*$/i;

export function isReturnShortcut(text: string | null | undefined): boolean {
  return Boolean(text && RETURN_SHORTCUTS.test(text));
}

export function isReturnToAgentPhrase(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return isReturnShortcut(text) || RETURN_PHRASES.some((re) => re.test(text));
}

export function isResumeCommand(text: string | null | undefined): boolean {
  return text?.trim() === RESUME_COMMAND;
}

/** ¿Lleva tanto tiempo en silencio que el agente debe retomar? */
export function shouldResumeByInactivity(
  lastMessageAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastMessageAt) return true; // sin actividad previa: nada que interrumpir
  const horas = (now.getTime() - lastMessageAt.getTime()) / 3_600_000;
  return horas >= HANDOFF_RESUME_HOURS;
}

/**
 * Decide si un mensaje entrante devuelve el turno al agente.
 * `lastMessageAt` es el del mensaje ANTERIOR: el actual aún no cuenta.
 */
export function resumeReason(input: {
  handoffAt: Date | null;
  text: string | null;
  lastMessageAt: Date | null;
  now?: Date;
}): "comando" | "inactividad" | null {
  if (!input.handoffAt) return null; // el agente ya está al mando
  if (isResumeCommand(input.text)) return "comando";
  if (shouldResumeByInactivity(input.lastMessageAt, input.now)) {
    return "inactividad";
  }
  return null;
}

/**
 * Devuelve el turno al agente y avisa a la interfaz.
 *
 * Enciende TAMBIÉN `aiEnabled`, y esa es la parte que faltaba. El silencio del
 * agente tiene dos llaves independientes —el relevo (`handoffAt`) y el
 * interruptor por conversación (`aiEnabled`)— y esto solo levantaba la primera.
 * Si alguien había pasado la conversación a una persona con el botón de la
 * bandeja, mandar `#bot` limpiaba el relevo, la pantalla decía que la IA estaba
 * al mando... y el agente seguía mudo, porque la segunda llave seguía abajo.
 *
 * Pasó en producción el 31-jul-2026: tras el `#bot`, el cliente escribió
 * "quiero un cremoso de temporada y un cremoso polvoroso" y nadie le contestó.
 *
 * Quien devuelve el turno quiere una cosa —que la IA vuelva a atender—, así que
 * se levantan las dos llaves juntas.
 */
export async function clearHandoff(
  conversationId: string,
  organizationId: string
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({
      handoffAt: null,
      handoffReason: null,
      aiEnabled: true,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    // Se envían los dos campos: la interfaz decide con `handoffAt` y con
    // `aiEnabled`, y mandar solo el motivo dejaba el botón desfasado.
    data: {
      conversation: {
        id: conversationId,
        handoffReason: null,
        handoffAt: null,
        aiEnabled: true,
      },
    },
  });
}

/** Marca que una persona tomó la conversación (el agente calla). */
export async function markHumanTookOver(
  conversationId: string,
  organizationId: string
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({
      handoffAt: new Date(),
      handoffReason: "operador",
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId, handoffReason: "operador" } },
  });
}
