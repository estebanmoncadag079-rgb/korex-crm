import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { CampanaError, campanaErrorStatus } from "@/server/campaigns/motor";
import { editarBorradorDeCampana, obtenerCampana } from "@/server/campaigns/consultas";
import { resumenRecipientsDeCampana } from "@/server/campaigns/consultas";
import type { AudienceFilter } from "@/server/campaigns/audiencia";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  try {
    const campaign = await obtenerCampana(session.organizationId, id);
    const recipients = await resumenRecipientsDeCampana(session.organizationId, id);
    return Response.json({ campaign, recipients });
  } catch (err) {
    if (err instanceof CampanaError) return apiError(campanaErrorStatus(err), err.code, err.message);
    throw err;
  }
});

const audienceFilterSchema = z
  .union([
    z.object({ type: z.literal("pipeline_stage"), stageIds: z.array(z.string().trim().min(1)) }),
    z.object({ type: z.literal("selected_contacts"), contactIds: z.array(z.string().trim().min(1)) }),
    z.object({
      type: z.literal("fixed_count"),
      limit: z.number().int().positive(),
      selectionStrategy: z.literal("oldest_first"),
    }),
    z.object({ type: z.literal("budget"), budgetUsd: z.number().positive() }),
  ])
  .nullable();

const editarSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  templateId: z.string().trim().min(1).nullable().optional(),
  audienceType: z
    .enum(["todos_los_contactos", "pipeline_stage", "selected_contacts", "fixed_count", "budget"])
    .optional(),
  audienceFilter: audienceFilterSchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, editarSchema);
  if (!body.ok) return body.response;

  try {
    const campaign = await editarBorradorDeCampana(session.organizationId, id, {
      ...body.data,
      audienceFilter: body.data.audienceFilter as AudienceFilter | undefined,
      scheduledAt:
        body.data.scheduledAt === undefined ? undefined : body.data.scheduledAt === null ? null : new Date(body.data.scheduledAt),
    });
    return Response.json({ campaign });
  } catch (err) {
    if (err instanceof CampanaError) return apiError(campanaErrorStatus(err), err.code, err.message);
    throw err;
  }
});
