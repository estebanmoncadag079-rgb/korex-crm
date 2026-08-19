import { z } from "zod";
import { MAX_ITEMS } from "@/server/orders/normalizar";

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
  /**
   * El cliente acaba de dar un dato que este negocio declaró como requisito
   * antes de cerrar (nombre, hoy — ver `server/contacts.ts`, "Requisitos
   * declarados por el negocio").
   *
   * Genérica del núcleo, no de un vertical: ni citas ni pedidos la poseen.
   * Existe por una razón concreta — `update_lead` ya persistía algo del
   * contacto, pero como NOTA LIBRE (`appendLeadNote`); mezclarla con datos
   * ESTRUCTURADOS habría hecho que una sola acción cargara con dos
   * responsabilidades (notas de texto y campos validables). Se separan a
   * propósito (docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md, Regla 11).
   *
   * `requisitoId` tiene que ser uno de los que el negocio declaró — el
   * ejecutor lo rechaza si no, nunca inventa un campo nuevo.
   */
  z.object({
    action: z.literal("provide_requirement"),
    requisitoId: z.string().min(1),
    valor: z.string().min(1),
    /** Para seguir la conversación en el mismo turno — agradecer, retomar lo que se estaba haciendo. */
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
    etiqueta: z.string().min(1).optional(),
    /**
     * El mismo dato en inglés, porque **el modelo lo escribe así**.
     *
     * Verificado contra el pipeline real (13-ago-2026): a "¿cómo se ve el
     * volumen ruso?" el agente eligió bien la acción pero mandó `"label"` en
     * vez de `"etiqueta"`. El esquema la rechazó, se agotaron los reintentos y
     * la conversación acabó derivada a una persona — con la foto cargada y
     * lista para enviar.
     *
     * Y su error es razonable: todo el resto del contrato está en inglés
     * (`action`, `reply`, `text`, `summary`, `farewell`) y la acción se llama
     * `send_image`. El único campo en español era justo el que había que
     * adivinar. Se aceptan los dos en vez de confiar en que acierte — mismo
     * criterio que los guardarraíles: comprobar el hecho, no la intención.
     */
    label: z.string().min(1).optional(),
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
    /**
     * Uno o varios, en el orden en que el cliente los nombró — "manos y pies
     * tradicional" son dos. Cada uno se resuelve por separado contra el
     * catálogo (`buscarServicio`); si el cliente pide varios, TODOS van aquí,
     * nunca una acción por servicio.
     */
    servicios: z.array(z.string().min(1)).min(1).max(MAX_ITEMS),
    fecha: z.string().optional(),
    especialista: z.string().optional(),
  }),
  z.object({
    action: z.literal("book_appointment"),
    servicios: z.array(z.string().min(1)).min(1).max(MAX_ITEMS),
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
]).superRefine((accion, ctx) => {
  /*
   * Una acción que NO se puede ejecutar no debería ser válida.
   *
   * `send_image` acepta la etiqueta en español o en inglés porque el modelo
   * usa las dos (ver la nota del esquema), pero hasta ahora **ninguna de las
   * dos era obligatoria**: una acción sin etiqueta pasaba la validación,
   * llegaba al ejecutor, no encontraba ningún recurso y degradaba a texto —
   * es decir, el cliente leía "te envío el catálogo" y no le llegaba nada.
   * Exactamente el fallo del 18-ago-2026.
   *
   * Se comprueba aquí, y no exigiendo `etiqueta` a secas, para no repetir el
   * bug del 13-ago: entonces se rechazaba `label` y la conversación acabó en
   * manos de una persona con la foto cargada y lista para enviar. Lo que hace
   * falta es que venga UNA de las dos, no una concreta.
   */
  if (accion.action === "send_image" && !accion.etiqueta && !accion.label) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["etiqueta"],
      message:
        'send_image necesita "etiqueta" (o "label") con el nombre EXACTO de la lista de fotos: sin ella no se puede enviar nada. Si lo que quieres no está en esa lista, usa reply y no prometas el envío.',
    });
  }
});

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
