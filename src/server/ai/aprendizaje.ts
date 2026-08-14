import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { registrarUsoIa } from "@/server/usage";

/**
 * Aprendizaje del agente a partir de conversaciones reales.
 *
 * El modelo no cambia nunca —no hay reentrenamiento—, pero el CONOCIMIENTO del
 * negocio sí puede crecer, y eso es lo que de verdad hace que el agente "sepa
 * más": se lee entero en cada mensaje, así que una entrada nueva surte efecto
 * al instante, sin desplegar nada.
 *
 * Dónde está el conocimiento aprovechable: en lo que una PERSONA del negocio
 * tuvo que responder. Si alguien contestó a mano, casi siempre es porque el
 * agente no supo, y esa respuesta es justo lo que le falta saber.
 */

/** Días de conversación que se revisan. Una semana cubre el ciclo del negocio. */
const DIAS_A_REVISAR = 7;

/**
 * Tope de mensajes cuando se revisa el HISTORIAL de la coexistencia.
 *
 * Al conectar un número, WhatsApp sincroniza hasta 6 meses de chats: son miles
 * de mensajes, no cuatrocientos. Ahí está lo que el negocio ya le contestó a
 * sus clientas durante meses — el mejor material que va a haber para el
 * conocimiento.
 *
 * ⚠️ La ventana de días NO hacía falta tocarla, aunque lo parezca: el filtro
 * es por `createdAt` (cuándo se guardó la fila), y el historial se guarda el
 * día que se importa. Lo que sí falla con el volumen es el tope y el ORDEN.
 */
const MAX_MENSAJES_HISTORIAL = 1200;

/** Tope de mensajes por análisis: acota el costo y el tiempo de espera. */
const MAX_MENSAJES = 400;

/** Cuántas propuestas puede devolver un análisis. */
const MAX_PROPUESTAS = 12;

const Propuestas = z.object({
  propuestas: z
    .array(
      z.object({
        pregunta: z.string().min(3).max(200),
        respuesta: z.string().min(3).max(1200),
        evidencia: z.string().max(300).optional(),
      })
    )
    .max(MAX_PROPUESTAS),
});

export type PropuestaAprendizaje = {
  id: string;
  question: string;
  answer: string;
  evidence: string | null;
};

/**
 * Lee las conversaciones recientes y propone conocimiento nuevo.
 *
 * Devuelve las propuestas guardadas. No toca el conocimiento del negocio: eso
 * solo ocurre cuando alguien aprueba una propuesta.
 */
export async function buscarAprendizajes(
  organizationId: string,
  opts?: {
    /**
     * Mirar también el historial que trajo la coexistencia (hasta 6 meses),
     * no solo la última semana. Se pide a mano: son muchos más mensajes, así
     * que cuesta más y tarda más — tiene sentido una vez, al conectar un
     * cliente nuevo, no cada semana.
     */
    incluirHistorial?: boolean;
  }
): Promise<{ propuestas: PropuestaAprendizaje[]; mensajesRevisados: number }> {
  const db = getDb();
  const desde = new Date(Date.now() - DIAS_A_REVISAR * 24 * 60 * 60 * 1000);
  const tope = opts?.incluirHistorial ? MAX_MENSAJES_HISTORIAL : MAX_MENSAJES;

  const mensajes = await db
    .select({
      direction: schema.message.direction,
      aiGenerated: schema.message.aiGenerated,
      text: schema.message.text,
      createdAt: schema.message.createdAt,
      conversationId: schema.message.conversationId,
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.message.conversationId)
    )
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        gte(schema.message.createdAt, desde),
        // El Laboratorio son clientes simulados: su conversación no enseña
        // nada del negocio real y ensuciaría las propuestas.
        eq(schema.conversation.isTest, false)
      )
    )
    /*
     * Por la fecha REAL del mensaje, no por cuándo se guardó la fila.
     *
     * El historial de la coexistencia entra en un solo lote: todas sus filas
     * tienen prácticamente el mismo `createdAt`, así que ordenar por ahí
     * mezclaba conversaciones de meses distintos y el modelo leía diálogos
     * descosidos. `waTimestamp` es cuándo se dijo de verdad.
     */
    .orderBy(desc(sql`coalesce(${schema.message.waTimestamp}, ${schema.message.createdAt})`))
    .limit(tope);

  if (mensajes.length === 0) {
    return { propuestas: [], mensajesRevisados: 0 };
  }
  mensajes.reverse();

  // Lo que el negocio ya sabe: se le pasa al modelo para que no proponga
  // duplicados con otras palabras.
  const yaSabe = await db
    .select({
      question: schema.kbEntry.question,
      content: schema.kbEntry.content,
    })
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));

  const conocimientoActual = yaSabe
    .map((k) => k.question ?? k.content ?? "")
    .filter(Boolean)
    .join("\n- ");

  const transcripcion = mensajes
    .filter((m) => m.text?.trim())
    .map((m) => {
      const quien =
        m.direction === "in"
          ? "CLIENTE"
          : m.aiGenerated
            ? "AGENTE"
            : "PERSONA DEL NEGOCIO";
      return `[${quien}] ${m.text!.replace(/\s+/g, " ").slice(0, 400)}`;
    })
    .join("\n");

  const instrucciones = [
    "Eres un analista que ayuda a que el asistente de WhatsApp de un negocio aprenda de sus conversaciones reales.",
    "",
    "Te doy transcripciones y el conocimiento que el asistente YA tiene.",
    "Tu tarea: encontrar lo que le FALTA saber, y redactarlo como pregunta y respuesta.",
    "",
    "Dónde mirar, por orden de valor:",
    "1. Lo que respondió una PERSONA DEL NEGOCIO: si tuvo que contestar a mano, casi siempre es porque el asistente no sabía. Esa respuesta es el conocimiento que falta.",
    "2. Preguntas del CLIENTE que quedaron sin responder o se respondieron con vaguedad.",
    "3. Preguntas que varios clientes distintos repiten.",
    "",
    "Reglas duras:",
    "- NO propongas nada que ya esté en el conocimiento actual, ni con otras palabras.",
    "- NO inventes datos. Cada respuesta debe salir de algo que se dijo en las conversaciones.",
    "- Descarta lo puntual de un día ('hoy no hay fresa', 'ya cerramos por hoy'): solo interesa lo que valdrá dentro de un mes.",
    "- Descarta lo de un cliente concreto (su dirección, su pedido): interesa lo del NEGOCIO.",
    "- Redacta la respuesta como se la diría el asistente a un cliente, breve y clara.",
    "- En 'evidencia' pon la frase textual del chat que lo justifica, para que un humano pueda verificarlo rápido.",
    "- Si no hay nada que valga la pena, devuelve la lista vacía. Es una respuesta perfectamente válida.",
    "",
    `Devuelve como MUCHO ${MAX_PROPUESTAS} propuestas, las de más valor.`,
    'Responde ÚNICAMENTE este JSON: {"propuestas":[{"pregunta":"...","respuesta":"...","evidencia":"..."}]}',
  ].join("\n");

  const resultado = await chatJson(Propuestas, [
    { role: "system", content: instrucciones },
    {
      role: "user",
      content: `CONOCIMIENTO QUE YA TIENE:\n- ${conocimientoActual || "(vacío)"}\n\nCONVERSACIONES:\n${transcripcion}`,
    },
  ]);

  // El análisis se paga aunque no encuentre nada: queda en el contador de
  // costos igual que cualquier otro consumo del cliente.
  await registrarUsoIa(organizationId, resultado.usage, "aprendizaje");

  if (!resultado.ok) return { propuestas: [], mensajesRevisados: mensajes.length };

  const nuevas = resultado.data.propuestas;
  if (nuevas.length === 0) {
    return { propuestas: [], mensajesRevisados: mensajes.length };
  }

  const filas = await db
    .insert(schema.learningProposal)
    .values(
      nuevas.map((p) => ({
        id: newId("learning"),
        organizationId,
        question: p.pregunta,
        answer: p.respuesta,
        evidence: p.evidencia ?? null,
      }))
    )
    .returning();

  return {
    propuestas: filas.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      evidence: f.evidence,
    })),
    mensajesRevisados: mensajes.length,
  };
}

/** Propuestas aún sin decidir, de más reciente a más antigua. */
export async function propuestasPendientes(
  organizationId: string
): Promise<PropuestaAprendizaje[]> {
  const filas = await getDb()
    .select()
    .from(schema.learningProposal)
    .where(
      and(
        eq(schema.learningProposal.organizationId, organizationId),
        eq(schema.learningProposal.status, "pending")
      )
    )
    .orderBy(desc(schema.learningProposal.createdAt));
  return filas.map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    evidence: f.evidence,
  }));
}

/**
 * Aprueba una propuesta: pasa a ser conocimiento del negocio.
 *
 * El texto puede venir corregido por quien aprueba — es su última oportunidad
 * de arreglar una redacción antes de que el agente empiece a usarla con
 * clientes reales.
 */
export async function aprobarPropuesta(
  organizationId: string,
  id: string,
  edicion?: { question?: string; answer?: string }
): Promise<{ ok: boolean }> {
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.learningProposal)
    .where(
      and(
        eq(schema.learningProposal.id, id),
        eq(schema.learningProposal.organizationId, organizationId),
        eq(schema.learningProposal.status, "pending")
      )
    )
    .limit(1);
  const propuesta = filas[0];
  if (!propuesta) return { ok: false };

  const kbId = newId("kbEntry");
  await db.insert(schema.kbEntry).values({
    id: kbId,
    organizationId,
    kind: "qa",
    question: edicion?.question?.trim() || propuesta.question,
    answer: edicion?.answer?.trim() || propuesta.answer,
  });

  await db
    .update(schema.learningProposal)
    .set({ status: "approved", kbEntryId: kbId, resolvedAt: new Date() })
    .where(eq(schema.learningProposal.id, id));

  return { ok: true };
}

/** Descarta una propuesta. Se conserva para no volver a proponer lo mismo. */
export async function descartarPropuesta(
  organizationId: string,
  id: string
): Promise<{ ok: boolean }> {
  const filas = await getDb()
    .update(schema.learningProposal)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(
      and(
        eq(schema.learningProposal.id, id),
        eq(schema.learningProposal.organizationId, organizationId),
        eq(schema.learningProposal.status, "pending")
      )
    )
    .returning({ id: schema.learningProposal.id });
  return { ok: filas.length > 0 };
}
