import { and, eq, ilike, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { CampanaError } from "@/server/campaigns/motor";
import type { AudienceFilter } from "@/server/campaigns/audiencia";

/**
 * Fase 10G — lecturas para la UI/API de campañas: listado, detalle, y el
 * desglose de destinatarios (enviados/entregados/leídos/fallidos/omitidos)
 * que pide la pantalla de campaña. Nada de esto escribe — la escritura
 * vive en `motor.ts`.
 */

type CampaignRow = typeof schema.campaign.$inferSelect;

export function serializeCampana(c: CampaignRow) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    name: c.name,
    status: c.status,
    templateId: c.templateId,
    templateSnapshot: c.templateSnapshot ?? null,
    audienceType: c.audienceType,
    audienceFilter: c.audienceFilter ?? null,
    estimatedRecipients: c.estimatedRecipients,
    estimatedCostUsd: c.estimatedCostUsd,
    currency: c.currency,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    startedAt: c.startedAt?.toISOString() ?? null,
    finishedAt: c.finishedAt?.toISOString() ?? null,
    createdBy: c.createdBy,
    requestedBy: c.requestedBy,
    requestedAt: c.requestedAt?.toISOString() ?? null,
    approvedBy: c.approvedBy,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    rejectionReason: c.rejectionReason,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listarCampanas(input: {
  organizationId: string;
  status?: string;
  q?: string;
}): Promise<ReturnType<typeof serializeCampana>[]> {
  const db = getDb();
  const condiciones: SQL[] = [];
  if (input.status) condiciones.push(eq(schema.campaign.status, input.status as CampaignRow["status"]));
  if (input.q) condiciones.push(ilike(schema.campaign.name, `%${input.q}%`));

  const rows = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, input.organizationId, ...condiciones));
  return rows.map(serializeCampana);
}

export async function obtenerCampana(
  organizationId: string,
  campaignId: string
): Promise<ReturnType<typeof serializeCampana>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)))
    .limit(1);
  const campana = rows[0];
  if (!campana) throw new CampanaError("not_found", "Campaña no encontrada");
  return serializeCampana(campana);
}

export type ResumenRecipientsDeCampana = {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  indeterminado: number;
  delivered: number;
  read: number;
  total: number;
};

/** Desglose por status — igual criterio que `campaign.estimatedRecipients`: derivado con `COUNT`, nunca denormalizado. */
export async function resumenRecipientsDeCampana(
  organizationId: string,
  campaignId: string
): Promise<ResumenRecipientsDeCampana> {
  const db = getDb();
  const filas = await db
    .select({
      pending: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'pending')`,
      sending: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'sending')`,
      sent: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'sent')`,
      failed: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'failed')`,
      skipped: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'skipped')`,
      indeterminado: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'indeterminado')`,
      delivered: sql<number>`count(*) filter (where ${schema.campaignRecipient.deliveredAt} is not null)`,
      read: sql<number>`count(*) filter (where ${schema.campaignRecipient.readAt} is not null)`,
      total: sql<number>`count(*)`,
    })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, organizationId),
        eq(schema.campaignRecipient.campaignId, campaignId)
      )
    );
  const f = filas[0];
  return {
    pending: Number(f?.pending ?? 0),
    sending: Number(f?.sending ?? 0),
    sent: Number(f?.sent ?? 0),
    failed: Number(f?.failed ?? 0),
    skipped: Number(f?.skipped ?? 0),
    indeterminado: Number(f?.indeterminado ?? 0),
    delivered: Number(f?.delivered ?? 0),
    read: Number(f?.read ?? 0),
    total: Number(f?.total ?? 0),
  };
}

/**
 * Edita una campaña mientras sigue en `draft` (nombre, plantilla,
 * audiencia) — antes de congelar nada. Mismo criterio que
 * `editarBorradorDePlantilla`: solo mientras es borrador.
 */
export async function editarBorradorDeCampana(
  organizationId: string,
  campaignId: string,
  input: {
    name?: string;
    templateId?: string | null;
    audienceType?: string;
    audienceFilter?: AudienceFilter;
    scheduledAt?: Date | null;
  }
): Promise<ReturnType<typeof serializeCampana>> {
  const db = getDb();
  const actuales = await db
    .select({ status: schema.campaign.status })
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)))
    .limit(1);
  const actual = actuales[0];
  if (!actual) throw new CampanaError("not_found", "Campaña no encontrada");
  if (actual.status !== "draft") {
    throw new CampanaError("invalid", `Solo se pueden editar campañas en "draft" (estado actual: "${actual.status}")`);
  }

  // Nunca confiar en el frontend: un templateId de otra organización se
  // rechaza aquí, ANTES de cualquier UPDATE (multi-tenant nunca implícito).
  if (input.templateId) {
    const plantillas = await db
      .select({ id: schema.template.id })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, input.templateId)))
      .limit(1);
    if (!plantillas[0]) throw new CampanaError("invalid", "La plantilla no existe en esta organización");
  }

  const updated = await db
    .update(schema.campaign)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
      ...(input.audienceType !== undefined ? { audienceType: input.audienceType as CampaignRow["audienceType"] } : {}),
      ...(input.audienceFilter !== undefined ? { audienceFilter: input.audienceFilter } : {}),
      ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
      updatedAt: new Date(),
    })
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)))
    .returning();
  return serializeCampana(updated[0]!);
}
