import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getConversation, listMessages } from "@/server/inbox/queries";
import { serializeMessage } from "@/server/inbox/ingest";
import {
  clearHandoff,
  isReturnShortcut,
  isReturnToAgentPhrase,
  markHumanTookOver,
} from "@/server/inbox/handoff-policy";
import { SendError, sendErrorStatus, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const messages = await listMessages(
    session.organizationId,
    id,
    since && !Number.isNaN(since.getTime()) ? since : undefined
  );
  return Response.json({ messages: messages.map(serializeMessage) });
});

const sendSchema = z.object({ text: z.string().trim().min(1).max(4096) });

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  const text = body.data.text;

  // Escribir a mano es tomar la conversación: el agente calla hasta que se le
  // devuelva el turno. Y devolvérselo es igual de simple — decirlo ("te dejo
  // con el asistente") o el atajo #bot, que no se le manda al cliente.
  if (isReturnToAgentPhrase(text)) {
    await clearHandoff(id, session.organizationId);
    if (isReturnShortcut(text)) {
      return Response.json({ handedBackToAgent: true });
    }
  } else {
    await markHumanTookOver(id, session.organizationId);
  }

  try {
    const result = await sendText({
      conversationId: id,
      organizationId: session.organizationId,
      text,
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(sendErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
});
