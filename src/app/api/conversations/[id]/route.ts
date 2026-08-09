import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { serializeConversation, getConversation, updateConversation } from "@/server/inbox/queries";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { onLeadWon } from "@/server/inbox/lead-activity";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiEnabled: z.boolean().optional(),
  reactivate: z.boolean().optional(),
  markRead: z.boolean().optional(),
  /** Cerrar la venta a mano: el lead pasa a la etapa de cierre del embudo. */
  markWon: z.boolean().optional(),
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

  /**
   * Cierre manual de la venta (9-ago-2026).
   *
   * El embudo se cierra solo con un pedido del agente o con un comprobante de
   * pago, pero ninguna de las dos cubre lo que se cobra en efectivo o por una
   * vía que no deja rastro en el chat. Sin esto había que ir al tablero a
   * buscar la tarjeta y arrastrarla.
   */
  if (body.data.markWon && row) {
    try {
      await onLeadWon(session.organizationId, row.conversation.contactId);
    } catch (err) {
      console.error("[bandeja] no se pudo marcar el lead como cliente:", err);
      return apiError(500, "lead_no_movido", "No se pudo marcar como cliente");
    }
  }

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
