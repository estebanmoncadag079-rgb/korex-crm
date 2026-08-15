import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  question: z.string().trim().min(1).max(500).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  /*
   * El cliente solo puede editar SU conocimiento.
   *
   * Las entradas de origen `operador` son correcciones hechas a mano después de
   * un incidente —la de salud del salón, por ejemplo— y las de origen `agente`
   * salieron de una conversación real. Que el dueño del negocio pueda pisarlas
   * desde su pantalla es la misma puerta que ya costó una corrección médica.
   */
  const updated = await db
    .update(schema.kbEntry)
    .set({ ...body.data, updatedAt: new Date() })
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        and(eq(schema.kbEntry.id, id), eq(schema.kbEntry.origen, "cliente"))
      )
    )
    .returning();
  if (!updated[0]) {
    return apiError(
      404,
      "not_found",
      "Entrada no encontrada, o la puso el equipo y no se puede editar desde aquí"
    );
  }
  return Response.json({ entry: updated[0] });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  // Borrar conocimiento ajeno es peor que editarlo: no deja ni rastro.
  const deleted = await db
    .delete(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        and(eq(schema.kbEntry.id, id), eq(schema.kbEntry.origen, "cliente"))
      )
    )
    .returning();
  if (!deleted[0]) {
    return apiError(
      404,
      "not_found",
      "Entrada no encontrada, o la puso el equipo y no se puede borrar desde aquí"
    );
  }
  return Response.json({ deleted: true });
});
