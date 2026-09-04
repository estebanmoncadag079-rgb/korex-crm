import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro } from "@/server/registro-de-cambios";
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

  /**
   * Encender/apagar el agente apaga la IA para TODO el negocio a la vez —
   * a diferencia de pasar una conversación puntual a una persona (eso
   * sigue abierto a cualquiera del equipo). Un empleado del negocio
   * apagándolo sin querer deja a todos sus clientes sin respuesta hasta
   * que alguien se dé cuenta; solo la agencia (superadmin de plataforma)
   * puede tocar este interruptor.
   */
  if (body.data.enabled !== undefined && session.platformRole !== "superadmin") {
    return apiError(
      403,
      "forbidden",
      "Solo el administrador de la plataforma puede encender o apagar el agente"
    );
  }

  const db = getDb();
  const leerFila = async () => {
    const [f] = await db
      .select()
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, session.organizationId));
    return (f as unknown as Fila) ?? null;
  };

  const updated = await conRegistro(
    {
      tabla: "agent_profile",
      registro: session.organizationId,
      leerFila,
      // Solo lo que el cliente posee en su panel.
      declarados: [...Object.keys(body.data), "updatedAt"],
      proceso: "api/agent/profile",
      actor: `user:${session.userId}`,
    },
    async () =>
      db
        .update(schema.agentProfile)
        .set({ ...body.data, updatedAt: new Date() })
        .where(scoped(schema.agentProfile.organizationId, session.organizationId))
        .returning()
  );
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
});
