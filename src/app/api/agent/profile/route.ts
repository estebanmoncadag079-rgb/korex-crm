import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      notifyPhones: p.notifyPhones,
      notifyTemplate: p.notifyTemplate,
      notifyTemplateLang: p.notifyTemplateLang,
    },
    aiConfigured: isAiConfigured(),
  });
});

/**
 * Lo que se puede cambiar desde la pantalla del agente.
 *
 * ⚠️ **`name`, `tone`, `instructions`, `escalationRules` y `greeting` ya no se
 * aceptan** (15-ago-2026). Los genera `generarPerfil()` a partir de la ficha del
 * negocio y de `conducta.ts`, y los reescribe entero cada vez que se envía el
 * cuestionario o se pasa `regenerar:flota`: cualquier cosa escrita por aquí
 * duraba hasta el siguiente clic y desaparecía sin dejar rastro.
 *
 * No basta con quitar los campos de la pantalla —la ruta seguiría abierta—, así
 * que se cierran también aquí. Se cambian editando la ficha y regenerando, que
 * es lo que hace que una lección aprendida llegue a **toda la flota** en vez de
 * quedarse en el cliente donde se corrigió.
 */
const putSchema = z.object({
  enabled: z.boolean().optional(),
  /** Números del equipo que reciben el aviso de pedido (CSV). */
  notifyPhones: z.string().max(400).nullable().optional(),
  /** Plantilla aprobada para el aviso (atraviesa la ventana de 24 h). */
  notifyTemplate: z.string().max(120).nullable().optional(),
  notifyTemplateLang: z.string().max(10).nullable().optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.agentProfile)
    .set({ ...body.data, updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
});
