import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatJsonResult, type ChatMessage } from "@/lib/ai";
import { z } from "zod";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendImage, sendText } from "@/server/inbox/send";
import {
  fotoPorEtiqueta,
  fotosDeLaOrganizacion,
  urlPublicaDeFoto,
} from "@/server/ai/fotos";
import { serializeMessage } from "@/server/inbox/ingest";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { contactPhoneOf, notifyTeam } from "@/server/ai/notify-team";
import { onLeadWon } from "@/server/inbox/lead-activity";
import { buildAgentSystemPrompt, businessStatus, type CatalogEntry } from "@/server/ai/prompts";
import {
  buscarServicio,
  encontrarCitaActiva,
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
  estaEntreLosOfrecidos,
  limpiarOfrecidos,
  proximasFechasConCupo,
  registrarOfrecidos,
  reprogramarCita,
  resolverEspecialista,
} from "@/server/appointments/queries";
import { catalogoDePedidos as catalogoDePedidosQuery } from "@/server/catalog/queries";
import {
  borrarEstado,
  guardarEstado,
  leerEstado,
  validarPropuesta,
  type EstadoDelPedido,
  type PropuestaDelModelo,
} from "@/server/orders/estado";
import { comoTexto } from "@/server/orders/extraer";
import { renderCatalogoDePedidos } from "@/server/catalog/render";
import {
  anunciaCierre,
  anunciaCitaAgendada,
  CORRECCION_DE_CIERRE_FALSO,
  CORRECCION_DE_CITA_FANTASMA,
  CORRECCION_DE_PRODUCTO_OLVIDADO,
  CORRECCION_SIN_RESUMEN,
  CORRECCION_SIN_TOTAL,
  noDioElTotal,
  productosOlvidados,
  correccionDeResumen,
  resumenMalArmado,
  TIENE_TOTAL,
  MENSAJE_RETIRADO,
} from "@/server/ai/anuncio-de-cierre";
import { registrarUsoIa } from "@/server/usage";
import { encolarTurno } from "@/server/ai/cola";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Ráfagas de mensajes → UNA respuesta; nunca dos turnos simultáneos por
 * conversación; lo que llega durante un turno se atiende en el siguiente.
 *
 * ⚠️ Esa coalescencia **ya no vive en este proceso**: está en la tabla
 * `agent_job` (ver `server/ai/cola.ts`, 8-ago-2026). El `Map` de `globalThis`
 * con `setTimeout` que había aquí solo funcionaba con una instancia — con dos
 * réplicas el cliente recibía la respuesta dos veces, y un reinicio con un
 * temporizador pendiente perdía el turno sin dejar rastro.
 */

/**
 * Mensajes de historial que ve el agente en cada turno. Exportado porque el
 * Laboratorio depende de él: una conversación simulada que no quepa entera aquí
 * empieza a olvidar su propio principio, y el juez califica a un agente
 * amnésico creyendo que califica al de producción.
 */
export const HISTORY_LIMIT = 20;

/**
 * Punto de entrada con debounce (mensajes entrantes reales).
 *
 * `immediate` salta la espera: se usa en el PRIMER mensaje de una conversación,
 * donde no hay nada que agrupar (quien saluda con "hola" no viene escribiendo
 * en ráfaga) y la espera solo se nota — es el momento en que el cliente aún no
 * tiene nada que leer mientras el agente piensa.
 *
 * Ya no ejecuta nada: deja el turno en la cola y vuelve. Lo ejecuta el worker
 * (`server/ai/worker.ts`), que puede ser este proceso o cualquier otra réplica.
 */
export async function scheduleAgentTurn(
  conversationId: string,
  opts?: { immediate?: boolean }
): Promise<void> {
  const delayMs = opts?.immediate ? 0 : getEnv().AGENT_COALESCE_MS;
  await encolarTurno(conversationId, { delayMs });
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
/**
 * Los mensajes del cliente que el agente todavía no ha atendido.
 *
 * Con marca (`lastTurnInboundAt`), es exacto: todo lo entrante posterior.
 *
 * Sin marca —conversaciones anteriores a que existiera la columna— se cae al
 * criterio que se puede deducir del propio historial: los entrantes que hay
 * DESPUÉS de la última respuesta del agente. Es lo que se desplegó el 5-ago y
 * no falla nunca en falso; solo se queda corto justo en el caso de carrera,
 * que es lo que la marca vino a resolver.
 */
export function entrantesSinResponder<
  T extends { id: string; direction: string; createdAt: Date },
>(history: T[], marca: Date | null | undefined): T[] {
  if (marca) {
    return history.filter((m) => m.direction === "in" && m.createdAt > marca);
  }
  const ultimoSaliente = history.map((m) => m.direction).lastIndexOf("out");
  return history.slice(ultimoSaliente + 1).filter((m) => m.direction === "in");
}

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
    // El pie de foto es texto que lee el cliente, así que pasa por los
    // guardarraíles igual que cualquier respuesta.
    case "send_image":
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
 * Anota lo que el agente acaba de ofrecer, para que `book_appointment` no
 * pueda reservar otra cosa. Nunca tumba el turno: si falla, se queda sin
 * registro y la reserva se valida como antes (solo contra disponibilidad
 * real) — degradar a lo de siempre es mejor que dejar al cliente sin cita.
 */
async function anotarOfrecidos(
  organizationId: string,
  conversationId: string | undefined,
  serviceId: string,
  slots: { fecha: string; hora: string }[]
): Promise<void> {
  if (!conversationId) return;
  try {
    await registrarOfrecidos({
      organizationId,
      conversationId,
      serviceId,
      slots,
    });
  } catch (err) {
    console.warn("[citas] no se pudieron anotar los horarios ofrecidos:", err);
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
  now?: Date,
  conversationId?: string
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
    await anotarOfrecidos(
      organizationId,
      conversationId,
      servicio.id,
      horas.map((hora) => ({ fecha, hora }))
    );
    const lista = horas.map((h) => horaAAmPm(h)).join(", ");
    return (
      `[SISTEMA] Horarios REALES disponibles para "${servicio.name}" el ${fecha}: ${lista}. ` +
      `Solo estos horarios se pueden agendar. ${COMO_OFRECER}`
    );
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
  await anotarOfrecidos(
    organizationId,
    conversationId,
    servicio.id,
    proximas.flatMap((p) => p.horarios.map((hora) => ({ fecha: p.fecha, hora })))
  );
  const texto = proximas
    .map((p) => `${p.fecha}: ${p.horarios.map(horaAAmPm).join(", ")}`)
    .join(" | ");
  return (
    `[SISTEMA] Próximas fechas con cupo para "${servicio.name}": ${texto}. ` +
    `Solo estos horarios se pueden agendar. ${COMO_OFRECER}`
  );
}

/**
 * Cómo presentar los horarios, no cuáles.
 *
 * La lista completa se le sigue dando al modelo —la necesita para saber si lo
 * que pida el cliente está libre—, pero **al cliente no se le vuelcan
 * enteros**. Probando el salón (7-ago-2026) llegó a mandar **17 horarios en
 * un solo mensaje**: en WhatsApp eso es un muro de texto que nadie lee, y
 * quien pregunta por una hora concreta no quiere un listado.
 */
const COMO_OFRECER =
  "TODAS las horas de esta lista están libres y se pueden agendar. Al CLIENTE " +
  "menciónale solo 3 para no abrumarlo (las más cercanas a lo que pidió; si no " +
  "pidió hora: una de la mañana, una del mediodía y una de la tarde) y dile " +
  "que si ninguna le sirve tienes más. " +
  "OJO: mencionar 3 no significa que las demás no existan — si el cliente pide " +
  "CUALQUIER otra hora que esté en esta lista, agéndala directamente. Decirle " +
  "que no está disponible una hora que sí aparece aquí es un error grave: le " +
  "quita una cita al negocio.";

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

  let history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(HISTORY_LIMIT);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return null;

  /**
   * Qué mensajes del cliente siguen sin respuesta.
   *
   * No basta con mirar el último mensaje: cuando alguien escribe mientras el
   * agente ya está respondiendo, su mensaje queda guardado ANTES de la
   * respuesta y parece contestado sin estarlo. Por eso cada turno anota hasta
   * dónde llegó (`lastTurnInboundAt`) y aquí se compara contra esa marca.
   *
   * Los dos casos reales que lo motivan, ambos por lo mismo:
   *
   * - **Jorge (La Churra, 2-ago)**: escribió "Azur y canela" y se corrigió con
   *   "Azúcar y canela" mientras el agente respondía. El segundo mensaje
   *   disparó un turno que no tenía nada que contestar → el historial
   *   terminaba en la propia respuesta del agente → `content: null` de
   *   gemini-2.5-flash → handoff de error. Venta perdida.
   * - **Tatis (Lis, 5-ago)**: preguntó por el domicilio y 4 s después eligió
   *   "1" del menú. Le contestaron lo del domicilio; el "1" quedó por detrás
   *   de esa respuesta y **nunca recibió la carta**.
   *
   * Sin pendientes se omite el turno (y su llamada al modelo). Con
   * pendientes, se reordenan al final del historial: el modelo ve su
   * respuesta anterior y, después, lo que el cliente sigue esperando — que es
   * exactamente lo que pasó visto desde el chat.
   */
  const pendientes = entrantesSinResponder(history, conversation.lastTurnInboundAt);
  if (!pendientes.length) {
    console.info(
      `[agente] turno omitido en ${conversationId}: no hay mensajes del cliente sin responder`
    );
    return null;
  }

  /**
   * Lo que el cliente escribió sin responder y lo último que dijo el agente
   * antes de este turno. Con eso se comprueba después que no se haya dejado
   * caer un producto que ya estaba pedido (ver el guardarraíl más abajo).
   */
  const pendientesDelCliente = pendientes
    .map((m) => m.text)
    .filter((t): t is string => Boolean(t));
  const ultimaRespuestaPrevia =
    [...history].reverse().find((m) => m.direction === "out" && m.text)?.text ??
    null;

  /**
   * La marca se guarda ANTES de llamar al modelo, no después: si el turno
   * falla a mitad, estos mensajes NO deben volver a dispararlo en bucle —
   * para eso está la derivación a una persona.
   */
  const hastaAqui = pendientes[pendientes.length - 1]!.createdAt;
  await db
    .update(schema.conversation)
    .set({ lastTurnInboundAt: hastaAqui })
    .where(eq(schema.conversation.id, conversationId));

  const pendientesIds = new Set(pendientes.map((m) => m.id));
  history = [
    ...history.filter((m) => !pendientesIds.has(m.id)),
    ...pendientes,
  ];

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return { action: "handoff", reason: "ventana" };
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await derivarAUnaPersona(conversation, {
      reason: "cliente",
      teamSummary: AVISO_EQUIPO_CLIENTE_PIDIO_ASESOR,
    });
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

  /*
   * Las fotos que este negocio tiene cargadas. La mayoría no tiene ninguna, y
   * entonces no se escribe ni una línea sobre fotos en el prompt: cada token se
   * paga en CADA mensaje, y un agente sin fotos no debe leer instrucciones
   * sobre cómo mandarlas.
   */
  const fotos = await fotosDeLaOrganizacion(organizationId);

  // El estado se calcula UNA vez y sirve para dos cosas: curar el historial que
  // ve el agente y comprobar después lo que quiere responder.
  const hours: BusinessHours = {
    open: profile.hoursOpen,
    close: profile.hoursClose,
    days: profile.hoursDays,
    openSunday: profile.hoursOpenSunday,
    closeSunday: profile.hoursCloseSunday,
  };
  const estado = businessStatus(hours, opts?.now);

  // El catálogo de servicios solo se carga (y solo se le ofrece al modelo) si
  // esta organización tiene el vertical de citas encendido: así el prompt de
  // La Churra y Lis no crece con acciones que jamás van a usar.
  const services: CatalogEntry[] = profile.appointmentsEnabled
    ? await catalogoParaPrompt(organizationId)
    : [];

  /*
   * El catálogo de pedidos, cuando ese negocio ya lo tiene en tablas.
   *
   * La bandera es por organización y nace apagada, así que este `if` es todo el
   * rollback de la Fase 1: con `catalog_source = 'prompt'` no se consulta nada
   * y el turno corre exactamente como antes, con el menú dentro de
   * `instructions`.
   *
   * Y si la bandera dice 'tabla' pero el catálogo está vacío, se cae al
   * comportamiento viejo en lugar de dejar al agente vendiendo una carta en
   * blanco: una migración a medias no puede tumbar a un cliente.
   */
  let catalogoDePedidos: string | undefined;
  if (!profile.appointmentsEnabled && profile.catalogSource === "tabla") {
    const productos = await catalogoDePedidosQuery(organizationId);
    if (productos.length > 0) {
      catalogoDePedidos = renderCatalogoDePedidos(productos);
    } else {
      console.warn(
        `[catalogo] ${organizationId}: catalog_source='tabla' pero sin productos; se usa el del prompt`
      );
    }
  }

  /*
   * FASE 2 — el estado del pedido, si este cliente lo tiene encendido.
   *
   * ⚠️ **Todo lo de la Fase 2 cuelga de `state_source === 'backend'`, y hoy los
   * cuatro clientes están en `'prompt'`.** Con la bandera así, este bloque no
   * lee, no escribe y no cambia el prompt: el turno corre exactamente como
   * antes. Es el mismo interruptor que la Fase 1, que ya demostró servir.
   *
   * El "0" reinicia ANTES de llamar al modelo, igual que el handoff: es una
   * decisión determinista del servidor, no algo que se le pida al LLM.
   */
  const estadoEstructurado = !profile.appointmentsEnabled && profile.stateSource === "backend";
  let bloqueDeEstado: string | undefined;
  let estadoGuardado: EstadoDelPedido | null = null;
  let salsasQueLleva = 0;

  if (estadoEstructurado) {
    const productos = await catalogoDePedidosQuery(organizationId);
    if (productos.length === 0) {
      // Sin catálogo en tablas no hay nada contra lo que validar: se cae al
      // comportamiento de siempre en vez de inventarse un pedido.
      console.warn(
        `[estado] ${organizationId}: state_source='backend' pero sin catálogo; se usa el del prompt`
      );
    } else {
      if (lastInbound.text && matchesReinicio(lastInbound.text)) {
        await borrarEstado(conversation.id, { actor: "pipeline", proceso: "reinicio" });
      }
      estadoGuardado = await leerEstado(conversation.id);
      const delPedido = productos.find((p) => p.id === estadoGuardado?.producto.id);
      salsasQueLleva = delPedido?.grupos.find((g) => g.opciones.length > 0)?.maximo ?? 0;
      if (estadoGuardado) bloqueDeEstado = comoTexto(estadoGuardado, salsasQueLleva);
    }
  }

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
        catalogoDePedidos,
        estadoDelPedido: bloqueDeEstado,
        fotos,
      }),
    },
    ...toChatHistory(history, estado),
  ];

  /*
   * Con el estado encendido, la propuesta viaja en la MISMA llamada que la
   * respuesta. Lo decidió la medición: más barata ($0,002320 contra $0,002508
   * por turno), más rápida (2.172 ms contra 3.690) y **acierta donde la llamada
   * aparte falla**, porque conoce las reglas del negocio — sabe que el "0"
   * reinicia.
   *
   * El esquema es `passthrough` con `estado` OPCIONAL: cuando el agente deriva
   * a una persona o calla, no hay pedido que extraer, y exigirlo rechazaba 4 de
   * cada 36 respuestas justo en las conversaciones más delicadas.
   */
  const conEstado = estadoEstructurado ? await chatJsonConEstado(messages) : null;
  const result = conEstado ? conEstado.resultado : await chatJson(AgentAction, messages);
  const propuestaDelTurno = conEstado?.propuesta;

  /*
   * El modelo PROPONE; el backend valida y persiste.
   *
   * Se hace después de la respuesta y **fuera de su camino**: si la propuesta no
   * vale, se registra y se descarta, pero el cliente ya tiene su contestación.
   * Un estado que no valida no puede convertirse en un turno perdido.
   */
  if (estadoEstructurado && result.ok) {
    await guardarEstadoPropuesto({
      organizationId,
      conversationId: conversation.id,
      propuesta: propuestaDelTurno,
    });
  }
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
      opts?.now,
      conversation.id
    );
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    /**
     * "user", no "system": verificado en vivo (1-ago-2026) que
     * google/gemini-2.5-flash vía OpenRouter devuelve `content: null` cuando el
     * ÚLTIMO mensaje del array es de rol "system" sin ningún turno de usuario
     * después — pasa el `finish_reason: "stop"`, pero el contenido viene vacío.
     * Mismo truco que ya usa `toChatHistory` para los mensajes de una persona
     * del equipo: rol "user" con la etiqueta "[SISTEMA]" delante, para que el
     * modelo lo lea como información, no como algo que dijo el cliente.
     */
    messages.push({ role: "user", content: infoDisponibilidad });
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
      // "user", no "system": verificado en vivo (1-ago-2026) que
      // google/gemini-2.5-flash vía OpenRouter devuelve `content: null` cuando
      // el ÚLTIMO mensaje del array es de rol "system" sin ningún turno de
      // usuario después. Mismo arreglo que en el loop de consult_availability.
      { role: "user", content: CORRECCION_DE_CIERRE_FALSO },
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

  /**
   * Confirmar una cita que NO se agendó: el cliente se presenta un día que
   * nadie lo espera.
   *
   * Solo las acciones de cita escriben en la agenda. Si el texto anuncia que
   * "quedaste agendada" y la acción es otra —`reply`, típicamente—, la cita no
   * existe. Caso real probando el salón (7-ago-2026): a un "si confirmo"
   * suelto se inventó servicio, día, hora y especialista.
   *
   * Mismo tratamiento que el cierre falso: una oportunidad de rehacerlo con
   * la corrección delante y, si insiste, lo atiende una persona.
   */
  const ACCIONES_QUE_AGENDAN = ["book_appointment", "reschedule_appointment"];
  if (
    profile.appointmentsEnabled &&
    !ACCIONES_QUE_AGENDAN.includes(action.action) &&
    textosAlCliente(action).some(anunciaCitaAgendada)
  ) {
    console.warn("[agente] confirmó una cita sin agendarla; rehaciendo el turno");
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_CITA_FANTASMA },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/cita-fantasma`
    );
    if (
      reintento.ok &&
      (ACCIONES_QUE_AGENDAN.includes(reintento.data.action) ||
        !textosAlCliente(reintento.data).some(anunciaCitaAgendada))
    ) {
      action = reintento.data;
    } else {
      console.error(
        "[agente] sigue confirmando una cita inexistente; lo toma una persona"
      );
      await derivarAUnaPersona(conversation);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Un producto ya pedido que desaparece del pedido (9-ago-2026).
   *
   * Tercer guardarraíl que acaba aquí por el mismo motivo que los dos de
   * arriba: se intentó por prompt y, contra el pipeline real, solo funcionaba
   * cuando el cliente decía "y TAMBIÉN uno de 16" — no cuando decía "quiero un
   * cremoso de 16", que es como ocurrió de verdad.
   *
   * A diferencia del cierre falso y la cita fantasma, aquí NO se deriva a una
   * persona si insiste: equivocarse de tamaño es recuperable en el resumen, y
   * con un negocio de volumen sacar a un humano en cada duda es peor remedio
   * que la enfermedad. Se registra y se sigue.
   */
  const olvidados = productosOlvidados({
    ultimaRespuestaDelAgente: ultimaRespuestaPrevia,
    mensajesDelCliente: pendientesDelCliente,
    respuestaNueva: textosAlCliente(action).join(" "),
  });
  if (olvidados.length > 0) {
    console.warn(
      `[agente] se dejó caer ${olvidados.join(", ")} del pedido; rehaciendo el turno`
    );
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_PRODUCTO_OLVIDADO },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/producto-olvidado`
    );
    if (
      reintento.ok &&
      productosOlvidados({
        ultimaRespuestaDelAgente: ultimaRespuestaPrevia,
        mensajesDelCliente: pendientesDelCliente,
        respuestaNueva: textosAlCliente(reintento.data).join(" "),
      }).length === 0
    ) {
      action = reintento.data;
    } else {
      console.error(
        `[agente] el pedido sigue sin ${olvidados.join(", ")} tras la corrección; sale como está`
      );
    }
  }

  /*
   * Cuarto guardarraíl: el resumen mal armado (12-ago-2026).
   *
   * Dos fallos del mismo momento, medidos en Lis Pastelería sobre 24 resúmenes
   * reales: 19 pedían confirmar Y se despedían en el mismo mensaje (79 %), y 3
   * anunciaban un resumen que no existía (12 %).
   *
   * El caro es el primero: el agente da la conversación por cerrada antes de
   * que el cliente confirme, así que cuando este dice "confirmo" NO manda los
   * datos de pago. La dueña los escribe a mano desde el celular, eso activa el
   * relevo humano, y el relevo silencia al agente 2 horas. El bot falla el
   * cierre → la dueña interviene → su intervención apaga al bot.
   *
   * La causa raíz era del prompt (las dos plantillas pegadas en una sección) y
   * se corrigió allí primero. Esto es la red: si el prompt cumple, no salta.
   *
   * Como `productosOlvidados`, NO deriva a una persona si insiste.
   */
  /*
   * ⚠️ `notify_order` queda FUERA de este guardarraíl, y no es una excepción
   * cómoda: es la corrección de un fallo medido.
   *
   * 13-ago-2026, Natalia: escribió "Confirmo", el agente le devolvió el mismo
   * resumen pidiéndole confirmar. Escribió "Correcto" y volvió a recibirlo.
   * Escribió "Si" y otra vez. Tres veces, hasta que una persona entró a mano.
   *
   * Lo que pasaba: `textosAlCliente` junta el `summary` y el `farewell` de la
   * acción en un solo texto, y ahí el detector veía la petición de confirmar
   * (que el modelo copia dentro del summary) JUNTO a la despedida y los datos
   * de pago (que van en el farewell). Por separado cada parte está limpia;
   * pegadas parecen el fallo del 12-ago. Entonces rehacía el turno con "no te
   * despidas todavía, reescribe el resumen y pide confirmación" — y el modelo
   * obedecía, pidiéndole a la clienta que confirmara lo que acababa de
   * confirmar.
   *
   * `notify_order` solo ocurre DESPUÉS de que el cliente dijo que sí: ahí
   * despedirse y dar los datos de pago no es prematuro, es exactamente lo que
   * hay que hacer. Y el `summary` ni siquiera lo lee el cliente — va al equipo.
   */
  /*
   * Quinto guardarraíl: cerrar un pedido que el cliente nunca vio (14-ago-2026).
   *
   * Medido en el Laboratorio de Lis: el cliente simulado dijo "Sí, así está
   * perfecto. Confirmo el pedido" cuando lo único que había pasado era que el
   * agente le mandó el enlace del menú. El agente ejecutó `notify_order` — y el
   * equipo recibió un pedido SIN producto, sin toppings, sin nombre y sin
   * dirección, con los datos de pago ya enviados al cliente.
   *
   * El prompt lo prohíbe ("el resumen es OBLIGATORIO"), pero una confirmación
   * entusiasta del cliente basta para que el modelo se salte el paso: cree que
   * confirma algo. Por eso se comprueba el HECHO — que exista un resumen con su
   * total entre lo que el agente ya le enseñó — en vez de confiar en la orden.
   *
   * No deriva a una persona: se rehace el turno para que muestre el resumen, que
   * es lo que el cliente estaba esperando de todos modos.
   */
  if (action.action === "notify_order") {
    const yaHuboResumen = history.some(
      (m) => m.direction === "out" && m.text && TIENE_TOTAL.test(m.text)
    );
    if (!yaHuboResumen) {
      console.warn(
        `[agente] notify_order sin resumen previo en ${conversationId}; rehaciendo el turno`
      );
      const reintento = await chatJson(AgentAction, [
        ...messages,
        { role: "assistant", content: result.raw },
        { role: "user", content: CORRECCION_SIN_RESUMEN },
      ]);
      await registrarUsoIa(
        organizationId,
        reintento.usage,
        `conv:${conversationId}/cierre-sin-resumen`
      );
      if (reintento.ok && reintento.data.action !== "notify_order") {
        action = reintento.data;
      } else {
        // Si insiste, se manda a una persona: un pedido cerrado en falso llega
        // a la cocina como algo que nadie puede preparar, y el cliente ya tiene
        // los datos de pago en la mano.
        console.error(
          `[agente] insiste en cerrar sin resumen en ${conversationId}; lo toma una persona`
        );
        await derivarAUnaPersona(conversation, {
          reason: "modelo",
          teamSummary:
            "El asistente intentó cerrar un pedido sin haberle mostrado el resumen al cliente, así que NO se registró nada. Revisa la conversación: puede que el cliente crea que ya pidió.",
        });
        return { action: "handoff", reason: "cierre sin resumen" };
      }
    }
  }

  /*
   * Solo en PEDIDOS. Este detector nació midiendo resúmenes de pedidos y busca
   * un total en pesos; en un salón, un "aquí está el resumen de tu cita" sin
   * cifra lo daría por vacío y rehacía el turno sin motivo. Y es que en citas
   * el resumen ni siquiera es obligatorio: `CIERRE_CITAS` dice lo contrario —
   * *"no hace falta un resumen largo ni una confirmación ceremoniosa"*.
   *
   * La regla general, que vale para los cinco guardarraíles: uno escrito para
   * un vertical no se aplica al otro solo porque el texto se le parezca.
   */
  /*
   * Sexto guardarraíl: le preguntan el total y no lo da (14-ago-2026).
   *
   * Dos escenarios de Lis, el mismo día: "¿cuánto es el total?" y el agente
   * contestó "solo necesito que me confirmes el topping". El topping no cambia
   * el precio. Su prompt ya lo prohibía y lo hizo igual — por eso está aquí y
   * no solo allí: los guardarraíles llegan a TODOS los clientes, también a los
   * que aún no se han migrado al generador.
   *
   * Solo en pedidos: en un salón el precio de un servicio es fijo y sale del
   * catálogo, no de una suma.
   */
  if (!profile.appointmentsEnabled) {
    if (
      noDioElTotal({
        mensajesDelCliente: pendientesDelCliente,
        respuesta: textosAlCliente(action).join(" "),
      })
    ) {
      console.warn(`[agente] le pidieron el total y no lo dio en ${conversationId}`);
      const reintento = await chatJson(AgentAction, [
        ...messages,
        { role: "assistant", content: result.raw },
        { role: "user", content: CORRECCION_SIN_TOTAL },
      ]);
      await registrarUsoIa(
        organizationId,
        reintento.usage,
        `conv:${conversationId}/sin-total`
      );
      // Si el reintento tampoco lo da, sale como está: quedarse dando vueltas
      // es peor que una respuesta incompleta.
      if (
        reintento.ok &&
        !noDioElTotal({
          mensajesDelCliente: pendientesDelCliente,
          respuesta: textosAlCliente(reintento.data).join(" "),
        })
      ) {
        action = reintento.data;
      }
    }
  }

  const falloDeResumen =
    action.action === "notify_order" || profile.appointmentsEnabled
      ? null
      : resumenMalArmado(textosAlCliente(action).join(" "));
  if (falloDeResumen) {
    console.warn(`[agente] resumen mal armado (${falloDeResumen}); rehaciendo el turno`);
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: correccionDeResumen(falloDeResumen) },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/resumen-${falloDeResumen}`
    );
    if (
      reintento.ok &&
      resumenMalArmado(textosAlCliente(reintento.data).join(" ")) === null
    ) {
      action = reintento.data;
    } else {
      console.error(
        `[agente] el resumen sigue mal (${falloDeResumen}) tras la corrección; sale como está`
      );
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
    /*
     * Mandar la foto que pidió el cliente.
     *
     * Se degrada a texto en TRES casos, y ninguno deja al cliente sin
     * respuesta: si la foto no existe, si no se puede construir una URL
     * pública (falta `PUBLIC_MEDIA_BASE_URL`), o si el envío falla. Una foto
     * es un extra; quedarse mudo, no.
     */
    case "send_image": {
      // El modelo escribe `label` tanto como `etiqueta` (ver la nota del
      // esquema): se acepta cualquiera de los dos y, si no viene ninguno, se
      // trata como una foto que no existe — es decir, se responde con texto.
      const pedida = action.etiqueta ?? action.label ?? "";
      const foto = pedida ? await fotoPorEtiqueta(organizationId, pedida) : null;
      const url = foto ? urlPublicaDeFoto(foto.id) : null;

      if (!foto || !url) {
        console.warn(
          `[agente] no se pudo mandar la foto "${pedida}" (${!foto ? "no existe" : "sin URL pública"}); se responde con texto`
        );
        if (action.reply) await deliverReply(conversation, action.reply);
        return action;
      }

      await deliverImage(conversation, url, action.reply);
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
      const phone = await contactPhoneOf(organizationId, conversation.contactId);
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

      /**
       * Solo se agenda un horario que el agente haya ofrecido en esta
       * conversación. `crearCita` ya comprueba que el hueco esté libre, pero
       * eso no impide agendar uno que nunca se ofreció: el caso real es una
       * fecha relativa mal entendida ("el miércoles", "mañana en la tarde")
       * que cae por casualidad en un hueco libre. Antes se reservaba mal y el
       * cliente se enteraba al llegar. Ahora se le devuelven las opciones que
       * de verdad se le ofrecieron. Idea tomada de `nea-agent`.
       */
      const ofrecido = await estaEntreLosOfrecidos({
        organizationId,
        conversationId: conversation.id,
        fecha,
        hora: action.hora,
      });
      if (!ofrecido.ok) {
        const opciones = ofrecido.ofrecidos
          .map((o) => `${o.fecha} a las ${horaAAmPm(o.hora)}`)
          .join(", ");
        console.warn(
          `[citas] reserva rechazada en ${conversation.id}: ${fecha} ${action.hora} ` +
            `no está entre los ofrecidos (${opciones})`
        );
        await deliverReply(
          conversation,
          `Para no equivocarme con tu cita: los horarios que tengo disponibles son ${opciones}. ¿Cuál prefieres?`
        );
        return action;
      }

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
        /**
         * El hueco puede estar ocupado por la PROPIA clienta: pasa cada vez
         * que dice "sí, confirmo" después de que la cita ya quedó hecha. El
         * mensaje genérico ("ese horario ya no está disponible") la deja
         * pensando que se cayó su cita, cuando es suya. Salió tres veces
         * seguidas probando el salón antes de su primer día (7-ago-2026).
         */
        const suya =
          resultado.reason === "sin_cupo" &&
          (await citasActivasDeContacto(organizationId, conversation.contactId)).some(
            (c) =>
              c.serviceId === servicio.id &&
              utcAFechaHoraBogota(c.startsAt).fecha === fecha &&
              utcAFechaHoraBogota(c.startsAt).hora === action.hora
          );
        const msg = suya
          ? `Tranquila, esa cita ya está confirmada: *${servicio.name}* el ${fecha} a las ${horaAAmPm(action.hora)}. ¡Te esperamos!`
          : resultado.reason === "fuera_de_horario"
            ? "Esa fecha no se puede agendar. ¿Qué otro día te gustaría?"
            : "Ese horario ya no está disponible. ¿Qué otra hora prefieres?";
        await deliverReply(conversation, msg);
        return action;
      }
      // La cita ya existe: lo ofrecido dejó de tener sentido.
      await limpiarOfrecidos(organizationId, conversation.id).catch(() => {});
      await avisarYConfirmar({
        conversation,
        organizationId,
        confirmacion: `✅ Quedaste agendada: *${servicio.name}* el ${fecha} a las ${horaAAmPm(action.hora)} con ${resultado.staffName}.`,
        nota: `Cita agendada: ${servicio.name} · ${fecha} ${action.hora} · ${resultado.staffName}`,
        avisoEquipo: `📅 Nueva cita: ${servicio.name} el ${fecha} a las ${horaAAmPm(action.hora)} con ${resultado.staffName}.`,
        farewell: action.farewell,
      });
      return action;
    }
    case "reschedule_appointment": {
      const activas = await citasActivasDeContacto(organizationId, conversation.contactId);
      const cita = encontrarCitaActiva(activas, action.servicio);
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
      await avisarYConfirmar({
        conversation,
        organizationId,
        confirmacion: `✅ Tu cita de *${cita.serviceName}* quedó reprogramada para el ${nuevaFecha} a las ${horaAAmPm(action.nuevaHora)} con ${cita.staffName}.`,
        nota: `Cita reprogramada: ${cita.serviceName} → ${nuevaFecha} ${action.nuevaHora}`,
        avisoEquipo: `🔁 Cita reprogramada: ${cita.serviceName} ahora el ${nuevaFecha} a las ${horaAAmPm(action.nuevaHora)} con ${cita.staffName}.`,
        farewell: action.farewell,
      });
      return action;
    }
    case "cancel_appointment": {
      const activas = await citasActivasDeContacto(organizationId, conversation.contactId);
      const cita = encontrarCitaActiva(activas, action.servicio);
      if (!cita) {
        await deliverReply(
          conversation,
          `No encontré una cita activa tuya para "${action.servicio}".`
        );
        return action;
      }
      await cancelarCita(organizationId, cita.id);
      const { fecha, hora } = utcAFechaHoraBogota(cita.startsAt);
      await avisarYConfirmar({
        conversation,
        organizationId,
        confirmacion: `Listo, cancelé tu cita de *${cita.serviceName}* del ${fecha} a las ${horaAAmPm(hora)}.`,
        nota: `Cita cancelada: ${cita.serviceName} · ${fecha} ${hora}`,
        avisoEquipo: `❌ Cita cancelada: ${cita.serviceName} del ${fecha} a las ${horaAAmPm(hora)} (${cita.staffName}).`,
        farewell: action.farewell,
      });
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

const AVISO_EQUIPO_ERROR =
  "⚠️ El agente no pudo resolver esta conversación y quedó en manos " +
  "del equipo. Revisa la bandeja cuanto antes: el cliente está esperando.";

const AVISO_EQUIPO_CLIENTE_PIDIO_ASESOR =
  "🙋 Un cliente pidió hablar con una persona del equipo. Revisa la " +
  "bandeja cuanto antes: quedó esperando la confirmación.";

/**
 * Cierra el turno pasando la conversación a una persona, avisando al cliente
 * Y al equipo. `reason` distingue en la bandeja/BD por qué fue ("error":
 * fallo del proveedor o alucinación evitada; "cliente": lo pidió él mismo).
 *
 * Antes solo se marcaba la conversación en la bandeja y el cliente se quedaba
 * esperando en silencio, sin saber si lo habían leído. Marcar sin avisar es
 * cómodo para el sistema y pésimo para quien está del otro lado — incluido el
 * caso en que el cliente PIDIÓ explícitamente un asesor (patrón de respaldo
 * FR-022, que hasta el 3-ago-2026 marcaba el handoff sin decir nada: verificado
 * en vivo en Lis Pastelería, "me puedes pasar con un asesor?" se quedó sin
 * ninguna respuesta).
 *
 * El aviso se manda ANTES de marcar el handoff: al marcarlo, la conversación
 * queda en silencio y ya no saldría nada.
 */
async function derivarAUnaPersona(
  conversation: Conversation,
  opts?: {
    reason?: "cliente" | "modelo" | "error" | "ventana";
    teamSummary?: string;
  }
): Promise<void> {
  const reason = opts?.reason ?? "error";
  const teamSummary = opts?.teamSummary ?? AVISO_EQUIPO_ERROR;

  try {
    await deliverReply(conversation, AVISO_DE_DERIVACION, { esAviso: true });
  } catch (err) {
    // Que no se pueda avisar no debe impedir la derivación: lo importante es
    // que quede en la bandeja para que alguien la atienda.
    console.warn("[agente] no se pudo avisar al cliente de la derivación:", err);
  }
  await applyHandoff(conversation.id, conversation.organizationId, reason);

  /**
   * Al cliente se le promete "te comunico con una persona" (arriba), pero sin
   * avisar al EQUIPO esa promesa quedaba vacía: nadie se enteraba hasta que el
   * cliente escribía enojado por no recibir respuesta (caso real, Lis
   * Pastelería, 1-ago-2026). Mismo mecanismo que el aviso de pedidos.
   */
  try {
    const phone = await contactPhoneOf(conversation.organizationId, conversation.contactId);
    await notifyTeam({
      organizationId: conversation.organizationId,
      summary: teamSummary,
      customerPhone: phone,
      isTest: conversation.isTest,
    });
  } catch (err) {
    console.error("[agente] no se pudo avisar al equipo de la derivación:", err);
  }
}

/**
 * Entrega la respuesta: envío real o persistencia sandbox (is_test).
 *
 * Si el envío falla de verdad (ya reintentado lo pasajero dentro del cliente
 * de YCloud), la respuesta **no se tira**: se guarda con `status: "failed"` y
 * la conversación pasa a una persona. Hasta el 5-ago-2026 el error subía
 * hasta `executeTurn`, que solo lo escribía en el registro — el texto que el
 * agente ya había generado (y pagado) desaparecía sin dejar fila, sin relevo
 * y sin aviso al equipo: el cliente esperando y nadie enterado. Es el mismo
 * agujero que `nea-agent` tapó con su `pending_send` (ver
 * docs/korexia/26-NEA-AGENT.md).
 *
 * `esAviso` corta la recursión: el aviso de derivación entra por aquí también,
 * y no puede volver a derivar si es él quien falla.
 */
async function deliverReply(
  conversation: Conversation,
  text: string,
  opts?: { esAviso?: boolean }
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
    await persistirSalienteFallido(conversation, text, err);
    if (opts?.esAviso) throw err;
    await derivarAUnaPersona(conversation, {
      reason: "error",
      teamSummary: AVISO_EQUIPO_ENVIO_FALLIDO,
    });
  }
}

/**
 * Manda una foto con su pie. Si falla, cae a texto y sigue.
 *
 * A diferencia de `deliverReply`, un fallo aquí **no deriva a una persona**: la
 * foto es un complemento, y sacar a un humano porque una imagen no salió sería
 * peor remedio que la enfermedad. Se registra y el cliente recibe el texto.
 */
async function deliverImage(
  conversation: Conversation,
  url: string,
  pie?: string
): Promise<void> {
  // En una conversación de prueba no se toca WhatsApp: queda el rastro escrito.
  if (conversation.isTest) {
    await persistTestOutbound(conversation, `[foto: ${url}]${pie ? `\n${pie}` : ""}`);
    return;
  }
  try {
    await sendImage({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      link: url,
      caption: pie,
      aiGenerated: true,
    });
  } catch (err) {
    console.warn("[agente] falló el envío de la foto; se responde con texto:", err);
    if (pie) await deliverReply(conversation, pie);
  }
}

const AVISO_EQUIPO_ENVIO_FALLIDO =
  "⚠️ No se le pudo entregar la respuesta a un cliente por WhatsApp. El texto " +
  "quedó guardado en la conversación, marcado como no enviado: revísalo y " +
  "respóndele desde la bandeja.";

/**
 * Deja constancia de la respuesta que no se pudo entregar. Sin `waMessageId`
 * (nunca llegó a WhatsApp) y con el motivo en `error`, para que quien abra la
 * conversación vea el texto y el porqué en vez de un hueco. La bandeja ya
 * pinta `failed` con el triángulo rojo.
 */
async function persistirSalienteFallido(
  conversation: Conversation,
  text: string,
  err: unknown
): Promise<void> {
  try {
    const db = getDb();
    const inserted = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        direction: "out",
        type: "text",
        text,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        aiGenerated: true,
      })
      .returning();
    const message = inserted[0];
    if (message) {
      publish(conversation.organizationId, {
        type: "message.new",
        data: {
          conversationId: conversation.id,
          message: serializeMessage(message),
        },
      });
    }
  } catch (guardar) {
    // Último recinto: si ni siquiera se puede guardar, al menos que quede en
    // el registro con el texto completo, para poder reenviarlo a mano.
    console.error(
      `[agente] respuesta PERDIDA en ${conversation.id} (no se pudo guardar): ${text}`,
      guardar
    );
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
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
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
    .where(
      scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId))
    );
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
    .where(
      scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId))
    )
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
    .where(
      scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contact.id))
    );
}

/**
 * Patrón compartido por agendar/reprogramar/cancelar una cita: anotar el
 * lead, avisar al equipo por WhatsApp con el enlace del cliente, y confirmar
 * al cliente (con la despedida del modelo si trajo una). Estaba copiado tres
 * veces con solo los textos cambiando.
 */
async function avisarYConfirmar(params: {
  conversation: Conversation;
  organizationId: string;
  confirmacion: string;
  nota: string;
  avisoEquipo: string;
  farewell?: string;
}): Promise<void> {
  await appendLeadNote(params.organizationId, params.conversation.contactId, params.nota);
  const phone = await contactPhoneOf(params.organizationId, params.conversation.contactId);
  await notifyTeam({
    organizationId: params.organizationId,
    summary: params.avisoEquipo,
    customerPhone: phone,
    isTest: params.conversation.isTest,
  });
  await deliverReply(
    params.conversation,
    params.farewell ? `${params.confirmacion}\n${params.farewell}` : params.confirmacion
  );
}


/**
 * ¿El cliente pidió empezar de cero?
 *
 * Determinista y ANTES del modelo, igual que el handoff: si dependiera del LLM,
 * un turno confuso podría arrastrar un pedido que el cliente ya canceló. La
 * palabra la decide cada negocio; `"0"` es la convención de La Churra y está en
 * su prompt, no en este código.
 */
function matchesReinicio(texto: string, palabras: string[] = ["0"]): boolean {
  const t = texto.trim().toLowerCase();
  return palabras.some((p) => t === p.toLowerCase());
}

/**
 * Valida la propuesta del modelo y la guarda si es válida.
 *
 * **Nunca lanza**: esto corre después de que el cliente ya tenga su respuesta.
 * Un fallo aquí no puede convertirse en un turno perdido — se registra y el
 * estado se queda como estaba, que es recuperable.
 */
async function guardarEstadoPropuesto(entrada: {
  organizationId: string;
  conversationId: string;
  propuesta: PropuestaDelModelo | undefined;
}): Promise<void> {
  // Sin `estado` en la respuesta no hay nada que guardar: pasa cuando el agente
  // deriva a una persona o no responde, y es legítimo.
  if (!entrada.propuesta) return;

  try {
    const productos = await catalogoDePedidosQuery(entrada.organizationId);
    const v = validarPropuesta(entrada.propuesta, productos);
    if (!v.ok) {
      console.warn(
        `[estado] ${entrada.conversationId}: propuesta RECHAZADA — ${v.rechazos.join(" · ")}`
      );
      return;
    }
    await guardarEstado({
      conversationId: entrada.conversationId,
      organizationId: entrada.organizationId,
      estado: v.estado,
      actor: "pipeline",
      proceso: "runAgentTurn",
    });
  } catch (err) {
    console.warn(`[estado] no se pudo guardar: ${(err as Error).message}`);
  }
}


/**
 * La llamada del agente pidiéndole ADEMÁS el estado del pedido.
 *
 * Devuelve la acción con su tipo de siempre —el resto del pipeline no se entera
 * de nada— y la propuesta aparte. Si el modelo manda una acción que no encaja
 * en `AgentAction`, se trata como salida inválida igual que antes: la Fase 2 no
 * puede relajar el contrato que ya funciona.
 */
async function chatJsonConEstado(
  messages: ChatMessage[]
): Promise<{ resultado: ChatJsonResult<AgentActionType>; propuesta?: PropuestaDelModelo }> {
  const EsquemaConEstado = z
    .object({ estado: z.record(z.string(), z.unknown()).optional() })
    .passthrough();

  const bruto = await chatJson(EsquemaConEstado, [
    ...messages.slice(0, 1),
    {
      role: "system",
      content:
        'Además de la acción, añade al MISMO objeto JSON una clave "estado" con el pedido tal como va: ' +
        '{"producto": …, "cantidad": …, "salsas": [], "recubierto": …, "adiciones": [], ' +
        '"nombre": …, "telefono": …, "direccion": …, "paso": …, "confirmado": false}. ' +
        "Lo que el cliente aún no haya dicho va en null (o lista vacía). No inventes nada.",
    },
    ...messages.slice(1),
  ]);

  if (!bruto.ok) return { resultado: bruto as ChatJsonResult<AgentActionType> };

  const { estado, ...accion } = bruto.data as { estado?: unknown };
  const validada = AgentAction.safeParse(accion);
  if (!validada.success) {
    return {
      resultado: {
        ok: false,
        error: "invalid_output",
        detail: `la acción no cumple el contrato: ${validada.error.issues[0]?.message ?? "?"}`,
        usage: bruto.usage,
      },
    };
  }
  return {
    resultado: { ok: true, data: validada.data, raw: bruto.raw, usage: bruto.usage },
    propuesta: estado as PropuestaDelModelo | undefined,
  };
}
