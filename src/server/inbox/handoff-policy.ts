import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
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
 * Frases con las que el operador le devuelve el turno al agente. Exigen
 * nombrar al asistente para no dispararse con una frase cualquiera
 * ("te dejo la dirección" NO devuelve el turno).
 */
const RETURN_PHRASES: RegExp[] = [
  /\b(te|los|le|la)\s+dejo\b[\s\S]{0,40}\b(agente|asistente|bot)\b/i,
  /\b(contin[úu]a|contin[úu]e|sigue|segu[ií]s)\b[\s\S]{0,40}\b(agente|asistente|bot)\b/i,
  /\bte\s+(atiende|ayuda|contin[úu]a)\b[\s\S]{0,40}\b(agente|asistente|bot)\b/i,
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
    .where(eq(schema.conversation.id, conversationId))
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
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId, handoffReason: "operador" } },
  });
}
