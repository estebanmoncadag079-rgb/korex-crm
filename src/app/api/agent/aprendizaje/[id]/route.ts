import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { aprobarPropuesta, descartarPropuesta } from "@/server/ai/aprendizaje";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  /** Corrección opcional antes de aprobar. */
  question: z.string().trim().min(3).max(200).optional(),
  answer: z.string().trim().min(3).max(1200).optional(),
});

/**
 * Aprueba o descarta una propuesta. **Solo la agencia**, igual que generarlas.
 *
 * Aprobar es lo que convierte una sugerencia en algo que el agente le dirá a
 * clientes reales, así que pasa por la misma puerta que el análisis.
 */
export const PATCH = withPlatformAdmin(
  async (session, req: Request, ctx: Ctx) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, patchSchema);
    if (!body.ok) return body.response;

    const resultado =
      body.data.decision === "approve"
        ? await aprobarPropuesta(session.organizationId, id, {
            question: body.data.question,
            answer: body.data.answer,
          })
        : await descartarPropuesta(session.organizationId, id);

    if (!resultado.ok) {
      return apiError(404, "not_found", "Esa propuesta ya no está pendiente");
    }
    return Response.json({ ok: true });
  }
);
