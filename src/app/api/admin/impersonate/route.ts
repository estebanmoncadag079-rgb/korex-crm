import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { setActiveOrganization } from "@/lib/auth/session";
import { findHomeOrganizationId, findOrganization } from "@/server/admin/clients";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Organización a la que entrar; null = volver a la propia. */
  organizationId: z.string().trim().min(1).nullable(),
});

/**
 * Cambia el tenant activo de la sesión del superadmin ("entrar como cliente").
 * No crea membresías: el acceso se re-evalúa en cada petición contra
 * `platform_role`, así que revocar el rol corta el acceso al instante.
 */
export const POST = withPlatformAdmin(async (session, req: Request) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const target =
    body.data.organizationId ?? (await findHomeOrganizationId(session.userId));
  if (!target) {
    return apiError(422, "invalid", "No hay organización a la que volver");
  }
  if (!(await findOrganization(target))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }
  if (!(await setActiveOrganization(target))) {
    return apiError(401, "unauthorized", "Sesión no encontrada");
  }
  console.info(
    `[admin] ${session.userId} entra en la organización ${target}`
  );
  return Response.json({ organizationId: target });
});
