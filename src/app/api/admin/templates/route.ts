import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { findOrganization } from "@/server/admin/clients";
import {
  listAdminTemplates,
  resolverProviderDeOrganizacion,
} from "@/server/admin/templates";
import {
  crearBorradorDePlantilla,
  serializeAdminTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "pending", "approved", "rejected"] as const;

/**
 * Fase 9M — listado CROSS-ORGANIZACIÓN de plantillas para el superadmin,
 * con filtros por organización/estado/proveedor y búsqueda por nombre. Nunca
 * usa `scoped()` (el gate es `withPlatformAdmin`, igual que
 * `GET /api/admin/clients`) — ver `listAdminTemplates()`.
 */
export const GET = withPlatformAdmin(async (_session, req: Request) => {
  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organizationId") ?? undefined;
  const statusParam = url.searchParams.get("status");
  const status = (STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof STATUSES)[number])
    : undefined;
  const provider = url.searchParams.get("provider") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  const templates = await listAdminTemplates({ organizationId, status, provider, q });
  return Response.json({ templates });
});

const createSchema = z.object({
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(60),
  language: z.string().trim().min(2).max(10),
  category: z.enum(["UTILITY", "MARKETING"]),
  body: z.string().trim().min(1).max(1024),
});

/**
 * Fase 9M, sección 5 — crea un BORRADOR (nunca llama al proveedor). El
 * `provider` se resuelve aquí, server-side, a partir de las credenciales
 * reales de la organización (`resolverProviderDeOrganizacion`) — el cliente
 * nunca lo determina. Organización sin proveedor soportado → 409 explícito,
 * antes de tocar `crearBorradorDePlantilla()`.
 */
export const POST = withPlatformAdmin(async (_session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const org = await findOrganization(body.data.organizationId);
  if (!org) return apiError(404, "not_found", "Organización no encontrada");

  const provider = await resolverProviderDeOrganizacion(body.data.organizationId);
  if (!provider) {
    return apiError(
      409,
      "no_provider",
      "Esta organización no tiene ninguna conexión de WhatsApp configurada — conéctala antes de crear plantillas"
    );
  }
  if (provider === "graph") {
    return apiError(
      409,
      "provider_not_supported",
      "Esta organización usa Meta Graph directo — la gestión de plantillas para ese proveedor todavía no está soportada"
    );
  }

  try {
    const template = await crearBorradorDePlantilla(body.data.organizationId, {
      name: body.data.name,
      language: body.data.language,
      category: body.data.category,
      body: body.data.body,
      provider,
    });
    return Response.json({ template: serializeAdminTemplate(template) }, { status: 201 });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
