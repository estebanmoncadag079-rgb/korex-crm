import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Los promedios REALES de cada cliente, para no cotizar a ojo.
 *
 * La pregunta que hay que contestar antes de dar un precio es "¿cuántos
 * mensajes le toma a este negocio cerrar una venta?", y hasta ahora se
 * respondía a sentimiento. Con dos clientes ya funcionando, la respuesta está
 * en la base: se traen sus números para usarlos de punto de partida al cotizar
 * a un negocio parecido.
 *
 * Se separan los mensajes del BOT de los de una PERSONA porque cuestan
 * distinto: los dos pagan WhatsApp, pero solo el del bot paga IA.
 */
export type PromedioCliente = {
  organizationId: string;
  nombre: string;
  conversaciones: number;
  mensajesBot: number;
  mensajesPersona: number;
  /** Los dos números que se llevan a la calculadora. */
  botPorConversacion: number;
  personaPorConversacion: number;
};

export async function promediosPorCliente(): Promise<PromedioCliente[]> {
  const db = getDb();

  const filas = await db
    .select({
      organizationId: schema.organization.id,
      nombre: schema.organization.name,
      conversaciones: sql<number>`count(distinct ${schema.conversation.id})`,
      mensajesBot: sql<number>`count(*) filter (
        where ${schema.message.direction} = 'out' and ${schema.message.aiGenerated}
      )`,
      mensajesPersona: sql<number>`count(*) filter (
        where ${schema.message.direction} = 'out' and not ${schema.message.aiGenerated}
      )`,
    })
    .from(schema.organization)
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.conversation.organizationId, schema.organization.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .innerJoin(
      schema.message,
      eq(schema.message.conversationId, schema.conversation.id)
    )
    .groupBy(schema.organization.id, schema.organization.name);

  return filas
    .map((f) => {
      const conversaciones = Number(f.conversaciones) || 0;
      const bot = Number(f.mensajesBot) || 0;
      const persona = Number(f.mensajesPersona) || 0;
      return {
        organizationId: f.organizationId,
        nombre: f.nombre,
        conversaciones,
        mensajesBot: bot,
        mensajesPersona: persona,
        botPorConversacion: conversaciones > 0 ? bot / conversaciones : 0,
        personaPorConversacion: conversaciones > 0 ? persona / conversaciones : 0,
      };
    })
    // Un cliente sin conversaciones no aporta un promedio, aporta ruido.
    .filter((f) => f.conversaciones > 0)
    .sort((a, b) => b.conversaciones - a.conversaciones);
}
