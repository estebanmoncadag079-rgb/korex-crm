import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { crearCampana } from "@/server/campaigns/motor";
import { listarCampanas } from "@/server/campaigns/consultas";

export const dynamic = "force-dynamic";

/**
 * Fase 10G — `GET`/`POST /api/campaigns`. Siempre scoped a
 * `session.organizationId` (nunca del body/query, Constitución III): un
 * cliente solo ve y crea campañas de su propia organización.
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const campaigns = await listarCampanas({
    organizationId: session.organizationId,
    status: url.searchParams.get("status") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  return Response.json({ campaigns });
});

const crearSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().trim().min(1).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, crearSchema);
  if (!body.ok) return body.response;

  // Nunca confiar en el frontend: un templateId de otra organización se
  // rechaza aquí, antes de crear nada (multi-tenant nunca implícito).
  if (body.data.templateId) {
    const db = getDb();
    const plantillas = await db
      .select({ id: schema.template.id })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, session.organizationId, eq(schema.template.id, body.data.templateId)))
      .limit(1);
    if (!plantillas[0]) {
      return apiError(422, "invalid", "La plantilla no existe en esta organización");
    }
  }

  const resultado = await crearCampana({
    organizationId: session.organizationId,
    name: body.data.name,
    templateId: body.data.templateId,
    createdBy: `user:${session.userId}`,
  });
  return Response.json({ id: resultado.id }, { status: 201 });
});
