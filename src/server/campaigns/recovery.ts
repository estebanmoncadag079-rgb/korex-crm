import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

/**
 * Recovery de huérfanos de campaña — deliberadamente NO es una copia de
 * `rescatarHuerfanos()` de `agent_job` (Fase 4C, punto 4): un turno de IA
 * huérfano siempre es seguro reintentar (nunca llamó a nada irreversible
 * fuera de la propia base), pero un envío de campaña huérfano puede haber
 * llegado a tocar al proveedor de WhatsApp — reintentarlo a ciegas puede
 * duplicar un mensaje real a un cliente real.
 *
 * La distinción entera de este archivo es una sola pregunta: ¿en qué
 * estado estaba el `campaign_recipient` cuando el job se quedó huérfano?
 *
 * - Todavía en `pending` (el claim nunca llegó a completar su transición a
 *   `sending` — no debería poder pasar dado que `reclamarTrabajoDeCampana`
 *   hace ambas cosas en una sola transacción, pero se contempla igual como
 *   defensa): seguro, el proveedor nunca fue contactado.
 * - Ya en `sending`: AMBIGUO. No hay forma de saber si el proveedor llegó a
 *   procesar el envío antes de que el proceso muriera. Pasa a
 *   `indeterminado`, nunca de vuelta a `pending` en automático.
 */

/**
 * Un job `corriendo` cuyo proceso murió se recupera pasado este tiempo.
 * Más corto que el de `agent_job` (5 min) a propósito: una llamada HTTP a
 * YCloud/Meta dura segundos, no minutos — un job "enviando" por más tiempo
 * que esto ya es sospechoso. Valor PROPUESTO (Fase 4A), sin dato real de
 * latencia de campañas todavía que lo confirme.
 */
export const HUERFANO_CAMPANA_TRAS_MS = 2 * 60_000;

export type ResultadoRescateDeCampana = {
  /** Recipient seguía en `pending`: el job volvió a la cola sin riesgo. */
  recuperadosSeguro: number;
  /** Recipient estaba en `sending`: pasó a `indeterminado`, sin reintento. */
  marcadosIndeterminado: number;
};

/**
 * Se llama periódicamente desde el futuro worker de campañas — nunca desde
 * un endpoint público, y nunca reintenta por su cuenta un envío ambiguo.
 */
export async function rescatarHuerfanosDeCampana(
  timeoutMs: number = HUERFANO_CAMPANA_TRAS_MS
): Promise<ResultadoRescateDeCampana> {
  const db = getDb();

  // Caso A — el recipient nunca llegó a `sending`: reintento automático
  // seguro. No debería ocurrir con el diseño actual del claim (transición
  // atómica), pero se cubre por si un futuro cambio rompe esa garantía.
  const recuperados = (await db.execute(sql`
    UPDATE campaign_send_job j
       SET status = 'pendiente',
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.status = 'corriendo'
       AND j.locked_at < now() - make_interval(secs => ${timeoutMs} / 1000.0)
       AND EXISTS (
             SELECT 1 FROM campaign_recipient r
              WHERE r.id = j.recipient_id AND r.status = 'pending'
           )
    RETURNING j.id
  `)) as unknown as Array<{ id: string }>;

  // Caso B — el recipient está en `sending`: ambiguo, nunca se reintenta
  // solo. El job se cierra como `fallido` (deja de competir por el cupo de
  // concurrencia) y el recipient queda bloqueado en `indeterminado` hasta
  // revisión humana explícita (`salidaManualDeIndeterminado`).
  const ambiguos = (await db.execute(sql`
    SELECT j.id AS job_id, j.recipient_id, j.organization_id
      FROM campaign_send_job j
     WHERE j.status = 'corriendo'
       AND j.locked_at < now() - make_interval(secs => ${timeoutMs} / 1000.0)
       AND EXISTS (
             SELECT 1 FROM campaign_recipient r
              WHERE r.id = j.recipient_id AND r.status = 'sending'
           )
  `)) as unknown as Array<{
    job_id: string;
    recipient_id: string;
    organization_id: string;
  }>;

  for (const { job_id, recipient_id, organization_id } of ambiguos) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.campaignRecipient)
        .set({
          status: "indeterminado",
          error:
            "Recovery: job huérfano encontrado con el recipient en `sending` — " +
            "no se sabe si el proveedor procesó el envío. Requiere revisión manual.",
          updatedAt: new Date(),
        })
        .where(
          scoped(
            schema.campaignRecipient.organizationId,
            organization_id,
            eq(schema.campaignRecipient.id, recipient_id)
          )
        );
      await tx.execute(sql`
        UPDATE campaign_send_job
           SET status = 'fallido',
               locked_at = NULL,
               locked_by = NULL,
               last_error = 'Recovery: recipient quedó en sending sin confirmación — pasa a indeterminado',
               updated_at = now()
         WHERE id = ${job_id}
      `);
    });
  }

  return {
    recuperadosSeguro: recuperados.length,
    marcadosIndeterminado: ambiguos.length,
  };
}

/**
 * A qué puede llevar una salida manual de `indeterminado` — discriminated
 * union en vez de `messageId?: string` genérico (Fase 4F, punto 5): el
 * compilador exige `messageId` exactamente cuando `hacia === "sent"`, así
 * que "marcar sent sin evidencia de un mensaje real" no es un valor que se
 * pueda ni siquiera construir en TypeScript, no solo algo que se valide en
 * runtime.
 */
export type DestinoDeSalidaManual =
  | { hacia: "pending" }
  | { hacia: "failed" }
  | { hacia: "sent"; messageId: string };

/**
 * La única vía para sacar un recipient de `indeterminado` — siempre manual,
 * siempre auditada (Fase 4C, punto 4.D). No la usa ningún proceso
 * automático; existe para el futuro panel de revisión.
 *
 * `hacia` está restringido a los tres destinos que la máquina de estados
 * permite desde `indeterminado` (`estados.ts`).
 *
 * Fase 4F, hallazgos 2 y 3: `motivo` vacío se rechaza, y `hacia: "sent"`
 * exige un `messageId` que además se verifica real — perteneciente a la
 * MISMA organización y, si el recipient ya tiene una conversación
 * asignada, a esa misma conversación — antes de escribir nada. Sin esto,
 * un operador podía marcar "sí se envió" sin ninguna evidencia detrás, y
 * un `messageId` de otra organización podía usarse para resolver un
 * recipient ajeno.
 */
export async function salidaManualDeIndeterminado(
  input: {
    organizationId: string;
    recipientId: string;
    actor: Actor;
    motivo: string;
  } & DestinoDeSalidaManual
): Promise<void> {
  const motivo = input.motivo.trim();
  if (!motivo) {
    throw new Error("salidaManualDeIndeterminado: el motivo no puede estar vacío");
  }

  const db = getDb();
  const donde = scoped(
    schema.campaignRecipient.organizationId,
    input.organizationId,
    eq(schema.campaignRecipient.id, input.recipientId)
  );

  if (input.hacia === "sent") {
    const [recipient] = await db
      .select({ conversationId: schema.campaignRecipient.conversationId })
      .from(schema.campaignRecipient)
      .where(donde)
      .limit(1);
    if (!recipient) {
      throw new Error(
        `salidaManualDeIndeterminado: recipient ${input.recipientId} no encontrado ` +
          `en organización ${input.organizationId}`
      );
    }
    // scoped() por organizationId: un messageId de otra organización nunca
    // aparece en este SELECT, así que nunca puede usarse para resolver un
    // recipient ajeno (Fase 4F, punto 7).
    const [message] = await db
      .select({ id: schema.message.id, conversationId: schema.message.conversationId })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          input.organizationId,
          eq(schema.message.id, input.messageId)
        )
      )
      .limit(1);
    if (!message) {
      throw new Error(
        `salidaManualDeIndeterminado: messageId ${input.messageId} no existe ` +
          `en organización ${input.organizationId}`
      );
    }
    if (recipient.conversationId && recipient.conversationId !== message.conversationId) {
      throw new Error(
        `salidaManualDeIndeterminado: messageId ${input.messageId} pertenece a otra ` +
          `conversación — no coincide con la del recipient ${input.recipientId}`
      );
    }
  }

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db.select().from(schema.campaignRecipient).where(donde);
    return (f as unknown as Fila) ?? null;
  };

  await conRegistro(
    {
      tabla: "campaign_recipient",
      registro: input.recipientId,
      leerFila,
      declarados: ["status", "error", "messageId", "sentAt", "updatedAt"],
      proceso: "salidaManualDeIndeterminado",
      actor: input.actor,
    },
    async () =>
      db
        .update(schema.campaignRecipient)
        .set({
          status: input.hacia,
          error: `Revisión manual: ${motivo}`,
          ...(input.hacia === "sent"
            ? { messageId: input.messageId, sentAt: new Date() }
            : {}),
          updatedAt: new Date(),
        })
        .where(donde)
  );
}
