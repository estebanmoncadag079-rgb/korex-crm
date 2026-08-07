import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { serializeConversation, getConversation, updateConversation } from "@/server/inbox/queries";
import { maybeRunAgentTurn } from "@/server/ai/trigger";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiEnabled: z.boolean().optional(),
  reactivate: z.boolean().optional(),
  markRead: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const updated = await updateConversation(session.organizationId, id, body.data);
  if (!updated) return apiError(404, "not_found", "Conversación no encontrada");

  /**
   * Devolver el turno desde la bandeja hace lo mismo que el comando desde el
   * celular: el agente retoma en el acto, sin esperar a que el cliente vuelva
   * a escribir (ver `ingestOutboundEcho`). Si no hay nada pendiente del
   * cliente, el turno se omite solo.
   *
   * Aislado a propósito: la conversación ya quedó reactivada en la base, y un
   * fallo del agente no puede convertir eso en un error de la petición.
   */
  if (body.data.reactivate) {
    try {
      await maybeRunAgentTurn(id, { immediate: true });
    } catch (err) {
      console.error("[bandeja] la IA no pudo retomar tras reactivar:", err);
    }
  }

  const row = await getConversation(session.organizationId, id);
  if (row) {
    const dto = serializeConversation(row.conversation, row.contact);
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: dto },
    });
    return Response.json({ conversation: dto });
  }
  return Response.json({ conversation: null });
});
