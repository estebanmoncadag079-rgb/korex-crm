import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import {
  enviarPlantillaAAprobacion,
  serializeAdminTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const submitSchema = z.object({
  organizationId: z.string().trim().min(1),
  /** Solo para plantillas con {{1}} — la validación real vive en enviarPlantillaAAprobacion(). */
  variableExample: z.string().trim().max(200).optional(),
});

/**
 * Fase 9M, sección 13 — envía un borrador a aprobación server-side. Nunca
 * llama a YCloud/Meta desde el navegador: este endpoint es el único punto
 * que invoca `enviarPlantillaAAprobacion()` (que a su vez llama al
 * adaptador YCloud). El `provider` NO viaja en el body: ya quedó fijado en
 * la fila al crear el borrador (Fase 9M, sección 5/6) — nunca lo decide
 * esta llamada.
 */
export const POST = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, submitSchema);
  if (!body.ok) return body.response;

  try {
    const template = await enviarPlantillaAAprobacion(body.data.organizationId, id, {
      variableExample: body.data.variableExample,
    });
    return Response.json({ template: serializeAdminTemplate(template) });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
