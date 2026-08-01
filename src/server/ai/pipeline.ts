import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { contactPhoneOf, notifyTeam } from "@/server/ai/notify-team";
import { onLeadWon } from "@/server/inbox/lead-activity";
import { buildAgentSystemPrompt, businessStatus, type CatalogEntry } from "@/server/ai/prompts";
import {
  buscarServicio,
  esFechaValida,
  horaAAmPm,
  normalizarFecha,
  utcAFechaHoraBogota,
  type BusinessHours,
} from "@/server/appointments/logic";
import {
  cancelarCita,
  catalogoParaPrompt,
  citasActivasDeContacto,
  crearCita,
  disponibilidadReal,
  proximasFechasConCupo,
  reprogramarCita,
  resolverEspecialista,
} from "@/server/appointments/queries";
import {
  anunciaCierre,
  CORRECCION_DE_CIERRE_FALSO,
  MENSAJE_RETIRADO,
} from "@/server/ai/anuncio-de-cierre";
import { registrarUsoIa } from "@/server/usage";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

/**
 * Mensajes de historial que ve el agente en cada turno. Exportado porque el
 * Laboratorio depende de él: una conversación simulada que no quepa entera aquí
 * empieza a olvidar su propio principio, y el juez califica a un agente
 * amnésico creyendo que califica al de producción.
 */
export const HISTORY_LIMIT = 20;

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/**
 * Punto de entrada con debounce (mensajes entrantes reales).
 *
 * `immediate` salta la espera: se usa en el PRIMER mensaje de una conversación,
 * donde no hay nada que agrupar (quien saluda con "hola" no viene escribiendo
 * en ráfaga) y la espera solo se nota — es el momento en que el cliente aún no
 * tiene nada que leer mientras el agente piensa.
 */
export function scheduleAgentTurn(
  conversationId: string,
  opts?: { immediate?: boolean }
): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = opts?.immediate ? 0 : getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Convierte el historial guardado en los turnos que ve el agente.
 *
 * Sus respuestas se le devuelven CON el envoltorio de acción. De la respuesta
 * solo se guarda el texto que salió al cliente, y verse a sí mismo hablando en
 * prosa le hacía abandonar el formato a mitad de la conversación: contestaba
 * bien pero sin envoltorio, se agotaban los reintentos y el pedido terminaba
 * derivado a una persona.
 *
 * Lo que escribe una PERSONA del equipo desde la bandeja también sale como
 * `out`, y dárselo con el envoltorio de acción le hacía creer que lo había
 * dicho él. Un compañero avisó "hoy abrimos a la 1pm" y el agente, coherente
 * con unas palabras que no eran suyas, empezó a decirle a un cliente que ya
 * habían cerrado con el negocio abierto. Se marca como ajeno para que no se lo
 * atribuya — pero sin darle autoridad: el horario lo decide el servidor.
 *
 * `estado` cura el historial. Un mensaje suyo que anunciaba un cierre no
 * caduca solo: se queda en la conversación y el agente lo repite por coherencia
 * con lo que ya dijo, aunque el sistema le esté diciendo que el negocio está
 * abierto. Con el historial real de producción, el modelo lo reprodujo 5 veces
 * de cada 6. Se le retira el texto — no el turno — para que no tenga qué copiar.
 */
export function toChatHistory(
  history: { direction: string; text: string | null; aiGenerated?: boolean }[],
  estado?: "abierto" | "cerrado" | null
): ChatMessage[] {
  return history
    .filter((m) => m.text)
    .map((m) => {
      if (m.direction === "in") return { role: "user" as const, content: m.text! };
      if (m.aiGenerated === false) {
        return {
          role: "user" as const,
          content: `[Lo escribió una persona del negocio al cliente, NO tú. Tenlo en cuenta para no repetirlo ni contradecirlo, pero no cambies por esto lo que sabes del horario]: ${m.text!}`,
        };
      }
      const texto =
        estado === "abierto" && anunciaCierre(m.text) ? MENSAJE_RETIRADO : m.text!;
      return {
        role: "assistant" as const,
        content: JSON.stringify({ action: "reply", text: texto }),
      };
    });
}

/** Los textos de una acción que llegan a ojos del cliente. */
export function textosAlCliente(action: AgentActionType): string[] {
  switch (action.action) {
    case "reply":
      return [action.text];
    case "update_lead":
    case "move_stage":
      return action.reply ? [action.reply] : [];
    case "handoff":
      return action.farewell ? [action.farewell] : [];
    case "notify_order":
      // El summary va al equipo, no al cliente, pero un pedido marcado como
      // "reagendado para mañana" con el negocio abierto llega a la cocina como
      // un pedido que nadie prepara hoy: cuenta igual.
      return [action.summary, ...(action.farewell ? [action.farewell] : [])];
    case "book_appointment":
    case "reschedule_appointment":
    case "cancel_appointment":
      // La confirmación que ve el cliente la compone el servidor (deterministic,
      // no puede alucinar un cierre); solo el farewell es texto libre del modelo.
      return action.farewell ? [action.farewell] : [];
    default:
      return [];
  }
}

/**
 * Resuelve una `consult_availability`: valida el servicio y la especialista
 * pedidos contra el catálogo real, y calcula los horarios reales. Devuelve un
 * mensaje de sistema en primera persona del servidor — nunca datos inventados,
 * y nunca algo que vaya a los ojos del cliente directamente.
 */
async function resolverConsultaDisponibilidad(
  organizationId: string,
  services: CatalogEntry[],
  hours: BusinessHours,
  action: Extract<AgentActionType, { action: "consult_availability" }>,
  now?: Date
): Promise<string> {
  const servicio = buscarServicio(services, action.servicio);
  if (!servicio) {
    const nombres = services.map((s) => s.name).join(", ") || "(sin servicios configurados)";
    return `[SISTEMA] No encontré "${action.servicio}" en el catálogo. Servicios reales: ${nombres}. Pregúntale al cliente cuál de estos quiere.`;
  }
  const enCatalogo = services.find((s) => s.id === servicio.id);
  if (!enCatalogo?.staffNames.length) {
    return `[SISTEMA] "${servicio.name}" no tiene especialista asignado todavía: no se puede agendar. Dile al cliente que ese servicio no está disponible para agendar por ahora.`;
  }

  const resuelto = await resolverEspecialista(organizationId, servicio.id, action.especialista);
  if (!resuelto.ok) {
    return `[SISTEMA] "${action.especialista}" no atiende "${servicio.name}". Quienes SÍ lo atienden: ${resuelto.opciones.join(", ")}. Ofrécele solo esas opciones.`;
  }

  if (action.fecha) {
    const fecha = normalizarFecha(action.fecha) ?? action.fecha;
    if (!esFechaValida(fecha, hours, now)) {
      return `[SISTEMA] "${fecha}" no es una fecha agendable (ya pasó o el negocio no atiende ese día). Pídele otra fecha.`;
    }
    const disp = await disponibilidadReal({
      organizationId,
      service: servicio,
      fecha,
      staffIdPreferido: resuelto.staffId,
      hours,
      now,
    });
    const horas = Object.keys(disp).sort();
    if (!horas.length) {
      return `[SISTEMA] No hay horarios libres para "${servicio.name}" el ${fecha}. Ofrece otra fecha.`;
    }
    const lista = horas.map((h) => horaAAmPm(h)).join(", ");
    return `[SISTEMA] Horarios REALES disponibles para "${servicio.name}" el ${fecha}: ${lista}. Ofrécele SOLO estas opciones para que el cliente elija.`;
  }

  const proximas = await proximasFechasConCupo({
    organizationId,
    service: servicio,
    staffIdPreferido: resuelto.staffId,
    hours,
    now,
  });
  if (!proximas.length) {
    return `[SISTEMA] No encontré cupos próximos para "${servicio.name}". Dile al cliente que lo confirmas con el equipo.`;
  }
  const texto = proximas
    .map((p) => `${p.fecha}: ${p.horarios.map(horaAAmPm).join(", ")}`)
    .join(" | ");
  return `[SISTEMA] Próximas fechas con cupo para "${servicio.name}": ${texto}. Ofrécele elegir día y hora de estas opciones reales.`;
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 *
 * Devuelve la acción que acabó ejecutando, o null si no hubo turno. Nadie en
 * producción lo usa: existe para el Laboratorio, cuyo juez solo veía el texto
 * de la conversación y no podía distinguir un "ya te contactan" con handoff
 * real de una promesa vacía — y castigaba al agente por hacerlo bien.
 *
 * `opts.now` es el reloj con el que se arma el prompt. Solo lo pasa el
 * Laboratorio, para correr sus guiones de compra en horario de atención en vez
 * de a la hora en que el dueño pulsó el botón (ver `horaHabilDePrueba`).
 */
export async function runAgentTurn(
  conversationId: string,
  opts?: { now?: Date }
): Promise<AgentActionType | null> {
  if (!isAiConfigured()) return null;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return null;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return null;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return null;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(HISTORY_LIMIT);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return null;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return { action: "handoff", reason: "ventana" };
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return { action: "handoff", reason: "cliente" };
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const contactRows = await db
    .select({ name: schema.contact.name, phone: schema.contact.phone })
    .from(schema.contact)
    .where(eq(schema.contact.id, conversation.contactId))
    .limit(1);

  // El estado se calcula UNA vez y sirve para dos cosas: curar el historial que
  // ve el agente y comprobar después lo que quiere responder.
  const hours: BusinessHours = {
    open: profile.hoursOpen,
    close: profile.hoursClose,
    days: profile.hoursDays,
  };
  const estado = businessStatus(hours, opts?.now);

  // El catálogo de servicios solo se carga (y solo se le ofrece al modelo) si
  // esta organización tiene el vertical de citas encendido: así el prompt de
  // La Churra y Lis no crece con acciones que jamás van a usar.
  const services: CatalogEntry[] = profile.appointmentsEnabled
    ? await catalogoParaPrompt(organizationId)
    : [];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        contact: contactRows[0],
        now: opts?.now,
        appointments: profile.appointmentsEnabled ? { catalog: services } : undefined,
      }),
    },
    ...toChatHistory(history, estado),
  ];

  const result = await chatJson(AgentAction, messages);
  // Se anota aunque el turno falle: los intentos fallidos también se pagan, y
  // son justo los que encarecen a un cliente sin que se note en ninguna parte.
  await registrarUsoIa(organizationId, result.usage, `conv:${conversationId}`);
  if (!result.ok) {
    if (result.error === "not_configured") return null;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await derivarAUnaPersona(conversation);
    return { action: "handoff", reason: "error" };
  }

  let action: AgentActionType = result.data;

  /**
   * `consult_availability` es una acción interna: el sistema calcula los
   * horarios reales y se los devuelve al modelo EN EL MISMO turno (nunca le
   * llega nada al cliente todavía), igual que el horario de atención — la
   * disponibilidad la calcula el servidor, no el modelo. Acotado a 2 vueltas
   * para que una conversación confusa termine en handoff y no en un bucle.
   */
  const MAX_CONSULTAS_DISPONIBILIDAD = 2;
  let consultas = 0;
  while (
    action.action === "consult_availability" &&
    consultas < MAX_CONSULTAS_DISPONIBILIDAD
  ) {
    consultas++;
    const infoDisponibilidad = await resolverConsultaDisponibilidad(
      organizationId,
      services,
      hours,
      action,
      opts?.now
    );
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "system", content: infoDisponibilidad });
    const siguiente = await chatJson(AgentAction, messages);
    await registrarUsoIa(
      organizationId,
      siguiente.usage,
      `conv:${conversationId}/disponibilidad`
    );
    if (!siguiente.ok) {
      if (siguiente.error === "not_configured") return null;
      console.error(
        `[agente] fallo del proveedor tras consultar disponibilidad: ${siguiente.detail}`
      );
      await derivarAUnaPersona(conversation);
      return { action: "handoff", reason: "error" };
    }
    action = siguiente.data;
  }
  if (action.action === "consult_availability") {
    // Se agotaron los intentos sin llegar a una acción final: mejor una
    // persona que una promesa de horario sin datos reales detrás.
    await derivarAUnaPersona(conversation);
    return { action: "handoff", reason: "error" };
  }

  /**
   * Última barrera antes de hablarle al cliente: con el negocio ABIERTO, ningún
   * mensaje puede anunciar que cerraron ni reagendar para mañana.
   *
   * El estado es un hecho que el servidor conoce; que se respete no puede
   * depender de que un modelo obedezca tres advertencias del prompt — ya se
   * comprobó que no basta. Se le da UNA oportunidad de rehacerlo con la
   * corrección delante; si insiste, atiende una persona. Un cliente esperando
   * treinta segundos más es recuperable; uno al que le dijeron que el negocio
   * cerró, no.
   */
  if (estado === "abierto" && textosAlCliente(action).some(anunciaCierre)) {
    console.warn("[agente] cierre falso con el negocio abierto; rehaciendo el turno");
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "system", content: CORRECCION_DE_CIERRE_FALSO },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/cierre-falso`
    );
    if (reintento.ok && !textosAlCliente(reintento.data).some(anunciaCierre)) {
      action = reintento.data;
    } else {
      console.error(
        "[agente] el cierre falso persiste tras la corrección; lo toma una persona"
      );
      await derivarAUnaPersona(conversation);
      return { action: "handoff", reason: "error" };
    }
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return action;
    }
  }

  switch (action.action) {
    case "none":
      return action;
    case "reply":
      await deliverReply(conversation, action.text);
      return action;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return action;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return action;
    }
    case "notify_order": {
      // Orden deliberado: primero el registro (fuente de verdad), después el
      // aviso por WhatsApp (puede fallar por la ventana de 24 h) y al final la
      // despedida — así un pedido nunca se pierde por un fallo de envío.
      const phone = await contactPhoneOf(conversation.contactId);
      const result = await notifyTeam({
        organizationId,
        summary: action.summary,
        customerPhone: phone,
        isTest: conversation.isTest,
      });
      await appendLeadNote(
        organizationId,
        conversation.contactId,
        `Pedido confirmado: ${action.summary}\n[aviso al equipo: ${result.detail}]`
      );
      // El embudo se cierra solo: un pedido confirmado es la única señal
      // inequívoca de venta que tiene el sistema, y sin esto el lead se quedaba
      // en "Nuevo" para siempre aunque el equipo ya estuviera despachándolo.
      // Aislado: el pedido ya está registrado y avisado, que es lo que no se
      // puede perder.
      try {
        if (await onLeadWon(organizationId, conversation.contactId)) {
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
      } catch (err) {
        console.error("[embudo] no se pudo cerrar el lead:", err);
      }
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      // Pedido cerrado = lo toma una persona (coordinar entrega y pago).
      await applyHandoff(conversationId, organizationId, "modelo");
      return action;
    }
    case "book_appointment": {
      const servicio = buscarServicio(services, action.servicio);
      if (!servicio) {
        await deliverReply(
          conversation,
          "No identifiqué ese servicio, ¿me confirmas cuál del catálogo quieres agendar?"
        );
        return action;
      }
      const resuelto = await resolverEspecialista(
        organizationId,
        servicio.id,
        action.especialista
      );
      if (!resuelto.ok) {
        await deliverReply(
          conversation,
          `Para "${servicio.name}" atienden: ${resuelto.opciones.join(", ")}. ¿Con quién prefieres?`
        );
        return action;
      }
      const fecha = normalizarFecha(action.fecha) ?? action.fecha;
      const resultado = await crearCita({
        organizationId,
        contactId: conversation.contactId,
        service: servicio,
        fecha,
        hora: action.hora,
        staffIdPreferido: resuelto.staffId,
        hours,
        now: opts?.now,
      });
      if (!resultado.ok) {
        const msg =
          resultado.reason === "fuera_de_horario"
            ? "Esa fecha no se puede agendar. ¿Qué otro día te gustaría?"
            : "Ese horario ya no está disponible. ¿Qué otra hora prefieres?";
        await deliverReply(conversation, msg);
        return action;
      }
      const confirmacion = `✅ Quedaste agendada: *${servicio.name}* el ${fecha} a las ${horaAAmPm(action.hora)} con ${resultado.staffName}.`;
      await appendLeadNote(
        organizationId,
        conversation.contactId,
        `Cita agendada: ${servicio.name} · ${fecha} ${action.hora} · ${resultado.staffName}`
      );
      const phoneBook = await contactPhoneOf(conversation.contactId);
      await notifyTeam({
        organizationId,
        summary: `📅 Nueva cita: ${servicio.name} el ${fecha} a las ${horaAAmPm(action.hora)} con ${resultado.staffName}.`,
        customerPhone: phoneBook,
        isTest: conversation.isTest,
      });
      await deliverReply(
        conversation,
        action.farewell ? `${confirmacion}\n${action.farewell}` : confirmacion
      );
      return action;
    }
    case "reschedule_appointment": {
      const activas = await citasActivasDeContacto(organizationId, conversation.contactId);
      const candidatos = activas.map((a) => ({
        id: a.id,
        name: a.serviceName,
        category: null,
        priceCents: 0,
        durationMin: 0,
      }));
      const encontrado = buscarServicio(candidatos, action.servicio);
      const cita = encontrado ? activas.find((a) => a.id === encontrado.id) : undefined;
      if (!cita) {
        await deliverReply(
          conversation,
          activas.length
            ? `No encontré una cita activa tuya para "${action.servicio}". ¿Cuál te gustaría reprogramar?`
            : "No encontré ninguna cita activa tuya. ¿Quieres que te ayude a agendar una nueva?"
        );
        return action;
      }
      const servicioRow = services.find((s) => s.id === cita.serviceId);
      if (!servicioRow) {
        await deliverReply(conversation, "Ese servicio ya no está en el catálogo; te comunico con el equipo.");
        return action;
      }
      const nuevaFecha = normalizarFecha(action.nuevaFecha) ?? action.nuevaFecha;
      const resultado = await reprogramarCita({
        organizationId,
        appointmentId: cita.id,
        service: servicioRow,
        staffId: cita.staffId,
        nuevaFecha,
        nuevaHora: action.nuevaHora,
        hours,
        now: opts?.now,
      });
      if (!resultado.ok) {
        const msg =
          resultado.reason === "fuera_de_horario"
            ? "Esa fecha no se puede agendar. ¿Qué otro día te gustaría?"
            : `Ese horario ya no está disponible con ${cita.staffName}. ¿Qué otra hora prefieres?`;
        await deliverReply(conversation, msg);
        return action;
      }
      const confirmacion = `✅ Tu cita de *${cita.serviceName}* quedó reprogramada para el ${nuevaFecha} a las ${horaAAmPm(action.nuevaHora)} con ${cita.staffName}.`;
      await appendLeadNote(
        organizationId,
        conversation.contactId,
        `Cita reprogramada: ${cita.serviceName} → ${nuevaFecha} ${action.nuevaHora}`
      );
      const phoneResched = await contactPhoneOf(conversation.contactId);
      await notifyTeam({
        organizationId,
        summary: `🔁 Cita reprogramada: ${cita.serviceName} ahora el ${nuevaFecha} a las ${horaAAmPm(action.nuevaHora)} con ${cita.staffName}.`,
        customerPhone: phoneResched,
        isTest: conversation.isTest,
      });
      await deliverReply(
        conversation,
        action.farewell ? `${confirmacion}\n${action.farewell}` : confirmacion
      );
      return action;
    }
    case "cancel_appointment": {
      const activas = await citasActivasDeContacto(organizationId, conversation.contactId);
      const candidatos = activas.map((a) => ({
        id: a.id,
        name: a.serviceName,
        category: null,
        priceCents: 0,
        durationMin: 0,
      }));
      const encontrado = buscarServicio(candidatos, action.servicio);
      const cita = encontrado ? activas.find((a) => a.id === encontrado.id) : undefined;
      if (!cita) {
        await deliverReply(
          conversation,
          `No encontré una cita activa tuya para "${action.servicio}".`
        );
        return action;
      }
      await cancelarCita(organizationId, cita.id);
      const { fecha, hora } = utcAFechaHoraBogota(cita.startsAt);
      const confirmacion = `Listo, cancelé tu cita de *${cita.serviceName}* del ${fecha} a las ${horaAAmPm(hora)}.`;
      await appendLeadNote(
        organizationId,
        conversation.contactId,
        `Cita cancelada: ${cita.serviceName} · ${fecha} ${hora}`
      );
      const phoneCancel = await contactPhoneOf(conversation.contactId);
      await notifyTeam({
        organizationId,
        summary: `❌ Cita cancelada: ${cita.serviceName} del ${fecha} a las ${horaAAmPm(hora)} (${cita.staffName}).`,
        customerPhone: phoneCancel,
        isTest: conversation.isTest,
      });
      await deliverReply(
        conversation,
        action.farewell ? `${confirmacion}\n${action.farewell}` : confirmacion
      );
      return action;
    }
  }
  return null;
}

type Conversation = typeof schema.conversation.$inferSelect;

/**
 * Lo que se le dice al cliente cuando el agente no logra resolver.
 *
 * Neutro a propósito: sirve para cualquier negocio de la instancia, sin nombrar
 * productos ni usar el apodo de marca de ninguno. No menciona ningún fallo
 * técnico — al cliente no le aporta saber que un modelo devolvió algo ilegible,
 * solo que ya viene una persona.
 */
const AVISO_DE_DERIVACION =
  "Dame un momentico 🙏 Te comunico con una persona del equipo para ayudarte mejor.";

/**
 * Cierra el turno pasando la conversación a una persona, avisando al cliente.
 *
 * Antes solo se marcaba la conversación en la bandeja y el cliente se quedaba
 * esperando en silencio, sin saber si lo habían leído. Marcar sin avisar es
 * cómodo para el sistema y pésimo para quien está del otro lado.
 *
 * El aviso se manda ANTES de marcar el handoff: al marcarlo, la conversación
 * queda en silencio y ya no saldría nada.
 */
async function derivarAUnaPersona(conversation: Conversation): Promise<void> {
  try {
    await deliverReply(conversation, AVISO_DE_DERIVACION);
  } catch (err) {
    // Que no se pueda avisar no debe impedir la derivación: lo importante es
    // que quede en la bandeja para que alguien la atienda.
    console.warn("[agente] no se pudo avisar al cliente de la derivación:", err);
  }
  await applyHandoff(conversation.id, conversation.organizationId, "error");
}

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set({ stageId, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(schema.lead.contactId, contactId));
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
