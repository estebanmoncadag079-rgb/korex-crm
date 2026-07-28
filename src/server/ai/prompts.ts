import type { schema } from "@/lib/db";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 */
/**
 * Fecha y hora del negocio en palabras. El agente no tiene reloj: sin esto no
 * puede saber si el cliente está escribiendo dentro del horario de atención,
 * y un negocio necesita responder distinto a las 3 de la tarde que a medianoche.
 */
export function nowForBusiness(now: Date = new Date(), timeZone = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    // 24 horas a propósito: con am/pm el agente leía las 12:02 de la
    // madrugada como si cayeran dentro de un horario que abre a las 12:30 pm,
    // y le decía al cliente que el negocio estaba abierto a medianoche.
    hour12: false,
  }).format(now);
}

/** Zona del negocio. Hoy todos los clientes son colombianos. */
const BUSINESS_TIMEZONE = "America/Bogota";

/**
 * ¿El negocio está atendiendo en este momento?
 *
 * Se resuelve aquí y se le entrega dicho, no deducido: pedirle al agente que
 * compare la hora contra un horario escrito en prosa falla justo donde más
 * duele — leía las 12:02 de la madrugada como si cayeran dentro de un horario
 * que abre a las 12:30 pm y le decía al cliente que estaba abierto.
 *
 * Devuelve `null` cuando el negocio no tiene horario configurado: en ese caso
 * es mejor no decir nada que arriesgar una afirmación falsa.
 */
export function businessStatus(
  hours: { open: string | null; close: string | null; days: string | null },
  now: Date = new Date(),
  timeZone = BUSINESS_TIMEZONE
): "abierto" | "cerrado" | null {
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  if (open === null || close === null) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ahora = Number(get("hour")) * 60 + Number(get("minute"));
  const dia = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    .indexOf(get("weekday").toLowerCase().slice(0, 3)) + 1;

  const dias = (hours.days ?? "1,2,3,4,5,6,7")
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 1 && d <= 7);
  if (dias.length > 0 && !dias.includes(dia)) return "cerrado";

  // Un cierre "menor" que la apertura cruza la medianoche (ej. 18:00–02:00).
  const dentro =
    close > open ? ahora >= open && ahora < close : ahora >= open || ahora < close;
  return dentro ? "abierto" : "cerrado";
}

function toMinutes(hhmm: string | null | undefined): number | null {
  const m = hhmm?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** La hora y, si hay horario configurado, si el negocio atiende ahora mismo. */
function estadoDelNegocio(profile: AgentProfile, now?: Date): string {
  const hora = `Ahora mismo es ${nowForBusiness(now)} en Colombia (formato 24 h).`;
  const estado = businessStatus(
    { open: profile.hoursOpen, close: profile.hoursClose, days: profile.hoursDays },
    now
  );
  if (!estado) return hora;
  return estado === "abierto"
    ? `${hora} EL NEGOCIO ESTÁ ABIERTO ahora mismo: atiende con normalidad y NO menciones reagendar.`
    : `${hora} EL NEGOCIO ESTÁ CERRADO ahora mismo: aplica la regla de pedidos fuera del horario.`;
}

export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  stages: { name: string }[];
  now?: Date;
}): string {
  const { profile } = input;
  const stageNames = input.stages.map((s) => s.name).join(" | ");
  return [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat.`,
    estadoDelNegocio(profile, input.now),
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; si algo no está aquí, NO lo inventes — di que lo confirmarás con el equipo o escala):\n${renderKb(input.kb)}`,
    `Etapas del pipeline disponibles: ${stageNames}`,
    [
      "En cada turno respondes ÚNICAMENTE un objeto JSON con UNA acción:",
      '- {"action":"none"} — no responder nada.',
      '- {"action":"reply","text":"..."} — responder al cliente.',
      '- {"action":"update_lead","note":"...","reply":"..."} — guardar una nota del lead (reply opcional).',
      '- {"action":"move_stage","stage":"<nombre exacto de etapa>","reply":"..."} — mover el lead (reply opcional).',
      '- {"action":"handoff","reason":"...","farewell":"..."} — escalar a un humano (farewell opcional para despedirte).',
      '- {"action":"notify_order","summary":"...","farewell":"..."} — el cliente CONFIRMÓ un pedido: en summary va el pedido completo (cliente, teléfono, qué pidió, dirección, pago y total) porque se le envía tal cual al equipo por WhatsApp; farewell es tu mensaje de cierre al cliente.',
      "Reglas duras:",
      "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
      "- Cuando el cliente confirme un pedido y tengas todos sus datos → notify_order (NO uses reply para eso: sin esta acción el equipo no se entera del pedido).",
      "- Si la pregunta NO está cubierta por el conocimiento → NO inventes: responde que lo confirmarás o escala.",
      "- Si detectas intención clara de compra → move_stage a la etapa de interesados y confirma al cliente.",
      "- JSON puro, sin markdown ni texto adicional.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Si el cliente pidió un humano y no hubo escalado → debio_escalar.",
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
