import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
export const AgentAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("reply"), text: z.string().min(1) }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
  /**
   * Pedido cerrado: se registra en el lead, se avisa por WhatsApp al equipo
   * del negocio y la conversación pasa a manos humanas (el agente calla).
   */
  z.object({
    action: z.literal("notify_order"),
    summary: z.string().min(1),
    farewell: z.string().optional(),
  }),
  /**
   * Mandar una foto que el negocio tiene cargada: la de un producto, su carta,
   * el local.
   *
   * Existe porque hay respuestas que el texto no da bien. Un catálogo de 30
   * servicios escrito en un mensaje de WhatsApp no lo lee nadie, y a "¿cómo se
   * ve el Volumen Ruso?" se responde con la foto del Volumen Ruso.
   *
   * `etiqueta` es como el negocio nombró esa foto al subirla. El servidor la
   * busca entre las suyas y **si no existe degrada a `reply`**: el agente
   * contesta con texto en vez de prometer una imagen que no puede mandar. Es
   * el mismo criterio de los guardarraíles — comprobar el hecho, no confiar en
   * la intención.
   */
  z.object({
    action: z.literal("send_image"),
    etiqueta: z.string().min(1),
    /** El pie de foto. Va en la misma burbuja que la imagen, no aparte. */
    reply: z.string().optional(),
  }),
  /**
   * Vertical de citas (solo orgs con agent_profile.appointmentsEnabled).
   *
   * `consult_availability` es una acción INTERNA: nunca llega al cliente. El
   * servidor calcula los horarios reales y se los devuelve al modelo dentro
   * del mismo turno (ver server/ai/pipeline.ts) — igual que el horario de
   * atención, la disponibilidad la calcula el servidor, jamás el modelo.
   */
  z.object({
    action: z.literal("consult_availability"),
    servicio: z.string().min(1),
    fecha: z.string().optional(),
    especialista: z.string().optional(),
  }),
  z.object({
    action: z.literal("book_appointment"),
    servicio: z.string().min(1),
    fecha: z.string().min(1),
    hora: z.string().min(1),
    especialista: z.string().optional(),
    farewell: z.string().optional(),
  }),
  z.object({
    action: z.literal("reschedule_appointment"),
    servicio: z.string().min(1),
    nuevaFecha: z.string().min(1),
    nuevaHora: z.string().min(1),
    farewell: z.string().optional(),
  }),
  z.object({
    action: z.literal("cancel_appointment"),
    servicio: z.string().min(1),
    farewell: z.string().optional(),
  }),
]);

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una move_stage sin etapa válida (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (action.action === "move_stage") {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
