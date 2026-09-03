import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { findOrganization } from "@/server/admin/clients";
import { sincronizarTemplatesYCloud } from "@/server/whatsapp/sync-ycloud-templates";
import { TemplateError, templateErrorStatus } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  organizationId: z.string().trim().min(1),
});

/**
 * Fase 10D — trae las plantillas creadas DIRECTAMENTE en YCloud (fuera de
 * Korex) hacia la tabla local `template`, para esa organización. Solo
 * superadmin: mismo gate que el resto de `/admin/templates` (sección 21 de
 * la Fase 9M — la gestión de plantillas es exclusiva de la agencia).
 */
export const POST = withPlatformAdmin(async (_session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  if (!(await findOrganization(body.data.organizationId))) {
    return apiError(404, "not_found", "Organización no encontrada");
  }

  try {
    const resultado = await sincronizarTemplatesYCloud(body.data.organizationId);
    return Response.json(resultado);
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
