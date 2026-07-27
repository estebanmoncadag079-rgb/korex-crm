import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isAiConfigured } from "@/lib/env";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  opts?: { immediate?: boolean }
): Promise<void> {
  if (!isAiConfigured()) return;
  scheduleAgentTurn(conversationId, opts);
}
