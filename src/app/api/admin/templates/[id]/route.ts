import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import {
  editarBorradorDePlantilla,
  serializeAdminTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /** El superadmin ve/edita cross-tenant: la organización dueña de la plantilla viaja explícita (Fase 9M, sección 3). */
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(60).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  category: z.enum(["UTILITY", "MARKETING"]).optional(),
  body: z.string().trim().min(1).max(1024).optional(),
});

/** Fase 9M, sección 11 — edita un borrador; `editarBorradorDePlantilla()` rechaza si `status !== "draft"`. */
export const PATCH = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const template = await editarBorradorDePlantilla(body.data.organizationId, id, {
      name: body.data.name,
      language: body.data.language,
      category: body.data.category,
      body: body.data.body,
    });
    return Response.json({ template: serializeAdminTemplate(template) });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
