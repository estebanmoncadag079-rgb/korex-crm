import { and, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";

/**
 * Cupo mensual del Laboratorio.
 *
 * Cada corrida simula seis conversaciones completas y las califica con IA:
 * unas 33 llamadas al modelo, que paga la agencia, no el cliente. Sin tope,
 * un cliente curioso pulsando "correr" una tarde cuesta más que su mes entero
 * de conversaciones reales.
 *
 * La agencia no tiene cupo: es quien afina los agentes.
 */

/** Primer instante del mes en curso — el cupo se renueva ahí. */
export function startOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type LabQuota = {
  /** Corridas lanzadas este mes. */
  used: number;
  /** Tope mensual; `null` cuando quien pregunta es la agencia (sin límite). */
  limit: number | null;
  /** Cuántas le quedan; `null` si no tiene tope. */
  left: number | null;
};

export async function labQuota(
  organizationId: string,
  opts: { isAgency?: boolean; now?: Date } = {}
): Promise<LabQuota> {
  const used = await runsSince(organizationId, startOfMonth(opts.now));
  if (opts.isAgency) return { used, limit: null, left: null };
  const limit = getEnv().LAB_RUNS_PER_MONTH;
  return { used, limit, left: Math.max(0, limit - used) };
}

/** ¿Se le agotó el cupo? La agencia nunca. */
export function quotaExhausted(quota: LabQuota): boolean {
  return quota.left !== null && quota.left <= 0;
}

async function runsSince(organizationId: string, since: Date): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.agentTestRun.id })
    .from(schema.agentTestRun)
    .where(
      and(
        scoped(schema.agentTestRun.organizationId, organizationId),
        gte(schema.agentTestRun.startedAt, since)
      )
    );
  return rows.length;
}
