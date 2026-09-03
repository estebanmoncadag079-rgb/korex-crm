import { desc } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { serializeTemplate } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Solo lectura para el cliente — la vista `/settings/templates` la filtra a
 * `status === "approved"` (Fase 9M, sección 20). Devuelve todas las de su
 * organización tal como siempre: el filtro es de UI, no de este endpoint,
 * para no romper el contrato existente (Fase 9M, sección 21).
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const templates = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, session.organizationId))
    .orderBy(desc(schema.template.createdAt));
  return Response.json({ templates: templates.map(serializeTemplate) });
});

/**
 * Fase 9M, sección 21 — la creación por members/clientes queda cerrada: el
 * único call site (`CreateForm` en `templates-client.tsx`) se retiró en la
 * misma fase. Crear/editar/enviar plantillas ahora vive exclusivamente en
 * `/api/admin/templates` (superadmin, `withPlatformAdmin`). Sin `export
 * const POST` aquí, Next.js responde 405 de forma nativa — no queda ningún
 * camino de creación abierto para member/owner.
 */
