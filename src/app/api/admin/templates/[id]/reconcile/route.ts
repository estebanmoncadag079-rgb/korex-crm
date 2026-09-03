import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import {
  reconciliarCreacionTemplateYCloud,
  serializeAdminTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const reconcileSchema = z.object({
  organizationId: z.string().trim().min(1),
});

/**
 * Fase 9M, sección 15 — "Verificar estado": consulta (nunca crea) el estado
 * real en el proveedor para un envío que quedó AMBIGUOUS. Nunca dispara un
 * segundo POST de creación — solo `reconciliarCreacionTemplateYCloud()`,
 * que a su vez solo hace GET.
 */
export const POST = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, reconcileSchema);
  if (!body.ok) return body.response;

  try {
    const resultado = await reconciliarCreacionTemplateYCloud(body.data.organizationId, id);
    return Response.json({
      reconciliation: resultado.status,
      template: serializeAdminTemplate(resultado.template),
    });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
