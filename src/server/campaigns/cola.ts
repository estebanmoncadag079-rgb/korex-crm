import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { CampaignRecipientStatus } from "@/server/campaigns/estados";
import { transicionAutomaticaPermitida } from "@/server/campaigns/estados";

/**
 * La cola de envío de campañas, sobre Postgres — mismo patrón que
 * `src/server/ai/cola.ts` (`FOR UPDATE SKIP LOCKED`, backoff, rescate de
 * huérfanos en `recovery.ts`), diseñado en la auditoría de idempotencia de
 * la Fase 4A (2-sep-2026) y clonado aquí a propósito en vez de reutilizar
 * `agent_job`: ese patrón está atado a `conversationId` y a la
 * coalescencia de turnos, dos conceptos que no existen aquí — un
 * destinatario de campaña tiene un solo intento de vida, no turnos que se
 * repiten.
 *
 * Nada en este módulo llama a un proveedor de WhatsApp. Recibe SIEMPRE el
 * resultado ya obtenido de esa llamada (o ninguna llamada en absoluto) —
 * la frontera entre "esto es local y puede ser una transacción" y "esto
 * tocó una API externa" la traza el llamante, nunca este archivo.
 */

/** Intentos totales antes de dar un envío de campaña por fallido. */
export const MAX_INTENTOS_CAMPANA = 2;

/**
 * Menos pasos y más cortos que `agent_job` (`[10s,60s,300s,900s]`): un
 * fallo de ENVÍO rara vez se resuelve solo esperando, a diferencia de un
 * turno de IA que puede toparse con un rate-limit transitorio del modelo.
 * Valor PROPUESTO (Fase 4A) — sin dato real de campañas todavía que lo
 * confirme.
 */
const ESPERA_REINTENTO_CAMPANA_MS = [30_000, 180_000];

/**
 * Cuántos envíos de campaña puede tener UNA organización corriendo a la
 * vez. Mismo espíritu que `CONCURRENCIA_POR_ORG` de `agent_job`, valor
 * PROPUESTO más conservador (Fase 3B/4A): el riesgo de bloqueo de número
 * por envío masivo es mayor que el de turnos conversacionales 1:1.
 */
export const CONCURRENCIA_CAMPANA_POR_ORG = 1;

export type TrabajoDeCampanaTomado = {
  jobId: string;
  recipientId: string;
  campaignId: string;
  organizationId: string;
  attempts: number;
};

/**
 * Reclama el siguiente envío de campaña pendiente y, en la MISMA
 * transacción, deja evidencia persistente de que el worker alcanzó el
 * punto en que puede intentar la llamada externa — la pieza central de la
 * estrategia de idempotencia (Fase 4A): si el proceso muere justo después
 * de esta función, `campaign_recipient` ya quedó en `sending`, y el
 * recovery (`recovery.ts`) sabrá que NUNCA debe reintentar solo.
 *
 * `SKIP LOCKED` es lo que garantiza, a nivel de Postgres y no de
 * aplicación, que dos workers no puedan reclamar el mismo job — ver el
 * análisis de concurrencia de la Fase 4A.
 *
 * Devuelve `null` si no hay trabajo listo. Lanza si encuentra una
 * inconsistencia de integridad referencial (el recipient del job no
 * pertenece a la organización/campaña del propio job) — nunca debería
 * ocurrir dado el diseño de FK, pero se comprueba explícitamente en vez de
 * confiar solo en ellas (Fase 4C, punto 13: multi-tenant nunca implícito).
 */
export async function reclamarTrabajoDeCampana(
  worker: string
): Promise<TrabajoDeCampanaTomado | null> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const filas = (await tx.execute(sql`
      UPDATE campaign_send_job
         SET status = 'corriendo',
             locked_at = now(),
             locked_by = ${worker},
             attempts = campaign_send_job.attempts + 1,
             updated_at = now()
       WHERE campaign_send_job.id = (
         SELECT c.id
           FROM campaign_send_job c
          WHERE c.status = 'pendiente'
            AND c.run_at <= now()
            AND (
                  SELECT count(*) FROM campaign_send_job o
                   WHERE o.organization_id = c.organization_id
                     AND o.status = 'corriendo'
                ) < ${CONCURRENCIA_CAMPANA_POR_ORG}
          ORDER BY c.run_at
            FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING campaign_send_job.id,
                campaign_send_job.organization_id,
                campaign_send_job.campaign_id,
                campaign_send_job.recipient_id,
                campaign_send_job.attempts
    `)) as unknown as Array<{
      id: string;
      organization_id: string;
      campaign_id: string;
      recipient_id: string;
      attempts: number;
    }>;

    const job = filas[0];
    if (!job) return null;

    // Multi-tenant explícito (punto 13): el job no trae organizationId de
    // ningún cliente, pero se revalida igual contra el propio recipient —
    // belt-and-suspenders sobre la FK, nunca confiar solo en la referencia.
    const recipientRows = await tx
      .select({ status: schema.campaignRecipient.status })
      .from(schema.campaignRecipient)
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          job.organization_id,
          eq(schema.campaignRecipient.id, job.recipient_id),
          eq(schema.campaignRecipient.campaignId, job.campaign_id)
        )
      )
      .limit(1);
    const recipient = recipientRows[0];
    if (!recipient) {
      throw new Error(
        `reclamarTrabajoDeCampana: job ${job.id} no encuentra un recipient ` +
          `${job.recipient_id} coherente con organización ${job.organization_id} ` +
          `y campaña ${job.campaign_id} — dato corrupto, aborta la transacción`
      );
    }
    if (!transicionAutomaticaPermitida(recipient.status as CampaignRecipientStatus, "sending")) {
      throw new Error(
        `reclamarTrabajoDeCampana: recipient ${job.recipient_id} en estado ` +
          `"${recipient.status}" no admite pasar a "sending" — job ${job.id}`
      );
    }

    await tx
      .update(schema.campaignRecipient)
      .set({ status: "sending", lastAttemptAt: new Date(), updatedAt: new Date() })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          job.organization_id,
          eq(schema.campaignRecipient.id, job.recipient_id)
        )
      );

    return {
      jobId: job.id,
      recipientId: job.recipient_id,
      campaignId: job.campaign_id,
      organizationId: job.organization_id,
      attempts: Number(job.attempts),
    };
  });
}

/**
 * Persiste, en UNA sola transacción local, el resultado de un envío que el
 * proveedor YA aceptó — la llamada de red ya ocurrió antes de invocar esta
 * función y su resultado (`waMessageId`) llega como parámetro (Fase 4C,
 * punto 6): esta función nunca llama a `sendTemplate()` ni a ningún
 * proveedor.
 *
 * Las tres escrituras (mensaje, recipient, cierre del job) se confirman
 * juntas o ninguna: si el `INSERT` de `message` fallara, la transacción
 * entera revierte y el `campaign_recipient` NUNCA queda "a medias" en
 * `sent` sin su mensaje real detrás (Fase 4C, punto 9).
 */
export async function registrarEnvioExitosoDeCampana(input: {
  jobId: string;
  recipientId: string;
  organizationId: string;
  conversationId: string;
  waMessageId: string;
  text: string | null;
}): Promise<{ messageId: string }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    /**
     * Guardia de la Fase 4F: relee y BLOQUEA (`FOR UPDATE`) el recipient
     * dentro de esta misma transacción, y solo sigue si su estado actual
     * admite `sending → sent` según `estados.ts` — única fuente de verdad,
     * la misma que usa `reclamarTrabajoDeCampana`. Sin esto, un worker
     * "lento pero vivo" podía sobrescribir en silencio un `indeterminado`
     * que el recovery ya había puesto (Fase 4E, hallazgo 1) — el `FOR
     * UPDATE` cierra la ventana de carrera: mientras esta transacción tiene
     * la fila bloqueada, un `rescatarHuerfanosDeCampana` concurrente espera
     * a que termine, así que nunca hay una lectura obsoleta del status.
     */
    const [recipientActual] = await tx
      .select({ status: schema.campaignRecipient.status })
      .from(schema.campaignRecipient)
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      )
      .for("update")
      .limit(1);
    if (!recipientActual) {
      throw new Error(
        `registrarEnvioExitosoDeCampana: recipient ${input.recipientId} no encontrado ` +
          `en organización ${input.organizationId} — aborta la transacción`
      );
    }
    if (
      !transicionAutomaticaPermitida(
        recipientActual.status as CampaignRecipientStatus,
        "sent"
      )
    ) {
      throw new Error(
        `registrarEnvioExitosoDeCampana: recipient ${input.recipientId} en estado ` +
          `"${recipientActual.status}" ya no admite pasar a "sent" — probablemente ` +
          `el recovery ya lo marcó indeterminado mientras este envío estaba en camino`
      );
    }

    const inserted = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        waMessageId: input.waMessageId,
        direction: "out",
        type: "template",
        text: input.text,
        status: "pending",
        aiGenerated: false,
      })
      .onConflictDoNothing({ target: [schema.message.waMessageId] })
      .returning();
    const message = inserted[0];
    if (!message) {
      throw new Error(
        `registrarEnvioExitosoDeCampana: waMessageId ${input.waMessageId} ya existía — ` +
          `posible reintento duplicado, aborta sin tocar campaign_recipient`
      );
    }

    const actualizado = await tx
      .update(schema.campaignRecipient)
      .set({
        status: "sent",
        sentAt: new Date(),
        messageId: message.id,
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      )
      .returning({ id: schema.campaignRecipient.id });
    if (!actualizado[0]) {
      throw new Error(
        `registrarEnvioExitosoDeCampana: recipient ${input.recipientId} no encontrado ` +
          `en organización ${input.organizationId} — aborta la transacción`
      );
    }

    await tx.execute(
      sql`DELETE FROM campaign_send_job WHERE id = ${input.jobId}`
    );

    return { messageId: message.id };
  });
}

/**
 * Registra un fallo EXPLÍCITO del proveedor — solo para el caso A del
 * análisis de la Fase 4A (una respuesta clara y negativa, no un timeout ni
 * una excepción de red ambigua). Nunca debe llamarse para los casos B/C
 * (timeout, crash): esos simplemente no llaman a esta función, el job
 * queda en `corriendo`/`sending` sin resolución y es
 * `rescatarHuerfanosDeCampana()` quien eventualmente lo mueve a
 * `indeterminado` — nunca a `failed` automáticamente, porque `failed`
 * afirma con certeza que el proveedor rechazó el envío, algo que un
 * timeout no permite afirmar.
 */
export async function registrarFalloEnvioDeCampana(input: {
  jobId: string;
  recipientId: string;
  organizationId: string;
  errorProveedor: string;
  attempts: number;
}): Promise<{ reintenta: boolean }> {
  const db = getDb();
  const recorte = input.errorProveedor.slice(0, 2000);

  return db.transaction(async (tx) => {
    // Misma guardia que registrarEnvioExitosoDeCampana (Fase 4F, hallazgo 1):
    // bloquea y revalida contra estados.ts antes de escribir. Un huérfano que
    // el recovery ya marcó `indeterminado` no debe poder recibir un `failed`
    // tardío tampoco.
    const [recipientActual] = await tx
      .select({ status: schema.campaignRecipient.status })
      .from(schema.campaignRecipient)
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      )
      .for("update")
      .limit(1);
    if (!recipientActual) {
      throw new Error(
        `registrarFalloEnvioDeCampana: recipient ${input.recipientId} no encontrado ` +
          `en organización ${input.organizationId} — aborta la transacción`
      );
    }
    if (
      !transicionAutomaticaPermitida(
        recipientActual.status as CampaignRecipientStatus,
        "failed"
      )
    ) {
      throw new Error(
        `registrarFalloEnvioDeCampana: recipient ${input.recipientId} en estado ` +
          `"${recipientActual.status}" ya no admite pasar a "failed" — probablemente ` +
          `el recovery ya lo marcó indeterminado mientras este envío estaba en camino`
      );
    }

    // El error queda registrado siempre, reintente o no — es evidencia de
    // qué pasó, no solo el estado final.
    await tx
      .update(schema.campaignRecipient)
      .set({ status: "failed", failedAt: new Date(), error: recorte, updatedAt: new Date() })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      );

    if (input.attempts >= MAX_INTENTOS_CAMPANA) {
      await tx.execute(sql`
        UPDATE campaign_send_job
           SET status = 'fallido',
               locked_at = NULL,
               locked_by = NULL,
               last_error = ${recorte},
               updated_at = now()
         WHERE id = ${input.jobId}
      `);
      return { reintenta: false };
    }

    // Reintenta: el recipient vuelve a pending (transición failed→pending,
    // explícita en la máquina de estados) y el job se reprograma con
    // backoff — mismo mecanismo que `fallarTrabajo` de agent_job.
    const espera =
      ESPERA_REINTENTO_CAMPANA_MS[
        Math.min(input.attempts - 1, ESPERA_REINTENTO_CAMPANA_MS.length - 1)
      ] ?? ESPERA_REINTENTO_CAMPANA_MS[0];

    await tx
      .update(schema.campaignRecipient)
      .set({ status: "pending", updatedAt: new Date() })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          input.organizationId,
          eq(schema.campaignRecipient.id, input.recipientId)
        )
      );

    await tx.execute(sql`
      UPDATE campaign_send_job
         SET status = 'pendiente',
             locked_at = NULL,
             locked_by = NULL,
             last_error = ${recorte},
             run_at = now() + make_interval(secs => ${espera} / 1000.0),
             updated_at = now()
       WHERE id = ${input.jobId}
    `);
    return { reintenta: true };
  });
}
