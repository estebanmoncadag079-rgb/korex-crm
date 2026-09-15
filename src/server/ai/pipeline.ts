import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatJsonResult, type ChatMessage } from "@/lib/ai";
import { z } from "zod";
import { publish } from "@/server/events/bus";
import { isWindowOpen, WINDOW_MS } from "@/server/inbox/window";
import {
  SendError,
  sendDocument,
  sendImage,
  sendInteractiveMenu,
  sendText,
} from "@/server/inbox/send";
import {
  comoSeEntrega,
  fotoPorEtiqueta,
  fotosDeLaOrganizacion,
  urlPublicaDeFoto,
} from "@/server/ai/fotos";
import { serializeMessage } from "@/server/inbox/ingest";
import {
  AgentAction,
  degradeAction,
  formatoDeRespuestaConEstado,
  formatoDeRespuestaDeAccion,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { contactPhoneOf, notifyTeam } from "@/server/ai/notify-team";
import {
  registrarConfirmacionDeCita,
  borrarConfirmacionDeCita,
  guardarContenidoDeCita,
  intentarNotificarCita,
} from "@/server/ai/confirmacion-de-cita";
import { buildAgentSystemPrompt, businessStatus, type CatalogEntry } from "@/server/ai/prompts";
import {
  buscarServicio,
  encontrarCitaActiva,
  esFechaValida,
  horaAAmPm,
  normalizarFecha,
  utcAFechaHoraBogota,
  type BusinessHours,
  type ServiceRow,
} from "@/server/appointments/logic";
import {
  cancelarCita,
  catalogoParaPrompt,
  citasActivasDeContacto,
  crearCitaMultiple,
  disponibilidadRealMultiple,
  estaEntreLosOfrecidos,
  limpiarOfrecidos,
  listStaff,
  proximasFechasConCupoMultiple,
  registrarOfrecidos,
  reprogramarCita,
  resolverEspecialistaMultiple,
  serviciosOfrecidosPara,
} from "@/server/appointments/queries";
import {
  catalogoDe,
  catalogoDePedidos as catalogoDePedidosQuery,
  type ProductoDelCatalogo,
} from "@/server/catalog/queries";
import { armarMenuDeIntenciones, armarMenuDelCatalogo, textoPlanoDeMenu } from "@/server/catalog/menu";
import type { MenuInteractivo } from "@/server/catalog/menu";
import { buscarProductos, buscarOpciones } from "@/server/catalog/buscar";
import {
  detectarConsultaFactualDeProducto,
  detectarConsultaDeListadoDeProducto,
} from "@/server/catalog/deteccion";
import { detectarConsultaFactualDeMedioPago } from "@/server/pagos/deteccion";
import {
  agregarGuardarrail,
  agregarHecho,
  crearTraza,
  registrarHandoff,
  registrarRecuperacion,
  registrarSaltoDeHistorial,
  registrarTrazaDelTurno,
  type TrazaDelTurno,
  registrarModelo,
} from "@/server/ai/traza";
import { resolverMetodoDePago } from "@/server/pagos/metodo";
import {
  resolverZonaDeEntrega,
  zonasDeEntregaQuery,
  textoDeResultadoDomicilio,
  textoDeResultadoRecogida,
  type ZonaDeEntrega,
} from "@/server/delivery/zonas";
import { contrataCitas, verticalDe, type Vertical } from "@/server/vertical";
import {
  borrarEstado,
  estadoVacio,
  guardarEntregaVerificada,
  guardarEstado,
  leerEntregaVerificada,
  leerEstadoConVersion,
  registrarMetricaDeEstado,
  validarPropuesta,
  type EntregaVerificada,
  type EstadoDelPedido,
  type PropuestaDelModelo,
  conEntregaConservada,
} from "@/server/orders/estado";
import { MAX_ITEMS } from "@/server/orders/normalizar";
import {
  puedeConfirmarPedido,
  ejecutarConfirmacionDePedido,
} from "@/server/orders/policy";
import { resumirTexto } from "@/server/registro-de-cambios";
import { leerFicha } from "@/server/ai/generador/leer-ficha";
import {
  pagoAntesDeLaCitaDe,
  modalidadesDeEntrega,
  requisitosDe,
  type FichaDelNegocio,
  type Requisito,
} from "@/server/ai/generador/ficha";
import { capturar, faltantes as requisitosFaltantes } from "@/server/contacts";
import { comoTexto, requisitosPendientesDe } from "@/server/orders/extraer";
import { renderCatalogoDePedidos } from "@/server/catalog/render";
import {
  afirmaConEspecialistaSinVerificar,
  anunciaCierre,
  anunciaCitaAgendada,
  CORRECCION_DE_CIERRE_FALSO,
  CORRECCION_DE_CITA_FANTASMA,
  CORRECCION_DE_CONFIRMACION_NO_CERRADA,
  confirmoPeroNoSeCerro,
  CORRECCION_DE_DISPONIBILIDAD_SIN_VERIFICAR,
  CORRECCION_DE_PAGO_SIN_VERIFICAR,
  CORRECCION_DE_PRODUCTO_OLVIDADO,
  CORRECCION_DE_RECURSO_PROMETIDO,
  CORRECCION_DE_HUMANO_PROMETIDO,
  prometeHumanoSinDerivar,
  CORRECCION_DE_TURNO_MUDO,
  CORRECCION_SIN_RESUMEN,
  CORRECCION_SIN_TOTAL,
  confirmaPagoSinVerificar,
  contradiceProductoEncontrado,
  asumeProductoAmbiguoSinPreguntar,
  handoffPorHechoDeEspecialistaSinVerificar,
  niegaMetodoDePagoPermitido,
  CORRECCION_DE_PRODUCTO_CONTRADICHO,
  CORRECCION_DE_PRODUCTO_AMBIGUO_SIN_PREGUNTAR,
  CORRECCION_DE_PAGO_CONTRADICHO,
  noDioElTotal,
  productosOlvidados,
  prometeRecurso,
  correccionDeRequisitoFaltante,
  correccionDeResumen,
  niegaDisponibilidadSinVerificar,
  resumenMalArmado,
  elClienteVioUnTotal,
  MENSAJE_RETIRADO,
  dijoOtroValorDeDomicilio,
  CORRECCION_DE_DOMICILIO_AGOTADO,
  CORRECCION_DE_DOMICILIO_CONTRADICHO,
  CORRECCION_DE_DOMICILIO_YA_CONSULTADO,
  inconsistenciaFinancieraDePedido,
  bloqueDeCifrasVerificadas,
  correccionDeInconsistenciaFinanciera,
  contradiceDatosDeCuenta,
  CORRECCION_DE_DATOS_DE_CUENTA,
  correccionDePropuestaRechazada,
  cifrasEnPesosDelTexto,
} from "@/server/ai/anuncio-de-cierre";
import { registrarUsoIa } from "@/server/usage";
import { encolarTurno, siguePoseyendoElTrabajo } from "@/server/ai/cola";
import {
  agregarContenidoFaltante,
  correccionDeContenidoFaltante,
  disparadoPor,
  extraerContenidoObligatorio,
} from "@/server/ai/contenido-obligatorio";

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
 * Corrección para el guardarraíl de "pedido ya confirmado" (incidente real,
 * 5-sep-2026, Caso B: un mensaje del cliente DESPUÉS de un cierre exitoso
 * reabría la confirmación). Mismo patrón que el resto de correcciones de
 * este archivo: no se le dice "vas a rehacer el pedido", se le dice qué
 * hecho verificado ignoró y qué debe hacer con el mensaje real del cliente.
 */

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
  opts?: { immediate?: boolean; waMessageId?: string }
): Promise<void> {
  const delayMs = opts?.immediate ? 0 : getEnv().AGENT_COALESCE_MS;
  await encolarTurno(conversationId, {
    delayMs,
    diagnostico: {
      waMessageId: opts?.waMessageId,
      camino: opts?.immediate ? "immediate" : "debounce",
    },
  });
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

/**
 * A partir de cuánta inactividad un mensaje nuevo se trata como una
 * interacción aparte, no como continuación de lo que se hablaba antes
 * (docs/korexia/151).
 *
 * Es el mismo umbral que la ventana de servicio de WhatsApp (`WINDOW_MS`,
 * 24h): pasado ese punto, WhatsApp mismo ya no deja mandar texto libre sin
 * plantilla, así que es la frontera real entre "la misma conversación" y
 * "una nueva" — no un número inventado para este caso. Por debajo de eso
 * (una pausa de horas dentro del mismo día, alguien que responde después de
 * salir a almorzar) es exactamente el tipo de silencio normal que NO debe
 * romper la continuidad: forzarlo habría convertido pausas legítimas en
 * falsos reinicios.
 *
 * Incidente real: una clienta con un pedido cerrado 11 días antes escribió
 * "Hola" y el bot respondió como si el pedido siguiera en curso — el
 * historial que ve el modelo no llevaba ninguna marca de tiempo, así que 11
 * días de silencio se veían exactamente igual que 11 segundos.
 */
const SALTO_DE_HISTORIAL_MS = WINDOW_MS;

function diasDeSalto(gapMs: number): number {
  return Math.floor(gapMs / (24 * 60 * 60 * 1000));
}

/** Solo los mensajes que de verdad llegan al modelo (con texto y con fecha). */
function conTextoYFecha<T extends { text: string | null; createdAt?: Date }>(
  history: T[]
): (T & { createdAt: Date })[] {
  return history.filter(
    (m): m is T & { createdAt: Date } => Boolean(m.text) && m.createdAt !== undefined
  );
}

/**
 * El mayor salto de inactividad (en días) dentro del historial que se le va
 * a dar al modelo, o `null` si ninguno llega al umbral. Puramente
 * diagnóstico — lo usa `[traza]` (docs/korexia/151), nunca decide nada del
 * turno. Sin `createdAt` en los mensajes (el Laboratorio, o pruebas que no
 * lo necesitan) no hay nada que detectar y devuelve `null`, igual que
 * siempre se comportó esto antes de existir.
 */
export function mayorSaltoDeHistorial(
  history: { text: string | null; createdAt?: Date }[]
): number | null {
  const mensajes = conTextoYFecha(history);
  let mayorGapMs = 0;
  for (let i = 1; i < mensajes.length; i++) {
    const gapMs = mensajes[i]!.createdAt.getTime() - mensajes[i - 1]!.createdAt.getTime();
    if (gapMs >= SALTO_DE_HISTORIAL_MS && gapMs > mayorGapMs) mayorGapMs = gapMs;
  }
  return mayorGapMs > 0 ? diasDeSalto(mayorGapMs) : null;
}

/**
 * Fase 8I — qué decirle al modelo de un mensaje del cliente que llegó SIN
 * texto pero CON adjunto (un sticker, un video, o un audio/imagen cuya
 * conversión falló).
 *
 * Incidente real (MALIA, 8-sep-2026, conv cv_d6dk9kjvzln94gm5qlv4): una
 * clienta mandó un sticker. `mediaATexto` no convierte stickers y
 * `textoDeMensaje` deja `null` cuando hay adjunto, así que la fila se guardó
 * sin texto y el filtro de aquí abajo la descartaba entera. Como era el
 * ÚLTIMO mensaje, lo que le llegaba al modelo terminaba en su propia
 * respuesta anterior — y Gemini rechaza eso: `400 "Requests ending with a
 * model turn are not supported"` → derivación a una persona.
 *
 * Es la MISMA familia del incidente de Jorge (La Churra, 2-ago-2026, ver el
 * comentario de `pendientes` en `runAgentTurn`): historial que termina en el
 * turno del propio agente → error del proveedor → venta perdida. Aquel se
 * cerró para "no hay nada nuevo que contestar"; este entra por la otra
 * puerta: SÍ hay algo nuevo, pero sin texto que mostrar.
 *
 * Medido en producción antes del arreglo: 234 stickers, 27 videos y 15
 * audios en 30 días, en ~114 conversaciones — todos invisibles para el
 * agente. No es un caso raro: es tráfico normal de WhatsApp.
 *
 * El marcador se calcula aquí, al armar lo que ve el modelo, y NO se guarda
 * en la base: en la bandeja una persona ya ve el sticker en pantalla y un
 * texto puesto encima sería ruido. Así además quedan cubiertos los 277
 * mensajes que ya están guardados sin texto, sin migrar nada.
 */
export function descripcionDeAdjuntoSinTexto(type: string | null | undefined): string {
  switch (type) {
    case "sticker":
      return "[el cliente envió un sticker]";
    case "video":
      return "[el cliente envió un video]";
    case "audio":
      return "[el cliente envió una nota de voz que no se pudo transcribir]";
    case "image":
      return "[el cliente envió una imagen que no se pudo leer]";
    case "document":
      return "[el cliente envió un documento]";
    default:
      return "[el cliente envió un archivo]";
  }
}

export function toChatHistory(
  history: {
    direction: string;
    text: string | null;
    aiGenerated?: boolean;
    createdAt?: Date;
    type?: string | null;
    mediaUrl?: string | null;
  }[],
  estado?: "abierto" | "cerrado" | null
): ChatMessage[] {
  /*
   * Fase 8I — un mensaje ENTRANTE con adjunto y sin texto deja de
   * desaparecer: se le pone un marcador que describe qué llegó (ver
   * `descripcionDeAdjuntoSinTexto`). Solo los entrantes: un saliente sin
   * texto no puede dejar el historial terminando en turno del modelo, que es
   * lo que rompía el turno, y tocarlo sería cambiar lo que ve el modelo en
   * conversaciones donde hoy funciona bien.
   */
  const mensajes = history
    .map((m) =>
      !m.text && m.direction === "in" && m.mediaUrl
        ? { ...m, text: descripcionDeAdjuntoSinTexto(m.type) }
        : m
    )
    .filter((m) => m.text);
  const resultado: ChatMessage[] = [];
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i]!;
    const anterior = mensajes[i - 1];
    if (anterior?.createdAt && m.createdAt) {
      const gapMs = m.createdAt.getTime() - anterior.createdAt.getTime();
      if (gapMs >= SALTO_DE_HISTORIAL_MS) {
        resultado.push({
          role: "user",
          content:
            `[SISTEMA] Pasaron ${diasDeSalto(gapMs)} días sin mensajes en esta conversación. ` +
            `Trata lo que sigue como una interacción NUEVA: no asumas que continúa un pedido, ` +
            `una cita o un motivo de escalar de antes de la pausa, salvo que el cliente lo diga.`,
        });
      }
    }
    if (m.direction === "in") {
      resultado.push({ role: "user", content: m.text! });
      continue;
    }
    if (m.aiGenerated === false) {
      resultado.push({
        role: "user",
        content: `[Lo escribió una persona del negocio al cliente, NO tú. Respeta los compromisos concretos que haga con este cliente (algo que le prometieron, guardaron o ya está en curso), pero si menciona catálogo, precios, disponibilidad, horarios, especialistas o métodos de pago, esa información puede haber cambiado desde entonces: para esos datos confía siempre en lo que sabes ahora, no en lo que se dijo aquí]: ${m.text!}`,
      });
      continue;
    }
    const texto = estado === "abierto" && anunciaCierre(m.text) ? MENSAJE_RETIRADO : m.text!;
    resultado.push({ role: "assistant", content: JSON.stringify({ action: "reply", text: texto }) });
  }
  return resultado;
}

/** Los textos de una acción que llegan a ojos del cliente. */
export function textosAlCliente(action: AgentActionType): string[] {
  switch (action.action) {
    case "reply":
      return [action.text];
    case "update_lead":
    case "move_stage":
    case "provide_requirement":
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
  serviceIds: string[],
  slots: { fecha: string; hora: string }[]
): Promise<void> {
  if (!conversationId) return;
  try {
    await registrarOfrecidos({
      organizationId,
      conversationId,
      serviceIds,
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
  /*
   * Uno o varios servicios en la MISMA visita ("manos y pies tradicional"):
   * cada nombre se resuelve por separado contra el catálogo, con el mismo
   * `buscarServicio` de siempre — no hay un segundo matcher para esto.
   */
  const resueltos: ServiceRow[] = [];
  for (const nombre of action.servicios) {
    const servicio = buscarServicio(services, nombre);
    if (!servicio) {
      const nombresCatalogo =
        services.map((s) => s.name).join(", ") || "(sin servicios configurados)";
      return `[SISTEMA] No encontré "${nombre}" en el catálogo. Servicios reales: ${nombresCatalogo}. Pregúntale al cliente cuál de estos quiere.`;
    }
    resueltos.push(servicio);
  }
  const nombreVisita = resueltos.map((s) => s.name).join(" + ");

  for (const servicio of resueltos) {
    const enCatalogo = services.find((s) => s.id === servicio.id);
    if (!enCatalogo?.staffNames.length) {
      return `[SISTEMA] "${servicio.name}" no tiene especialista asignado todavía: no se puede agendar. Dile al cliente que ese servicio no está disponible para agendar por ahora.`;
    }
  }

  const serviceIds = resueltos.map((s) => s.id);
  const resuelto = await resolverEspecialistaMultiple(organizationId, serviceIds, action.especialista);
  if (!resuelto.ok) {
    if (!resuelto.opciones.length) {
      return `[SISTEMA] Nadie atiende esa combinación de servicios (${nombreVisita}) a la vez. Dile al cliente que agende esos servicios por separado, o pregúntale si quiere solo uno.`;
    }
    return `[SISTEMA] "${action.especialista}" no atiende "${nombreVisita}". Quienes SÍ atienden esa combinación: ${resuelto.opciones.join(", ")}. Ofrécele solo esas opciones.`;
  }

  if (action.fecha) {
    const fecha = normalizarFecha(action.fecha) ?? action.fecha;
    if (!esFechaValida(fecha, hours, now)) {
      return `[SISTEMA] "${fecha}" no es una fecha agendable (ya pasó o el negocio no atiende ese día). Pídele otra fecha.`;
    }
    const disp = await disponibilidadRealMultiple({
      organizationId,
      services: resueltos,
      fecha,
      staffIdPreferido: resuelto.staffId,
      hours,
      now,
    });
    const horas = Object.keys(disp).sort();
    if (!horas.length) {
      return `[SISTEMA] No hay horarios libres para "${nombreVisita}" el ${fecha}. Ofrece otra fecha.`;
    }
    await anotarOfrecidos(
      organizationId,
      conversationId,
      serviceIds,
      horas.map((hora) => ({ fecha, hora }))
    );
    const lista = horas.map((h) => horaAAmPm(h)).join(", ");
    return (
      `[SISTEMA] Horarios REALES disponibles para "${nombreVisita}" el ${fecha}: ${lista}. ` +
      `Solo estos horarios se pueden agendar. ${COMO_OFRECER}`
    );
  }

  const proximas = await proximasFechasConCupoMultiple({
    organizationId,
    services: resueltos,
    staffIdPreferido: resuelto.staffId,
    hours,
    now,
  });
  if (!proximas.length) {
    return `[SISTEMA] No encontré cupos próximos para "${nombreVisita}". Dile al cliente que lo confirmas con el equipo.`;
  }
  await anotarOfrecidos(
    organizationId,
    conversationId,
    serviceIds,
    proximas.flatMap((p) => p.horarios.map((hora) => ({ fecha: p.fecha, hora })))
  );
  const texto = proximas
    .map((p) => `${p.fecha}: ${p.horarios.map(horaAAmPm).join(", ")}`)
    .join(" | ");
  return (
    `[SISTEMA] Próximas fechas con cupo para "${nombreVisita}": ${texto}. ` +
    `Solo estos horarios se pueden agendar. ${COMO_OFRECER}`
  );
}

/**
 * Resultado de agotar (o resolver) un bucle de `consult_availability`.
 *
 * `ok:false` significa que el propio bucle YA dejó el turno en un estado
 * final — ya registró la traza, ya avisó al equipo si hacía falta — y quien
 * llama debe propagar `resultado` tal cual (o `null`) sin decidir nada más.
 */
type ResultadoBucleDisponibilidad =
  | { ok: true; action: AgentActionType; consultas: number }
  | { ok: false; resultado: AgentActionType | null };

/**
 * Agota un bucle de `consult_availability`: cada vuelta consulta el backend
 * real y le devuelve la respuesta al modelo, hasta que produzca una acción
 * DISTINTA de `consult_availability` o se agote `MAX_CONSULTAS_DISPONIBILIDAD`.
 *
 * Única fuente de esta protección (corrección de los dos defectos bloqueantes
 * del guardarraíl de Lashes Valen, 30-ago-2026): antes existían DOS copias
 * de este mismo criterio — el bucle que resuelve la primera
 * `consult_availability` que propone el modelo, y el reintento de
 * `disponibilidad_sin_verificar` cuando ese guardarraíl corrige un
 * `reply`/`handoff` sin verificar. La segunda copia no estaba protegida: si
 * tras darle al modelo la disponibilidad real este volvía a pedir
 * `consult_availability` en vez de responder, la acción llegaba intacta
 * hasta el switch final de `runAgentTurn` — que no tiene `case` para
 * `consult_availability`, porque nunca debería llegar tan lejos — y el turno
 * terminaba en el `return null` genérico: el cliente se quedaba sin ninguna
 * respuesta. Ahora los dos caminos llaman a esta misma función, así que
 * ningún uso futuro de `consult_availability` puede reabrir ese mismo hueco
 * sin tocar este único lugar.
 */
async function resolverBucleDeDisponibilidad(
  messages: ChatMessage[],
  accionInicial: AgentActionType,
  ctx: {
    organizationId: string;
    conversationId: string;
    conversation: Conversation;
    services: CatalogEntry[];
    hours: BusinessHours;
    now?: Date;
    traza: TrazaDelTurno;
    /** Distingue en `registrarUsoIa` el bucle original del que dispara el reintento de `disponibilidad_sin_verificar`, sin cambiar nada del criterio. */
    sufijoDeUso?: string;
  }
): Promise<ResultadoBucleDisponibilidad> {
  const MAX_CONSULTAS_DISPONIBILIDAD = 2;
  let action = accionInicial;
  let consultas = 0;
  while (
    action.action === "consult_availability" &&
    consultas < MAX_CONSULTAS_DISPONIBILIDAD
  ) {
    consultas++;
    const infoDisponibilidad = await resolverConsultaDisponibilidad(
      ctx.organizationId,
      ctx.services,
      ctx.hours,
      action,
      ctx.now,
      ctx.conversationId
    );
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "user", content: infoDisponibilidad });
    agregarHecho(ctx.traza, {
      tipo: "disponibilidad",
      consulta: action.servicios.join("|"),
      resultado: "consultado",
      origen: "backend",
    });
    const siguiente = await chatJson(AgentAction, messages, {
      jsonSchema: formatoDeRespuestaDeAccion(),
    });
    await registrarUsoIa(
      ctx.organizationId,
      siguiente.usage,
      `conv:${ctx.conversationId}/disponibilidad${ctx.sufijoDeUso ?? ""}`
    );
    if (!siguiente.ok) {
      if (siguiente.error === "not_configured") return { ok: false, resultado: null };
      console.error(
        `[agente] fallo del proveedor tras consultar disponibilidad: ${siguiente.detail}`
      );
      await derivarAUnaPersona(ctx.conversation);
      registrarHandoff(ctx.traza, "backend_error");
      ctx.traza.accionFinal = "handoff";
      registrarTrazaDelTurno(ctx.traza);
      return { ok: false, resultado: { action: "handoff", reason: "error" } };
    }
    action = siguiente.data;
  }
  if (action.action === "consult_availability") {
    // Se agotaron los intentos sin llegar a una acción final: mejor una
    // persona que una promesa de horario sin datos reales detrás — o que un
    // silencio total, que es justo lo que esto reemplaza.
    await derivarAUnaPersona(ctx.conversation);
    registrarHandoff(ctx.traza, "model_output_recovery_failed");
    ctx.traza.accionFinal = "handoff";
    registrarTrazaDelTurno(ctx.traza);
    return { ok: false, resultado: { action: "handoff", reason: "error" } };
  }
  return { ok: true, action, consultas };
}

/**
 * Resultado de pasar la respuesta de un reintento de guardarraíl por
 * `resolverAccionTrasReintento`.
 */
type ResultadoReintentoDeGuardarrail =
  | { ok: true; accion: AgentActionType }
  | { ok: false; resultado: AgentActionType | null };

/**
 * Envuelve la respuesta de CUALQUIER reintento de guardarraíl de texto
 * (cierre falso, cita fantasma, recurso prometido, pago sin verificar, turno
 * mudo, requisito faltante): si esa respuesta es `consult_availability`, la
 * resuelve con `resolverBucleDeDisponibilidad` antes de devolverla — nunca la
 * deja pasar sin resolver hacia el chequeo textual del guardarraíl que la pidió.
 *
 * Por qué este mismo defecto vivía en SEIS guardarraíles a la vez, no solo en
 * uno (corrección de los dos defectos bloqueantes de Lashes Valen,
 * 30-ago-2026): todos comparten el mismo molde — "acepta la corrección del
 * reintento si ya no repite el mismo problema textual" — y todos juzgan eso
 * con `textosAlCliente(reintento.data)`. Esa función no tiene `case` para
 * `consult_availability` (cae al `default: return []`), así que CUALQUIERA
 * de esos guardarraíles aceptaba un `consult_availability` sin resolver como
 * si fuera una corrección válida — un array vacío nunca "repite" nada.
 *
 * Evidencia real que lo confirmó (no solo análisis del código): escenario B
 * de la validación de Lashes Valen — el cliente preguntó por un especialista
 * inexistente, el modelo "confirmó" una cita sin haberla agendado, disparó
 * `cita_fantasma`, y en el reintento volvió a pedir `consult_availability`.
 * Esa acción llegó intacta hasta el switch final de `runAgentTurn` —sin
 * `case` para ella— y el turno terminó en `return null`: silencio total para
 * la clienta.
 */
async function resolverAccionTrasReintento(
  messagesReintento: ChatMessage[],
  reintento: ChatJsonResult<AgentActionType>,
  ctx: Parameters<typeof resolverBucleDeDisponibilidad>[2]
): Promise<ResultadoReintentoDeGuardarrail> {
  if (!reintento.ok) return { ok: false, resultado: null };
  if (reintento.data.action !== "consult_availability") {
    return { ok: true, accion: reintento.data };
  }
  const resultadoBucle = await resolverBucleDeDisponibilidad(
    messagesReintento,
    reintento.data,
    ctx
  );
  if (!resultadoBucle.ok) return { ok: false, resultado: resultadoBucle.resultado };
  return { ok: true, accion: resultadoBucle.action };
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

function pesosPipeline(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 })}`;
}

/**
 * Arma el mensaje `[SISTEMA]` de `consultar_producto` — mismo espíritu que
 * `resolverConsultaDisponibilidad`: el servidor calcula el hecho contra
 * `product` (ya filtrado a disponibles por `catalogoDePedidos`), nunca el
 * modelo leyendo el catálogo en prosa.
 */
function textoDeResultadoProducto(
  consulta: string,
  resultado: ReturnType<typeof buscarProductos>
): string {
  if (resultado.status === "found") {
    const p = resultado.producto;
    const precio = p.precioCents === null ? "precio a confirmar con el equipo" : pesosPipeline(p.precioCents);
    return `[SISTEMA] Encontré "${p.nombre}" en el catálogo real — ${precio}. Este dato es real: SÍ lo tienen. Úsalo tal cual, no digas que no lo tienen ni que necesitas confirmarlo.`;
  }
  if (resultado.status === "multiple_matches") {
    const lista = resultado.productos.map((p) => `"${p.nombre}"`).join(", ");
    return `[SISTEMA] Encontré varios productos que podrían ser lo que preguntan: ${lista}. Pregúntale al cliente cuál de estos es, antes de dar un precio o confirmar que lo tienen.`;
  }
  return `[SISTEMA] No encontré "${consulta}" en el catálogo real. No digas que sí lo tienen: sigue tus reglas de siempre (decir que no lo manejan, o que lo confirmas con el equipo).`;
}

/**
 * Fase urgente (4-sep-2026) — incidente real de La Churra. "No encontrado
 * entre los productos" nunca puede convertirse en "[SISTEMA] no lo tienen"
 * sin revisar TAMBIÉN las opciones (salsas, toppings, tamaños) — ver
 * `buscarOpciones`. Esta función es el único punto donde se decide el
 * texto final: si el producto se encontró (o hay varios candidatos), el
 * comportamiento es EXACTAMENTE el de siempre (`textoDeResultadoProducto`);
 * solo cuando el producto no aparece se consulta la segunda fuente antes
 * de afirmar que no existe.
 */
function textoDeResultadoCatalogo(
  consulta: string,
  resultadoProducto: ReturnType<typeof buscarProductos>,
  resultadoOpcion: ReturnType<typeof buscarOpciones> | null
): string {
  if (resultadoProducto.status !== "not_found" || !resultadoOpcion) {
    return textoDeResultadoProducto(consulta, resultadoProducto);
  }
  if (resultadoOpcion.status === "found") {
    const { opcion, productos } = resultadoOpcion.encontrada;
    const nombresProductos = productos.map((p) => p.nombre).join(", ");
    const extra = opcion.precioExtraCents > 0 ? ` (+${pesosPipeline(opcion.precioExtraCents)})` : "";
    return `[SISTEMA] "${opcion.nombre}" no es un producto, es una opción real del catálogo${extra} — disponible para: ${nombresProductos}. SÍ la tienen: úsala tal cual, no digas que no existe ni que no la manejan.`;
  }
  if (resultadoOpcion.status === "multiple_matches") {
    const lista = resultadoOpcion.encontradas.map((e) => `"${e.opcion.nombre}"`).join(", ");
    return `[SISTEMA] Encontré varias opciones del catálogo que podrían ser lo que preguntan: ${lista}. Pregúntale al cliente cuál es, antes de confirmar que la tienen.`;
  }
  // Genuinamente no está ni entre los productos ni entre las opciones.
  return textoDeResultadoProducto(consulta, resultadoProducto);
}

/**
 * Arma el mensaje `[SISTEMA]` para una consulta de LISTADO abierto ("¿qué
 * sabores tienen?"), a diferencia de `textoDeResultadoProducto` (un producto
 * puntual). Reutiliza `renderCatalogoDePedidos` tal cual — el mismo texto que
 * ya arma el system prompt — para no duplicar el formato del catálogo en dos
 * sitios distintos.
 */
function textoDeListadoDeProducto(productos: ProductoDelCatalogo[]): string {
  return (
    `[SISTEMA] Este es el catálogo real y ACTUAL de este negocio. Respóndele al ` +
    `cliente con base en esta lista, no en lo que se haya dicho antes en la ` +
    `conversación (puede estar desactualizado):\n${renderCatalogoDePedidos(productos)}`
  );
}

/** Mismo principio que `textoDeResultadoProducto`, para métodos de pago (caso Nequi). */
function textoDeResultadoPago(
  metodo: string,
  resultado: ReturnType<typeof resolverMetodoDePago>
): string {
  if (resultado.status === "recognized" && resultado.allowed) {
    return `[SISTEMA] "${metodo}" SÍ está entre las formas de pago de este negocio. Confírmalo con seguridad, no lo pongas en duda.`;
  }
  if (resultado.status === "recognized") {
    return `[SISTEMA] "${metodo}" NO está entre las formas de pago de este negocio. Dilo con naturalidad y sigue con el resto del pedido.`;
  }
  return `[SISTEMA] No reconozco "${metodo}" con certeza contra las formas de pago declaradas. No lo rechaces categóricamente: sigue tus reglas de siempre (di que lo confirmas con el equipo y continúa).`;
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
  opts?: {
    now?: Date;
    /**
     * Fase 11-A — presente SOLO cuando el turno viene de la cola real
     * (`worker.ts`, ver `ejecutar()`). Con esto puesto, cualquier efecto
     * externo del turno se detiene si este worker deja de ser el dueño
     * válido de la generación — ver `asegurarOwnershipVigente`.
     */
    jobOwnership?: { jobId: string; generation: number };
  }
): Promise<AgentActionType | null> {
  if (!isAiConfigured()) return null;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation: Conversation | undefined = convRows[0];
  if (!conversation) return null;
  conversation.jobOwnership = opts?.jobOwnership;
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

  /**
   * Fuente única del vertical (docs/korexia/79-ARQUITECTURA-MULTIEMPRESA.md):
   * de aquí en adelante todo el archivo pregunta por `vertical`, nunca por la
   * columna cruda. `verticalDe`/`contrataCitas` son el único sitio que sabrá
   * de un tercer vertical el día que exista uno — antes de esto, seis `if`
   * de este mismo archivo seguían leyendo `profile.appointmentsEnabled`
   * directo, y esa promesa de "un solo sitio" estaba a medias.
   */
  const vertical = verticalDe(profile.appointmentsEnabled);

  // El catálogo de servicios solo se carga (y solo se le ofrece al modelo) si
  // esta organización tiene el vertical de citas encendido: así el prompt de
  // La Churra y Lis no crece con acciones que jamás van a usar.
  const services: CatalogEntry[] = contrataCitas(vertical)
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
  /**
   * El mismo catálogo, en crudo — reutilizado más abajo por la detección
   * factual (docs/korexia/143) y por el bucle de `consultar_producto`, para
   * no repetir la consulta a la base de datos dos o tres veces en el mismo
   * turno.
   */
  let productosDelPedido: ProductoDelCatalogo[] = [];
  if (!contrataCitas(vertical) && profile.catalogSource === "tabla") {
    productosDelPedido = await catalogoDePedidosQuery(organizationId);
    if (productosDelPedido.length > 0) {
      catalogoDePedidos = renderCatalogoDePedidos(productosDelPedido);
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
   *
   * Hasta el 17-ago-2026 esto llevaba además `!profile.appointmentsEnabled`:
   * la Fase 2 estaba vedada a citas. `items[]`/`reserva` ya son genéricos
   * (docs/korexia/88-AUDITORIA-SELECCION-MULTIPLE.md, paso 4) y NINGÚN
   * cliente real tiene hoy `appointmentsEnabled` + `stateSource='backend'` a
   * la vez, así que levantar la exclusión no cambia el comportamiento de
   * nadie todavía — solo dice de dónde sale el catálogo cuando algún día sí.
   */
  const estadoEstructurado = profile.stateSource === "backend";
  let bloqueDeEstado: string | undefined;
  let estadoGuardado: EstadoDelPedido | null = null;
  // Prioridad 3 (programa de mejora integral) — token de concurrencia de la
  // fila leída este turno; ver `guardarEstado({..., versionEsperada})`.
  let versionDeEstadoLeido: number | undefined;
  /**
   * Qué pide ESTE negocio para cerrar. Sale de su ficha; el núcleo no tiene ni
   * una lista de campos. Vacío = no hay ficha (Lis, con prompt manual).
   *
   * Deliberadamente FUERA del `if (estadoEstructurado)`: hasta el 19-ago solo
   * se calculaba con la Fase 2 encendida, así que el guardarraíl de
   * requisitos (que corre con `stateSource='prompt'`, el caso real de toda la
   * flota hoy) no tenía de dónde leerlos. Es una lectura barata —JSON ya en
   * memoria, sin ir a la base— así que calcularla siempre no cuesta nada.
   */
  const fichaDelNegocio = leerFicha(profile.ficha);
  /**
   * Se recalcula más abajo con la modalidad del pedido, en cuanto se lee el
   * estado. Aquí se resuelve solo con la ficha, que es lo correcto mientras no
   * se sepa nada del pedido — y lo único posible con la Fase 2 apagada.
   */
  let requisitos: Requisito[] | undefined = fichaDelNegocio
    ? requisitosDe(fichaDelNegocio as FichaDelNegocio)
    : undefined;
  /** Lo que este negocio OFRECE. La elección del cliente vive en el estado. */
  const modalidadesOfrecidas = fichaDelNegocio
    ? modalidadesDeEntrega(fichaDelNegocio as FichaDelNegocio)
    : [];
  /**
   * Igual que `requisitos`: se calcula siempre que haya ficha, sin depender
   * de la Fase 2. Solo se usa si el vertical es citas — en pedidos el pago
   * lo maneja `CIERRE`, de otra forma (docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md).
   */
  const pagoDeCitas =
    contrataCitas(vertical) && fichaDelNegocio
      ? {
          pago: (fichaDelNegocio as FichaDelNegocio).pago,
          antes: pagoAntesDeLaCitaDe(fichaDelNegocio as FichaDelNegocio),
        }
      : undefined;

  /**
   * Mismo dato que `pagoDeCitas`, para PEDIDOS — apagado por defecto
   * (`payment_source = 'prompt'`, como nace todo cliente). Con la bandera en
   * 'ficha', las formas de pago dejan de depender de que el modelo interprete
   * bien la prosa de `instructions` y se leen frescas en cada turno, igual
   * que ya hace citas. Ver el interruptor en `schema.ts` (`paymentSource`).
   */
  const pagoDePedidos =
    !contrataCitas(vertical) && profile.paymentSource === "ficha" && fichaDelNegocio
      ? (fichaDelNegocio as FichaDelNegocio).pago
      : undefined;

  /**
   * Zonas de domicilio (Fase 10N-J, incidente real de Kachipay) — apagado
   * por defecto (`delivery_source = 'prompt'`, como nace todo cliente). Con
   * la bandera en 'tabla', el precio de domicilio deja de depender de que
   * el modelo lo recuerde o lo infiera bien de la ficha en prosa: se
   * resuelve contra `delivery_zone`, verificado, igual que ya hace el
   * catálogo de productos.
   */
  /**
   * Fase 10V-X — un solo interruptor para todo lo nuevo de este fase: la
   * carga de zonas Y la persistencia de la verificación entre turnos. A
   * propósito NUNCA depende de `estadoEstructurado`/`state_source` — ver el
   * comentario de `leerEntregaVerificada` en `orders/estado.ts`.
   */
  const domicilioEstructurado = !contrataCitas(vertical) && profile.deliverySource === "tabla";
  const zonasDeEntrega: ZonaDeEntrega[] = domicilioEstructurado
    ? await zonasDeEntregaQuery(organizationId)
    : [];

  if (estadoEstructurado) {
    const productos = await catalogoDe(organizationId, vertical);
    if (productos.length === 0) {
      // Sin catálogo en tablas no hay nada contra lo que validar: se cae al
      // comportamiento de siempre en vez de inventarse un pedido.
      console.warn(
        `[estado] ${organizationId}: state_source='backend' pero sin catálogo; se usa el del prompt`
      );
    } else {
      if (lastInbound.text && matchesReinicio(lastInbound.text)) {
        await borrarEstado(conversation.id, { actor: "pipeline", proceso: "reinicio", organizationId });
      }
      const filaDeEstado = await leerEstadoConVersion(conversation.id, organizationId);
      estadoGuardado = filaDeEstado?.estado ?? null;
      versionDeEstadoLeido = filaDeEstado?.version;
      /*
       * Ahora sí se sabe cómo quiere recibirlo el cliente, así que los
       * requisitos se resuelven con las DOS mitades: lo que el negocio ofrece
       * (ficha) y lo que este pedido eligió (estado).
       *
       * Se recalcula aquí, en el mismo productor, y no en los consumidores: la
       * lista que les llega cambia de contenido, nunca de forma — ninguno sabe
       * que la modalidad existe.
       */
      if (fichaDelNegocio) {
        requisitos = requisitosDe(fichaDelNegocio as FichaDelNegocio, {
          modalidadDeEntrega: estadoGuardado?.modalidadDeEntrega ?? null,
        });
      }
      /*
       * El catálogo ENTERO, con sus grupos: quien decide qué falta es el
       * catálogo del negocio, no una línea escrita aquí. Antes esto calculaba
       * "cuántas salsas lleva" y se lo pasaba a `comoTexto` como un número —el
       * grupo de un negocio concreto, dentro del núcleo.
       *
       * Y antes de la v4 era un `.find()` del producto del pedido: con dos
       * productos resolvía el primero y **el segundo se quedaba sin grupos**,
       * así que el modelo no veía que le faltaban sus opciones.
       */
      if (estadoGuardado) {
        bloqueDeEstado = comoTexto(estadoGuardado, productos, requisitos ?? [], vertical);
      }
    }
  }

  /**
   * Fase 10V-X — la última verificación de domicilio conocida, para que el
   * guardarraíl de cierre (más abajo) no dependa de que el modelo
   * reverifique EN ESTE TURNO. Si `estadoEstructurado` ya leyó el estado
   * completo arriba, se reutiliza esa misma lectura (nunca dos golpes a la
   * base por lo mismo); si no (el caso real de toda la flota hoy), se lee
   * aparte — `leerEntregaVerificada` es independiente de `state_source` a
   * propósito, ver su comentario en `orders/estado.ts`.
   */
  let entregaPersistida: EntregaVerificada | null = null;
  if (domicilioEstructurado) {
    /**
     * Mismo comando "0" que ya vacía el estado de Fase 2 (arriba) — pero
     * ese `borrarEstado` solo corre dentro de `estadoEstructurado` con
     * catálogo cargado. Aquí se repite de forma independiente para que un
     * cliente en `state_source='prompt'` (todos los reales hoy) también
     * pueda arrancar de cero: sin esto, "0" reiniciaba el pedido en prosa
     * pero la tarifa de domicilio verificada seguía viva.
     */
    if (lastInbound.text && matchesReinicio(lastInbound.text)) {
      await guardarEntregaVerificada({
        conversationId: conversation.id,
        organizationId,
        entrega: null,
        actor: "pipeline",
        proceso: "reinicio",
      });
    }
    entregaPersistida = estadoEstructurado
      ? (estadoGuardado?.entrega ?? null)
      : await leerEntregaVerificada(conversation.id, organizationId);
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
        appointments: contrataCitas(vertical) ? { catalog: services } : undefined,
        catalogoDePedidos,
        estadoDelPedido: bloqueDeEstado,
        fotos,
        requisitos: requisitosPendientesDe(estadoGuardado, requisitos),
        pagoDeCitas,
        pagoDePedidos,
        tieneZonasDeEntrega: zonasDeEntrega.length > 0,
      }),
    },
    ...toChatHistory(history, estado),
  ];

  /**
   * Verificación factual FORZADA, antes de darle la palabra al modelo
   * (docs/korexia/143).
   *
   * `consultar_producto` (más abajo) depende de que el modelo DECIDA
   * pedirla — y la prueba controlada con Lis (26-ago-2026) mostró que no
   * siempre lo hace: con "¿tienen torta de chocolate?" a veces resolvía
   * directo con el catálogo en prosa, que sigue en el prompt. Cuando el
   * mensaje es una pregunta factual concreta y este negocio lo tiene
   * encendido, el SERVIDOR consulta el catálogo real ANTES de la primera
   * llamada, y el modelo ya recibe el hecho verificado en su primera
   * respuesta — sin depender de su criterio para decidir verificar.
   *
   * `detectarConsultaFactualDeProducto` es deliberadamente conservador:
   * ante cualquier señal de pregunta abierta (recomendación, categoría,
   * ocasión) devuelve `null` y este bloque no hace nada — el modelo sigue
   * respondiendo con el catálogo completo, como siempre. Reutiliza
   * `productosDelPedido` (ya en memoria desde arriba) y `buscarProductos`/
   * `textoDeResultadoProducto` (el mismo camino de `consultar_producto`):
   * es el mismo hecho verificado, solo que el servidor lo pide primero.
   */
  /**
   * Trazabilidad diagnóstica por turno (docs/korexia/145): una sola línea al
   * final que consolida qué se verificó, qué guardarraíl actuó y cómo
   * terminó — para no tener que reconstruir un incidente a mano juntando
   * logs sueltos por `conversationId` y cercanía de timestamps, como costó
   * con "Luisa" (doc 144). Se crea aquí, justo antes de la primera llamada
   * al modelo: antes de este punto no hay ninguna decisión que trazar.
   */
  const traza = crearTraza({
    organizationId,
    conversationId: conversation.id,
    mensajeId: lastInbound.id,
    mensajeTexto: lastInbound.text,
  });
  const saltoDeHistorial = mayorSaltoDeHistorial(history);
  if (saltoDeHistorial !== null) registrarSaltoDeHistorial(traza, saltoDeHistorial);

  /**
   * Consulta de LISTADO abierto ("¿qué sabores tienen?"), no de un producto
   * puntual — auditoría de jerarquía de verdad (1-sep-2026), incidente real
   * de Malía: un mensaje humano desactualizado en el historial ("no tenemos
   * Leche Klim") quedó como la última palabra porque la pregunta real
   * ("¿cuáles son los sabores que tienes?") no calzaba con
   * `detectarConsultaFactualDeProducto` (pide un producto, no una lista).
   *
   * Se evalúa ANTES que la consulta de producto puntual (hallazgo Fase C,
   * 1-sep-2026): con el orden inverso, "¿Qué sabores tienen disponibles?"
   * caía en `PATRON_EXISTENCIA` (que matchea "tienen" en cualquier
   * posición) y capturaba "disponibles" como si fuera el nombre de un
   * producto buscado — `SEÑALES_ABIERTAS` no lo excluía porque exige "que"
   * inmediatamente antes del verbo, y aquí hay un sustantivo de por medio
   * ("sabores"). Evaluar el listado primero es seguro: es deliberadamente
   * conservador (ver `deteccion.ts`) y nunca dispara en una pregunta de
   * producto identificable ("¿tienen Pavé de leche Klim?", "¿qué tienen de
   * chocolate?"), así que no le quita precedencia a esos casos.
   */
  let huboListado = false;
  if (
    profile.consultasVerificadasEnabled &&
    !contrataCitas(vertical) &&
    productosDelPedido.length > 0 &&
    lastInbound.text &&
    detectarConsultaDeListadoDeProducto(lastInbound.text)
  ) {
    huboListado = true;
    console.warn(
      `[producto] ${organizationId}: consulta de listado detectada (verificado antes de llamar al modelo)`
    );
    traza.deteccionFactual = "(listado de catálogo)";
    agregarHecho(traza, {
      tipo: "producto",
      consulta: "(listado completo)",
      resultado: "listado",
      origen: "backend",
    });
    messages.push({
      role: "user",
      content: textoDeListadoDeProducto(productosDelPedido),
    });
  }

  let resultadoProducto: ReturnType<typeof buscarProductos> | null = null;
  if (
    profile.consultasVerificadasEnabled &&
    !contrataCitas(vertical) &&
    productosDelPedido.length > 0 &&
    lastInbound.text &&
    !huboListado
  ) {
    const consultaFactual = detectarConsultaFactualDeProducto(lastInbound.text);
    if (consultaFactual) {
      resultadoProducto = buscarProductos(productosDelPedido, consultaFactual);
      /**
       * Incidente real de La Churra (4-sep-2026) — "¿tienen chocolate
       * blanco?" es una pregunta factual como cualquier otra, pero
       * "chocolate blanco" es una SALSA (una opción dentro de cada
       * producto), no un producto en sí. `buscarProductos` solo busca
       * entre nombres de producto, así que devolvía `not_found` y el
       * `[SISTEMA]` de abajo le decía al modelo "no lo tienen" sobre algo
       * que sí estaba en el catálogo, un nivel más abajo. "No encontrado
       * entre los productos" nunca puede convertirse en "no existe" sin
       * revisar también las opciones — ver `buscarOpciones`.
       */
      const resultadoOpcion =
        resultadoProducto.status === "not_found"
          ? buscarOpciones(productosDelPedido, consultaFactual)
          : null;
      console.warn(
        `[producto] ${organizationId}: consulta factual detectada="${consultaFactual}" status=${resultadoProducto.status}` +
          (resultadoOpcion ? ` status_opcion=${resultadoOpcion.status}` : "") +
          ` (verificado antes de llamar al modelo)`
      );
      traza.deteccionFactual = consultaFactual;
      agregarHecho(traza, {
        tipo: "producto",
        consulta: consultaFactual,
        resultado:
          resultadoOpcion && resultadoOpcion.status !== "not_found"
            ? `opcion_${resultadoOpcion.status}`
            : resultadoProducto.status,
        origen: "backend",
      });
      messages.push({
        role: "user",
        content: `${textoDeResultadoCatalogo(consultaFactual, resultadoProducto, resultadoOpcion)} (Esto ya está verificado: no hace falta que uses la acción consultar_producto para lo mismo.)`,
      });
    }
  }

  /**
   * Mismo principio, para medios de pago (docs/korexia/146): la prueba
   * controlada del doc 145 mostró que "¿Puedo pagar por Nequi?" obtenía la
   * respuesta correcta SIN pasar por `consultar_medio_pago` — el modelo
   * respondió leyendo `ficha.pago.formas` en prosa, la misma ruta
   * probabilística que ya se corrigió para productos. `pagoDePedidos` solo
   * existe con `payment_source='ficha'`; sin eso no hay contra qué
   * verificar.
   */
  /** La última zona de domicilio verificada EN ESTE TURNO (Fase 10N-J) — nunca sobrevive a otro turno, ver el comentario del guardarraíl financiero. */
  let resultadoZona: ReturnType<typeof resolverZonaDeEntrega> | null = null;
  let resultadoPago: ReturnType<typeof resolverMetodoDePago> | null = null;
  if (
    profile.consultasVerificadasEnabled &&
    !contrataCitas(vertical) &&
    pagoDePedidos &&
    lastInbound.text
  ) {
    const metodoFactual = detectarConsultaFactualDeMedioPago(lastInbound.text);
    if (metodoFactual) {
      resultadoPago = resolverMetodoDePago(pagoDePedidos.formas, metodoFactual);
      console.warn(
        `[pago] ${organizationId}: consulta factual detectada="${metodoFactual}" status=${resultadoPago.status}` +
          (resultadoPago.status === "recognized" ? ` allowed=${resultadoPago.allowed}` : "") +
          " (verificado antes de llamar al modelo)"
      );
      traza.deteccionFactualPago = metodoFactual;
      agregarHecho(traza, {
        tipo: "medio_pago",
        consulta: metodoFactual,
        resultado:
          resultadoPago.status === "recognized"
            ? `recognized:${resultadoPago.allowed ? "allowed" : "not_allowed"}`
            : resultadoPago.status,
        origen: "backend",
      });
      messages.push({
        role: "user",
        content: `${textoDeResultadoPago(metodoFactual, resultadoPago)} (Esto ya está verificado: no hace falta que uses la acción consultar_medio_pago para lo mismo.)`,
      });
    }
  }

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
  // Regla 10: el tiempo de extracción se mide sobre la llamada que trae la
  // propuesta, no sobre el turno entero. Con el estado apagado no se mide nada.
  const t0 = estadoEstructurado ? Date.now() : 0;
  const conEstado = estadoEstructurado
    ? await chatJsonConEstado(messages, requisitos ?? [], vertical, modalidadesOfrecidas, traza)
    : null;
  const msModelo = estadoEstructurado ? Date.now() - t0 : undefined;
  const result = conEstado ? conEstado.resultado : await chatJson(AgentAction, messages);
  const propuestaDelTurno = conEstado?.propuesta;

  /*
   * El modelo PROPONE; el backend valida y persiste.
   *
   * Se hace después de la respuesta y **fuera de su camino**: si la propuesta no
   * vale, se registra y se descarta, pero el cliente ya tiene su contestación.
   * Un estado que no valida no puede convertirse en un turno perdido.
   */
  const estadoRecienGuardado =
    estadoEstructurado && result.ok
      ? await guardarEstadoPropuesto({
          organizationId,
          conversationId: conversation.id,
          propuesta: propuestaDelTurno,
          msModelo,
          requisitos,
          vertical,
          modalidadesOfrecidas,
          entregaConocida: entregaPersistida,
          versionEsperada: versionDeEstadoLeido,
        })
      : null;
  // Se anota aunque el turno falle: los intentos fallidos también se pagan, y
  // son justo los que encarecen a un cliente sin que se note en ninguna parte.
  await registrarUsoIa(organizationId, result.usage, `conv:${conversationId}`);
  /**
   * Qué modelo contestó de verdad. Con los salvavidas repuestos (9-sep-2026)
   * el configurado y el que respondió pueden no ser el mismo, y la vez
   * anterior esa diferencia estuvo semanas invisible en producción.
   */
  registrarModelo(traza, result.usage?.model);
  if (!result.ok) {
    if (result.error === "not_configured") return null;
    /*
     * Fallo persistente tras agotar la recuperación disponible → escalar
     * (FR-022). `result.error` distingue la causa para quien lea el log
     * (docs/korexia/144): `invalid_output` es el modelo devolviendo algo
     * que no cumple el contrato incluso tras reintentar (Nivel 2, arriba y
     * en `chatJsonConEstado`) — no un proveedor caído. `handoffReason`
     * sigue siendo `"error"` sin distinguir, a propósito: no romper lo que
     * ya cuenta por ese valor en el CRM.
     */
    console.error(`[agente] fallo tras la recuperación (${result.error}): ${result.detail}`);
    await derivarAUnaPersona(conversation);
    registrarHandoff(traza, result.error);
    traza.accionFinal = "handoff";
    registrarTrazaDelTurno(traza);
    return { action: "handoff", reason: "error" };
  }

  let action: AgentActionType = result.data;

  /**
   * Fase 8J — el carrito que el backend RECHAZÓ deja de ser invisible.
   *
   * Incidente real (MALIA, 8-sep-2026, conv cv_2xfh67lig9a07xzief96): una
   * clienta pidió un "pavé de oblea". El backend rechazó el carrito CINCO
   * veces seguidas —`"Oblea" no está entre las opciones de Pavé Cremoso 8
   * oz`— y cada rechazo se registraba en una métrica y se descartaba
   * (`guardarEstadoPropuesto`, más abajo: antes hacía `return null`). El
   * modelo nunca se enteró: siguió armando el pedido con un ítem que el
   * sistema jamás iba a aceptar, le mostró un resumen de $36.000 a la
   * clienta, y el error solo salió a la luz al cerrar —cuando el guardarraíl
   * financiero vio que el carrito real valía $18.000— con una derivación a
   * una persona, diez minutos después. La clienta canceló.
   *
   * Medido en 3 horas de producción: **21 de 95 propuestas rechazadas
   * (22%)**, y la cascada es clara — un ítem que no resuelve deja el carrito
   * sin total, así que todos los turnos siguientes se rechazan con
   * `confirmado sin total calculado`. Avisarle al modelo en el PRIMER
   * rechazo corta la cascada entera.
   *
   * Aquí es el único punto donde esto se puede corregir a tiempo: el estado
   * se valida justo después de la respuesta del modelo y **antes** de que la
   * acción se ejecute, así que el cliente todavía no ha recibido nada.
   *
   * Deliberadamente conservador, por lo aprendido hoy con los guardarraíles
   * que causaron derivaciones en cadena:
   * - Solo corrige cuando el rechazo trae una PREGUNTA que hacerle al
   *   cliente (`dudas`): sin eso no hay nada accionable y una llamada más al
   *   modelo sería puro gasto.
   * - UN solo reintento.
   * - Si el reintento tampoco valida, **sigue el turno como hasta hoy** — no
   *   deriva. Peor que hoy, imposible; el guardarraíl financiero sigue
   *   siendo la última barrera antes de cerrar un pedido inconsistente.
   */
  if (estadoRecienGuardado?.rechazo && estadoRecienGuardado.rechazo.preguntas.length > 0) {
    const { motivos, preguntas } = estadoRecienGuardado.rechazo;
    console.warn(
      `[estado] propuesta rechazada por el backend en ${conversationId} (${motivos.join(" · ")}); avisando al modelo antes de responderle al cliente`
    );
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: correccionDePropuestaRechazada(motivos, preguntas) },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/propuesta-rechazada`
    );
    if (reintento.ok) {
      action = reintento.data;
      agregarGuardarrail(traza, "propuesta_rechazada", true);
    } else {
      // El proveedor falló en el reintento: se sigue con la respuesta
      // original, exactamente como se hacía antes de esta fase.
      agregarGuardarrail(traza, "propuesta_rechazada", false);
    }
  }

  /**
   * `consult_availability` es una acción interna: el sistema calcula los
   * horarios reales y se los devuelve al modelo EN EL MISMO turno (nunca le
   * llega nada al cliente todavía), igual que el horario de atención — la
   * disponibilidad la calcula el servidor, no el modelo. Acotado a 2 vueltas
   * (dentro de `resolverBucleDeDisponibilidad`) para que una conversación
   * confusa termine en handoff y no en un bucle, ni en un silencio.
   */
  const resultadoDisponibilidadInicial = await resolverBucleDeDisponibilidad(
    messages,
    action,
    { organizationId, conversationId, conversation, services, hours, now: opts?.now, traza }
  );
  if (!resultadoDisponibilidadInicial.ok) {
    return resultadoDisponibilidadInicial.resultado;
  }
  action = resultadoDisponibilidadInicial.action;
  const consultas = resultadoDisponibilidadInicial.consultas;

  /**
   * Afirmó, negó, o decidió escalar por un hecho de especialista sin
   * haberlo consultado (19-ago-2026, extendido a `handoff` el 30-ago-2026):
   * "¡Perfecto! Un retoque de Volumen Ruso con Hilary. ¿Para qué día...?"
   * — Hilary no atiende ese servicio; "Ese horario ya no está disponible"
   * para una hora que sí lo estaba; o escala con
   * reason="Confirmar si Laura existe..." sin haber llamado nunca a
   * `consult_availability`, que sí puede resolverlo al instante. `consultas`
   * (arriba) es 0 en los tres casos: el modelo nunca llamó a
   * `consult_availability` en este turno.
   *
   * Caso real que motivó la tercera rama (Lashes Valen, 30-ago-2026, conv
   * cv_p5k7bbyvh09pr4f4de72): un especialista archivado 5 días antes generó
   * un handoff inmediato — la clienta esperó a una persona para algo que el
   * backend ya sabía resolver solo. `afirmaConEspecialistaSinVerificar` y
   * `niegaDisponibilidadSinVerificar` nunca lo detectaban porque las dos
   * solo miraban `action.action === "reply"`.
   *
   * No detecta una frase sola — comprueba el HECHO: cero consultas en este
   * turno + (a) una respuesta de texto libre que AFIRMA (no pregunta)
   * nombrando a una especialista real, (b) que NIEGA disponibilidad de
   * forma categórica (nunca por una hora puntual: esa mitad se dejó fuera a
   * propósito, porque puede apoyarse con razón en lo que el propio agente
   * ofreció en el turno inmediato anterior —
   * docs/korexia/109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md), o (c) escala
   * con un motivo interno que depende de si ese especialista existe, atiende
   * cierto servicio, o tiene cupo. Deliberadamente estrecho en los tres
   * casos: un handoff porque el cliente lo pidió, por fuera de horario o por
   * una política del negocio nunca nombra a un especialista real como la
   * causa, así que nunca dispara esto — no bloquea handoffs legítimos.
   *
   * Si el reintento decide consultar de verdad, se resuelve reutilizando
   * `resolverBucleDeDisponibilidad` — la MISMA función que resuelve la
   * primera `consult_availability` de arriba, con su mismo tope y su misma
   * red de seguridad. Antes (hasta el 30-ago-2026) esto se resolvía con una
   * sola vuelta manual que no contemplaba que el modelo, tras recibir la
   * disponibilidad real, volviera a pedir `consult_availability` en vez de
   * responder: esa acción llegaba intacta hasta el switch final —sin `case`
   * para ella— y el turno terminaba en el `return null` genérico, dejando al
   * cliente sin ninguna respuesta. Ver docs/korexia, corrección de los dos
   * defectos bloqueantes de este guardarraíl.
   *
   * `nombresReales` sale de `listStaff(..., {includeArchived: true})`, NO de
   * `services`/`catalogoParaPrompt`: ese catálogo excluye a propósito a
   * quien ya no atiende (es lo correcto para ofrecer opciones), pero por eso
   * mismo es ciego al caso que originó este guardarraíl — un especialista
   * ARCHIVADO. "Laura" (real, archivada) debe reconocerse como un hecho
   * verificable; "Camila" (nunca existió) nunca debe convertirse en una
   * especialista real solo porque el modelo la nombró. `listStaff` es la
   * fuente correcta para esta pregunta distinta ("¿es alguien que el negocio
   * conoce?"), sin tocar lo que el cliente ve en el catálogo.
   */
  if (
    contrataCitas(vertical) &&
    (action.action === "reply" || action.action === "handoff") &&
    consultas === 0
  ) {
    const staffConocido = await listStaff(organizationId, { includeArchived: true });
    const nombresReales = [...new Set(staffConocido.map((s) => s.name))];
    const sinVerificar = (a: AgentActionType): boolean => {
      if (a.action === "reply") {
        return (
          afirmaConEspecialistaSinVerificar(a.text, nombresReales) ||
          niegaDisponibilidadSinVerificar(a.text)
        );
      }
      if (a.action === "handoff") {
        return handoffPorHechoDeEspecialistaSinVerificar(a.reason, nombresReales);
      }
      return false;
    };
    if (sinVerificar(action)) {
      console.warn(
        "[citas] afirmó, negó, o escaló por un hecho de especialista sin consultarlo; rehaciendo el turno"
      );
      const messagesReintento: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: result.raw },
        { role: "user", content: CORRECCION_DE_DISPONIBILIDAD_SIN_VERIFICAR },
      ];
      const reintento = await chatJson(AgentAction, messagesReintento);
      await registrarUsoIa(
        organizationId,
        reintento.usage,
        `conv:${conversationId}/disponibilidad-sin-verificar`
      );

      let accionCorregida: AgentActionType | null = null;
      let seVerificoDeVerdad = false;
      if (reintento.ok && reintento.data.action === "consult_availability") {
        seVerificoDeVerdad = true;
        const resultadoBucle = await resolverBucleDeDisponibilidad(
          messagesReintento,
          reintento.data,
          {
            organizationId,
            conversationId,
            conversation,
            services,
            hours,
            now: opts?.now,
            traza,
            sufijoDeUso: "-sin-verificar",
          }
        );
        // El propio bucle ya dejó el turno en un estado final (handoff
        // registrado, o null) si no logró resolverlo: nada más que decidir.
        if (!resultadoBucle.ok) return resultadoBucle.resultado;
        accionCorregida = resultadoBucle.action;
      } else if (reintento.ok) {
        accionCorregida = reintento.data;
      }

      const sigueSinVerificar =
        !seVerificoDeVerdad && accionCorregida !== null && sinVerificar(accionCorregida);

      if (accionCorregida !== null && !sigueSinVerificar) {
        action = accionCorregida;
        agregarGuardarrail(traza, "disponibilidad_sin_verificar", true);
      } else {
        console.error(
          "[citas] sigue afirmando, negando, o escalando sin verificar; lo toma una persona"
        );
        agregarGuardarrail(traza, "disponibilidad_sin_verificar", false);
        await derivarAUnaPersona(conversation);
        registrarHandoff(traza, "model_output_recovery_failed");
        traza.accionFinal = "handoff";
        registrarTrazaDelTurno(traza);
        return { action: "handoff", reason: "error" };
      }
    }
  }

  /**
   * `consultar_producto`: mismo patrón que `consult_availability`, para el
   * vertical de pedidos (docs/korexia/142). Nace del incidente de Lis
   * (25-ago-2026, "¿Tienen torta de chocolate?"): antes de esto, el modelo
   * decidía el hecho leyendo el catálogo en prosa; ahora se lo pide al
   * servidor y lo recibe verificado, en el mismo turno.
   */
  const MAX_CONSULTAS_PRODUCTO = 2;
  let consultasProducto = 0;
  while (
    action.action === "consultar_producto" &&
    consultasProducto < MAX_CONSULTAS_PRODUCTO
  ) {
    consultasProducto++;
    // Reutiliza el catálogo ya cargado arriba (una sola consulta a la base
    // de datos por turno, sin importar cuántas veces se llegue aquí).
    resultadoProducto = buscarProductos(productosDelPedido, action.consulta);
    // Mismo criterio que la verificación forzada de arriba: "no está entre
    // los productos" no es "no existe" — puede ser una salsa/opción.
    const resultadoOpcionAccion =
      resultadoProducto.status === "not_found"
        ? buscarOpciones(productosDelPedido, action.consulta)
        : null;
    console.warn(
      `[producto] ${organizationId}: consulta="${action.consulta}" status=${resultadoProducto.status}` +
        (resultadoOpcionAccion ? ` status_opcion=${resultadoOpcionAccion.status}` : "")
    );
    agregarHecho(traza, {
      tipo: "producto",
      consulta: action.consulta,
      resultado:
        resultadoOpcionAccion && resultadoOpcionAccion.status !== "not_found"
          ? `opcion_${resultadoOpcionAccion.status}`
          : resultadoProducto.status,
      origen: "backend",
    });
    const infoProducto = textoDeResultadoCatalogo(action.consulta, resultadoProducto, resultadoOpcionAccion);
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "user", content: infoProducto });
    const siguiente = await chatJson(AgentAction, messages, {
      jsonSchema: formatoDeRespuestaDeAccion(),
    });
    await registrarUsoIa(
      organizationId,
      siguiente.usage,
      `conv:${conversationId}/producto`
    );
    if (!siguiente.ok) {
      if (siguiente.error === "not_configured") return null;
      console.error(
        `[agente] fallo del proveedor tras consultar producto: ${siguiente.detail}`
      );
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "backend_error");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
    action = siguiente.data;
  }
  if (action.action === "consultar_producto") {
    // Se agotaron los intentos sin llegar a una acción final: mejor una
    // persona que una respuesta sin dato real detrás.
    await derivarAUnaPersona(conversation);
    registrarHandoff(traza, "model_output_recovery_failed");
    traza.accionFinal = "handoff";
    registrarTrazaDelTurno(traza);
    return { action: "handoff", reason: "error" };
  }

  /**
   * El sistema ya confirmó que el producto SÍ existe, en este mismo turno, y
   * la respuesta lo niega de todas formas. A diferencia del guardarraíl de
   * disponibilidad (que exige CERO consultas), este exige que SÍ hubo una
   * consulta real: es la otra mitad del mismo problema, cuando el modelo
   * ignora el hecho que él mismo pidió.
   */
  if (
    resultadoProducto?.status === "found" &&
    action.action === "reply" &&
    contradiceProductoEncontrado(action.text, resultadoProducto.producto.nombre)
  ) {
    console.warn("[producto] contradijo el hecho verificado; rehaciendo el turno");
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_PRODUCTO_CONTRADICHO },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/producto-contradicho`
    );
    if (
      reintento.ok &&
      !(
        reintento.data.action === "reply" &&
        contradiceProductoEncontrado(reintento.data.text, resultadoProducto.producto.nombre)
      )
    ) {
      action = reintento.data;
      agregarGuardarrail(traza, "producto_contradicho", true);
    } else {
      console.error(
        "[producto] sigue contradiciendo el hecho verificado; lo toma una persona"
      );
      agregarGuardarrail(traza, "producto_contradicho", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Fase 10S — mitad simétrica para `multiple_matches`: el sistema encontró
   * VARIOS candidatos igual de buenos y le pidió al modelo preguntar cuál;
   * si el modelo ignora esa instrucción y asume uno sin preguntar, nada lo
   * detectaba hasta ahora (a diferencia de `found`, este `status` no trae un
   * único `producto`, así que necesita su propio detector — ver
   * `asumeProductoAmbiguoSinPreguntar`).
   */
  if (
    resultadoProducto?.status === "multiple_matches" &&
    action.action === "reply" &&
    asumeProductoAmbiguoSinPreguntar(action.text, resultadoProducto.productos)
  ) {
    console.warn("[producto] asumió un candidato ambiguo sin preguntar; rehaciendo el turno");
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_PRODUCTO_AMBIGUO_SIN_PREGUNTAR },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/producto-ambiguo`
    );
    if (
      reintento.ok &&
      !(
        reintento.data.action === "reply" &&
        asumeProductoAmbiguoSinPreguntar(reintento.data.text, resultadoProducto.productos)
      )
    ) {
      action = reintento.data;
      agregarGuardarrail(traza, "producto_ambiguo_sin_preguntar", true);
    } else {
      console.error(
        "[producto] sigue asumiendo un candidato ambiguo sin preguntar; lo toma una persona"
      );
      agregarGuardarrail(traza, "producto_ambiguo_sin_preguntar", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * `consultar_medio_pago`: mismo principio, para el caso Nequi
   * (24-ago-2026, Lis). `pagoDePedidos` puede no existir (payment_source
   * distinto de 'ficha'); en ese caso `resolverMetodoDePago` recibe "" y
   * devuelve `unknown` para casi todo, que es el comportamiento seguro.
   */
  const MAX_CONSULTAS_PAGO = 2;
  let consultasPago = 0;
  while (
    action.action === "consultar_medio_pago" &&
    consultasPago < MAX_CONSULTAS_PAGO
  ) {
    consultasPago++;
    resultadoPago = resolverMetodoDePago(pagoDePedidos?.formas ?? "", action.metodo);
    console.warn(
      `[pago] ${organizationId}: metodo="${action.metodo}" status=${resultadoPago.status}` +
        (resultadoPago.status === "recognized" ? ` allowed=${resultadoPago.allowed}` : "")
    );
    agregarHecho(traza, {
      tipo: "medio_pago",
      consulta: action.metodo,
      resultado:
        resultadoPago.status === "recognized"
          ? `recognized:${resultadoPago.allowed ? "allowed" : "not_allowed"}`
          : resultadoPago.status,
      origen: "backend",
    });
    const infoPago = textoDeResultadoPago(action.metodo, resultadoPago);
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "user", content: infoPago });
    const siguiente = await chatJson(AgentAction, messages, {
      jsonSchema: formatoDeRespuestaDeAccion(),
    });
    await registrarUsoIa(
      organizationId,
      siguiente.usage,
      `conv:${conversationId}/pago`
    );
    if (!siguiente.ok) {
      if (siguiente.error === "not_configured") return null;
      console.error(
        `[agente] fallo del proveedor tras consultar medio de pago: ${siguiente.detail}`
      );
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "backend_error");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
    action = siguiente.data;
  }
  if (action.action === "consultar_medio_pago") {
    await derivarAUnaPersona(conversation);
    registrarHandoff(traza, "model_output_recovery_failed");
    traza.accionFinal = "handoff";
    registrarTrazaDelTurno(traza);
    return { action: "handoff", reason: "error" };
  }

  /** Mismo criterio que el guardarraíl de producto, para el método de pago. */
  if (
    resultadoPago?.status === "recognized" &&
    resultadoPago.allowed &&
    action.action === "reply" &&
    niegaMetodoDePagoPermitido(action.text, resultadoPago.method)
  ) {
    console.warn("[pago] contradijo el método permitido; rehaciendo el turno");
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_PAGO_CONTRADICHO },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/pago-contradicho`
    );
    if (
      reintento.ok &&
      !(
        reintento.data.action === "reply" &&
        niegaMetodoDePagoPermitido(reintento.data.text, resultadoPago.method)
      )
    ) {
      action = reintento.data;
      agregarGuardarrail(traza, "pago_contradicho", true);
    } else {
      console.error(
        "[pago] sigue contradiciendo el método permitido; lo toma una persona"
      );
      agregarGuardarrail(traza, "pago_contradicho", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * `consultar_domicilio`: mismo principio, para la tarifa de domicilio
   * (Fase 10N-J, incidente real de Kachipay: "$12.000" al preguntar,
   * "$8.000" en el resumen del mismo pedido). `zonasDeEntrega` solo existe
   * con `delivery_source='tabla'`; sin eso `resolverZonaDeEntrega` recibe
   * una lista vacía y devuelve `not_found` para cualquier consulta, que es
   * el comportamiento seguro (nunca inventa una tarifa).
   */
  const MAX_CONSULTAS_DOMICILIO = 2;
  let consultasDomicilio = 0;
  /**
   * Lo que YA se consultó en este turno, para no contestar dos veces lo
   * mismo. Si el modelo repite una consulta es porque el `[SISTEMA]` que
   * recibió no lo sacó de donde estaba; repetírselo idéntico tampoco lo va
   * a sacar (MALIA, 14-sep-2026: registró la misma recogida dos veces y
   * agotó el turno). La segunda vez recibe una corrección, no un eco.
   */
  const consultasDeDomicilioHechas = new Set<string>();
  while (
    action.action === "consultar_domicilio" &&
    consultasDomicilio < MAX_CONSULTAS_DOMICILIO
  ) {
    consultasDomicilio++;
    const claveDeLaConsulta =
      action.recogida === true
        ? "recogida"
        : `zona:${(action.zona ?? "").trim().toLowerCase()}`;
    const esRepetida = consultasDeDomicilioHechas.has(claveDeLaConsulta);
    consultasDeDomicilioHechas.add(claveDeLaConsulta);
    /**
     * Fase 10V-X — cada consulta de este turno REEMPLAZA por completo lo
     * que hubiera persistido antes: es la transición explícita que exige
     * un cambio de zona (zona anterior invalidada, nueva zona pendiente
     * hasta que se resuelva) — nunca queda una tarifa vieja como válida
     * por omisión. `recogida:true` hace lo mismo para "el cliente ya no
     * quiere domicilio", sin pasar por el buscador de zonas.
     */
    let infoZona: string;
    let nuevaEntrega: EntregaVerificada;
    if (action.recogida === true) {
      resultadoZona = null;
      console.warn(`[domicilio] ${organizationId}: cliente registrado como recogida (sin domicilio)`);
      agregarHecho(traza, {
        tipo: "domicilio",
        consulta: "recogida",
        resultado: "recogida",
        origen: "backend",
      });
      infoZona = textoDeResultadoRecogida();
      nuevaEntrega = {
        tipo: "recogida",
        zonaId: null,
        zonaNombre: null,
        feeCents: null,
        verificadoEnMensajeId: pendientes.at(-1)?.id ?? null,
        verificadoEn: new Date().toISOString(),
      };
    } else {
      resultadoZona = resolverZonaDeEntrega(zonasDeEntrega, action.zona);
      console.warn(
        `[domicilio] ${organizationId}: zona="${action.zona}" status=${resultadoZona.status}`
      );
      agregarHecho(traza, {
        tipo: "domicilio",
        consulta: action.zona,
        resultado: resultadoZona.status,
        origen: "backend",
      });
      infoZona = textoDeResultadoDomicilio(action.zona, resultadoZona);
      nuevaEntrega = {
        tipo: "domicilio",
        zonaId: resultadoZona.status === "found" ? resultadoZona.zona.id : null,
        zonaNombre: resultadoZona.status === "found" ? resultadoZona.zona.nombre : null,
        feeCents: resultadoZona.status === "found" ? resultadoZona.zona.feeCents : null,
        verificadoEnMensajeId: pendientes.at(-1)?.id ?? null,
        verificadoEn: new Date().toISOString(),
      };
    }
    if (domicilioEstructurado) {
      const guardado = await guardarEntregaVerificada({
        conversationId: conversation.id,
        organizationId,
        entrega: nuevaEntrega,
        actor: "pipeline",
        proceso: "consultar_domicilio",
      });
      if (guardado.ok) {
        entregaPersistida = nuevaEntrega;
        // Mantiene sincronizada la versión que usará el guardado de la
        // Fase 2 al final del turno (`guardarEstadoPropuesto`, más abajo):
        // sin esto, esta escritura de en medio del turno dejaría esa
        // versión desactualizada y esa escritura posterior perdería su
        // propia carrera contra sí misma. Combinación sin clientes reales
        // hoy (ver el comentario de `domicilioEstructurado`), pero
        // correcta si algún día coinciden `state_source='backend'` y
        // `delivery_source='tabla'`.
        if (estadoEstructurado) {
          estadoGuardado = { ...(estadoGuardado ?? estadoVacio()), entrega: nuevaEntrega };
          if (versionDeEstadoLeido !== undefined) versionDeEstadoLeido += 1;
        }
      } else {
        console.warn(
          `[domicilio] ${organizationId}: no se pudo persistir la verificación de domicilio (carrera perdida); sigue vigente solo este turno`
        );
      }
    }
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    // Repetir el mismo hecho no lo saca del bucle: la segunda vez va la
    // corrección, que sí es información nueva.
    messages.push({
      role: "user",
      content: esRepetida ? CORRECCION_DE_DOMICILIO_YA_CONSULTADO : infoZona,
    });
    if (esRepetida) {
      console.warn(
        `[domicilio] ${organizationId}: el modelo repitió la consulta "${claveDeLaConsulta}" en el mismo turno; se le corrige en vez de repetirle el dato`
      );
    }
    const siguiente = await chatJson(AgentAction, messages, {
      jsonSchema: formatoDeRespuestaDeAccion(),
    });
    await registrarUsoIa(
      organizationId,
      siguiente.usage,
      `conv:${conversationId}/domicilio`
    );
    if (!siguiente.ok) {
      if (siguiente.error === "not_configured") return null;
      console.error(
        `[agente] fallo del proveedor tras consultar domicilio: ${siguiente.detail}`
      );
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "backend_error");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
    action = siguiente.data;
  }
  /**
   * Se acabaron las consultas y el modelo pide otra.
   *
   * Hasta el 14-sep-2026 esto derivaba de una, y era el ÚNICO camino del
   * pipeline que abandonaba al cliente sin intentar rescatarlo: todos los
   * guardarraíles reintentan con una corrección antes de rendirse. Costó una
   * clienta de MALIA que solo había dicho "para pedirte uno y paso a
   * recogerlo" — la recogida ya estaba registrada, no faltaba ningún dato, y
   * aun así se quedó cuatro minutos esperando para que le dijeran que la
   * atendería una persona.
   */
  if (action.action === "consultar_domicilio") {
    console.warn(
      `[domicilio] ${organizationId}: consultas agotadas y el modelo pide otra; se le corrige antes de derivar`
    );
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "user", content: CORRECCION_DE_DOMICILIO_AGOTADO });
    const rescate = await chatJson(AgentAction, messages, {
      jsonSchema: formatoDeRespuestaDeAccion(),
    });
    await registrarUsoIa(
      organizationId,
      rescate.usage,
      `conv:${conversationId}/domicilio-agotado`
    );
    if (rescate.ok && rescate.data.action !== "consultar_domicilio") {
      action = rescate.data;
      agregarGuardarrail(traza, "domicilio_en_bucle", true);
    } else {
      console.error(
        `[domicilio] ${organizationId}: sigue pidiendo consultar domicilio tras la corrección; lo toma una persona`
      );
      agregarGuardarrail(traza, "domicilio_en_bucle", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Mismo criterio que el guardarraíl de producto, para la tarifa de
   * domicilio.
   *
   * Las cifras que el texto puede mencionar legítimamente son TRES, no una:
   * la tarifa verificada, el subtotal que el backend ya calculó sobre los
   * ítems, y el total que el modelo declara en `reply`. Pasarlas todas es lo
   * que evita el falso positivo del 13-sep-2026 —responder "$26.000 con
   * domicilio a Ciudad 2000" no es inventarse una tarifa— sin dejar de
   * atrapar una cifra que no corresponda a nada verificado.
   */
  const cifrasLegitimasDelTurno =
    action.action === "reply"
      ? [action.totalCents, estadoGuardado?.totalCents]
      : [estadoGuardado?.totalCents];
  if (
    resultadoZona?.status === "found" &&
    action.action === "reply" &&
    dijoOtroValorDeDomicilio(
      action.text,
      resultadoZona.zona.feeCents,
      cifrasLegitimasDelTurno
    )
  ) {
    console.warn("[domicilio] contradijo la tarifa verificada; rehaciendo el turno");
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_DOMICILIO_CONTRADICHO },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/domicilio-contradicho`
    );
    if (
      reintento.ok &&
      !(
        reintento.data.action === "reply" &&
        dijoOtroValorDeDomicilio(
          reintento.data.text,
          resultadoZona.zona.feeCents,
          // Las del REINTENTO: el modelo pudo declarar otro total al rehacer.
          [reintento.data.totalCents, estadoGuardado?.totalCents]
        )
      )
    ) {
      action = reintento.data;
      agregarGuardarrail(traza, "domicilio_contradicho", true);
    } else {
      console.error(
        "[domicilio] sigue contradiciendo la tarifa verificada; lo toma una persona"
      );
      agregarGuardarrail(traza, "domicilio_contradicho", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Consistencia financiera del cierre (Fase 10N-J): si el modelo aporta
   * los campos estructurados de `notify_order` (`subtotalCents`/
   * `deliveryFeeCents`/`totalCents`), se verifican ANTES de aceptar la
   * acción — nunca se calcula el total leyendo el `summary` en prosa. Es
   * la corrección directa del incidente de Kachipay: `deliveryFeeCents`
   * debe ser exactamente la tarifa que `consultar_domicilio` verificó EN
   * ESTE TURNO, o la última verificación persistida de un turno anterior
   * de esta misma conversación (Fase 10V-X — `entregaPersistida`, ver
   * `EntregaVerificada` en `orders/estado.ts`), y `totalCents` debe cuadrar
   * aritméticamente.
   */
  if (action.action === "notify_order") {
    /**
     * Los totales que una PERSONA del negocio escribio en este chat. El equipo
     * cotiza a mano constantemente -101 mensajes suyos contra 273 del bot en
     * seis horas, medido el 8-sep- y cuando lo hacen no pasan por la tabla de
     * zonas. Sin esto, el candado de domicilio bloquea un total que no invento
     * el modelo: paso dos veces en dos dias, la segunda con el cliente ya
     * pagado (ver `anuncio-de-cierre.ts`).
     */
    const totalesDichosPorUnaPersona = history
      .filter((m) => m.direction === "out" && m.aiGenerated === false)
      .flatMap((m) => cifrasEnPesosDelTexto(m.text));

    /**
     * Las cifras del cierre, escritas por el BACKEND con lo que ya verificó
     * (subtotal contra el catálogo, domicilio contra `delivery_zone`).
     *
     * Cuando existe, es lo que el cliente va a leer, y los cuatro chequeos
     * que releían la prosa del modelo se apagan: no puede haber contradicción
     * entre dos textos cuando solo hay uno. Ver `bloqueDeCifrasVerificadas`
     * para los cuatro incidentes que esto cierra de raíz.
     *
     * `null` = el backend no tuvo certeza completa (sin subtotal, o domicilio
     * sin verificar). Entonces no se adjunta nada y todo sigue como antes,
     * chequeos de texto incluidos.
     */
    const cifrasDelBackend = bloqueDeCifrasVerificadas({
      subtotalCents: estadoGuardado?.totalCents,
      entrega: entregaPersistida,
    });

    const fallo = inconsistenciaFinancieraDePedido({
      cifrasLasEscribeElBackend: cifrasDelBackend !== null,
      summary: action.summary,
      totalesDichosPorUnaPersona,
      // Fase 8D — lo que de verdad lee el CLIENTE, no solo el equipo.
      farewell: action.farewell,
      subtotalCents: action.subtotalCents,
      deliveryFeeCents: action.deliveryFeeCents,
      totalCents: action.totalCents,
      zonaVerificada: resultadoZona?.status === "found" ? resultadoZona.zona : null,
      entregaPersistida,
      // La modalidad ya resuelta por el backend: distingue "es a domicilio y
      // no lo cobró" de "preguntó la tarifa y al final pasó a recoger".
      modalidadDeEntrega: estadoGuardado?.modalidadDeEntrega,
      puedeVerificarDomicilio: zonasDeEntrega.length > 0,
      // Fase 11-C — el subtotal REAL, ya calculado por el backend contra
      // el catálogo (nunca `null`: eso significaría un ítem sin resolver,
      // y entonces no hay ningún subtotal real que exigir todavía).
      subtotalReal: estadoGuardado?.totalCents ?? undefined,
    });
    if (fallo) {
      console.warn(`[pedido] inconsistencia financiera (${fallo}); rehaciendo el turno`);
      let reintento = await chatJson(AgentAction, [
        ...messages,
        { role: "assistant", content: result.raw },
        { role: "user", content: correccionDeInconsistenciaFinanciera(fallo) },
      ]);
      await registrarUsoIa(
        organizationId,
        reintento.usage,
        `conv:${conversationId}/inconsistencia-financiera`
      );

      /**
       * El modelo hace EXACTAMENTE lo que le pedimos —verificar el domicilio
       * antes de cerrar— y hasta el 14-sep-2026 lo castigábamos por ello: el
       * cálculo de `reintentoFallo` de más abajo da por fallida cualquier
       * respuesta que no sea `notify_order`, así que una consulta legítima
       * terminaba en handoff igual que una cifra inventada.
       *
       * Aquí se le resuelve la zona y se le pide cerrar otra vez, ya con la
       * tarifa real. Es la salida de los 4 de 8 handoffs de MALIA del
       * 14-sep, y del pedido de $48.000 de Brenda: la zona existía en la
       * tabla, solo que nadie la había consultado.
       */
      if (
        fallo === "domicilio-nunca-verificado" &&
        reintento.ok &&
        reintento.data.action === "consultar_domicilio"
      ) {
        const pedido = reintento.data;
        let infoZona: string;
        let nuevaEntrega: EntregaVerificada;
        if (pedido.recogida === true) {
          resultadoZona = null;
          infoZona = textoDeResultadoRecogida();
          nuevaEntrega = {
            tipo: "recogida",
            zonaId: null,
            zonaNombre: null,
            feeCents: null,
            verificadoEnMensajeId: pendientes.at(-1)?.id ?? null,
            verificadoEn: new Date().toISOString(),
          };
        } else {
          resultadoZona = resolverZonaDeEntrega(zonasDeEntrega, pedido.zona);
          infoZona = textoDeResultadoDomicilio(pedido.zona, resultadoZona);
          nuevaEntrega = {
            tipo: "domicilio",
            zonaId: resultadoZona.status === "found" ? resultadoZona.zona.id : null,
            zonaNombre: resultadoZona.status === "found" ? resultadoZona.zona.nombre : null,
            feeCents: resultadoZona.status === "found" ? resultadoZona.zona.feeCents : null,
            verificadoEnMensajeId: pendientes.at(-1)?.id ?? null,
            verificadoEn: new Date().toISOString(),
          };
        }
        console.warn(
          `[pedido] ${organizationId}: el modelo verificó el domicilio al corregir (zona="${
            pedido.recogida === true ? "recogida" : pedido.zona
          }" status=${resultadoZona?.status ?? "recogida"}); se le deja cerrar con la tarifa real`
        );
        agregarHecho(traza, {
          tipo: "domicilio",
          consulta: pedido.recogida === true ? "recogida" : pedido.zona,
          resultado: pedido.recogida === true ? "recogida" : resultadoZona!.status,
          origen: "backend",
        });
        if (domicilioEstructurado) {
          const guardado = await guardarEntregaVerificada({
            conversationId: conversation.id,
            organizationId,
            entrega: nuevaEntrega,
            actor: "pipeline",
            proceso: "consultar_domicilio",
          });
          if (guardado.ok) entregaPersistida = nuevaEntrega;
        }
        reintento = await chatJson(AgentAction, [
          ...messages,
          { role: "assistant", content: JSON.stringify(pedido) },
          { role: "user", content: infoZona },
        ]);
        await registrarUsoIa(
          organizationId,
          reintento.usage,
          `conv:${conversationId}/cierre-tras-verificar`
        );
      }
      const reintentoFallo =
        reintento.ok && reintento.data.action === "notify_order"
          ? inconsistenciaFinancieraDePedido({
              cifrasLasEscribeElBackend: cifrasDelBackend !== null,
              summary: reintento.data.summary,
              farewell: reintento.data.farewell,
              subtotalCents: reintento.data.subtotalCents,
              deliveryFeeCents: reintento.data.deliveryFeeCents,
              totalCents: reintento.data.totalCents,
              zonaVerificada: resultadoZona?.status === "found" ? resultadoZona.zona : null,
              entregaPersistida,
              modalidadDeEntrega: estadoGuardado?.modalidadDeEntrega,
              puedeVerificarDomicilio: zonasDeEntrega.length > 0,
              subtotalReal: estadoGuardado?.totalCents ?? undefined,
              totalesDichosPorUnaPersona,
            })
          : "total-no-cuadra";
      if (reintento.ok && reintento.data.action === "notify_order" && !reintentoFallo) {
        action = reintento.data;
        agregarGuardarrail(traza, "inconsistencia_financiera", true);
      } else {
        console.error(
          `[pedido] sigue inconsistente (${fallo}) tras la corrección; lo toma una persona`
        );
        agregarGuardarrail(traza, "inconsistencia_financiera", false);
        await derivarAUnaPersona(conversation, {
          reason: "modelo",
          teamSummary:
            "El asistente intentó cerrar un pedido con el domicilio o el total inconsistentes (no coincide con la tarifa verificada, o la suma no cuadra). Revisa la conversación antes de confirmar nada con el cliente.",
        });
        registrarHandoff(traza, "model_output_recovery_failed");
        traza.accionFinal = "handoff";
        registrarTrazaDelTurno(traza);
        return { action: "handoff", reason: "error" };
      }
    }

    /**
     * El cierre sale con LAS CIFRAS DEL BACKEND adjuntas — al equipo en el
     * `summary` y al cliente en el `farewell`.
     *
     * Este es el punto en el que la clase entera de incidentes de la semana
     * del 8 al 15-sep deja de ser posible: el número que lee el cliente ya
     * no lo escribe el modelo, lo escribe quien lo calculó. Todo lo demás
     * del texto (el saludo, el tono, el detalle de los ítems) sigue siendo
     * del modelo, que es lo que sabe hacer bien.
     *
     * Se adjunta DESPUÉS de las validaciones, nunca antes: si el cierre no
     * pasó los chequeos numéricos, no llega hasta aquí.
     */
    if (cifrasDelBackend && action.action === "notify_order") {
      action = {
        ...action,
        summary: `${action.summary}\n\n${cifrasDelBackend}`,
        farewell: action.farewell
          ? `${action.farewell}\n\n${cifrasDelBackend}`
          : action.farewell,
      };
    }
  }

  /**
   * Guardarraíl de "pedido ya confirmado" (incidente real, 5-sep-2026, Caso
   * B): un mensaje del cliente DESPUÉS de un cierre exitoso podía reabrir la
   * confirmación. `EstadoDelPedido`/`conversation_state.confirmado` no basta
   * como fuente de verdad aquí — lo que importa es si YA existe una fila en
   * `order_confirmation` para esta conversación, con un `idempotencyKey`
   * DISTINTO: el `UNIQUE` de Postgres no lo detecta, y si el modelo decide
   * reabrir la confirmación —visto en producción tras el relevo automático
   * de `handoff-policy.ts` (`HANDOFF_RESUME_HOURS`), que 2 horas después de
   * cerrar el pedido reintroduce TODO el historial al agente sin que nadie
   * lo pida— nada lo frenaba: doble aviso al equipo, doble "pedido
   * confirmado" en el CRM.
   *
   * El backend, no el modelo, decide si esto es el MISMO pedido o uno
   * genuinamente nuevo: si esta conversación ya tiene una confirmación
   * previa, `notify_order` solo procede cuando ALGÚN mensaje del cliente
   * DESPUÉS de esa confirmación nombra un producto real del catálogo
   * —verificado con `buscarProductos`, el mismo matcher ya probado que usa
   * `consultar_producto`, nunca comparando el `summary` en texto libre del
   * modelo—. Sin eso, lo que se pide confirmar es, con altísima
   * probabilidad, el pedido que ya se cerró: se rechaza sin ejecutar NINGÚN
   * efecto (nada de `notifyTeam`, ninguna fila nueva en `order_confirmation`)
   * y se le da al modelo una oportunidad de responder lo que el cliente
   * realmente dijo. Un pedido genuinamente nuevo (el cliente vuelve a
   * nombrar algo del catálogo) queda libre de inmediato — esto nunca
   * bloquea la conversación, solo el cierre repetido de UN pedido ya
   * cerrado.
   *
   * Acotado a `productosDelPedido.length > 0` (catálogo en tabla): sin un
   * catálogo real contra qué verificar, no hay forma de reconocer "pedido
   * nuevo" sin caer otra vez en comparar texto libre — hoy cubre a los tres
   * negocios reales que toman pedidos (los tres tienen `catalog_source =
   * 'tabla'`); el caso sin catálogo estructurado queda documentado como
   * hallazgo, no resuelto aquí (fuera del alcance de este incidente).
   */
  if (action.action === "notify_order") {
    // Fase 1 — la DECISIÓN vive en `orders/policy.ts`; reaccionar (reintentar
    // con el modelo, derivar, anotar la traza) sigue siendo del pipeline.
    const veredicto = await puedeConfirmarPedido({
      conversationId,
      productosDelPedido,
      history,
    });
    if (!veredicto.ok) {
      console.warn(
        `[pedido] notify_order rechazado por el backend en ${conversationId}: ${veredicto.motivo}`
      );
      const reintento = await chatJson(AgentAction, [
        ...messages,
        { role: "assistant", content: result.raw },
        { role: "user", content: veredicto.correccion },
      ]);
      await registrarUsoIa(
        organizationId,
        reintento.usage,
        `conv:${conversationId}/pedido-ya-confirmado`
      );
      if (reintento.ok && reintento.data.action !== "notify_order") {
        action = reintento.data;
        agregarGuardarrail(traza, "pedido_ya_confirmado", true);
      } else {
        console.error(
          `[pedido] insiste en confirmar un pedido ya cerrado en ${conversationId}; lo toma una persona`
        );
        agregarGuardarrail(traza, "pedido_ya_confirmado", false);
        await derivarAUnaPersona(conversation, {
          reason: "modelo",
          teamSummary:
            "El asistente intentó volver a confirmar un pedido que ya estaba cerrado y notificado. Revisa la conversación: puede ser un pedido nuevo mal interpretado, o el bot reabriendo el anterior por error.",
        });
        registrarHandoff(traza, "model_output_recovery_failed");
        traza.accionFinal = "handoff";
        registrarTrazaDelTurno(traza);
        return { action: "handoff", reason: "error" };
      }
    }
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
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      // "user", no "system": verificado en vivo (1-ago-2026) que
      // google/gemini-2.5-flash vía OpenRouter devuelve `content: null` cuando
      // el ÚLTIMO mensaje del array es de rol "system" sin ningún turno de
      // usuario después. Mismo arreglo que en el loop de consult_availability.
      { role: "user", content: CORRECCION_DE_CIERRE_FALSO },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/cierre-falso`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-cierre-falso",
    });
    if (!resuelto.ok) return resuelto.resultado;
    if (!textosAlCliente(resuelto.accion).some(anunciaCierre)) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "cierre_falso", true);
    } else {
      console.error(
        "[agente] el cierre falso persiste tras la corrección; lo toma una persona"
      );
      agregarGuardarrail(traza, "cierre_falso", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
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
    contrataCitas(vertical) &&
    !ACCIONES_QUE_AGENDAN.includes(action.action) &&
    textosAlCliente(action).some(anunciaCitaAgendada)
  ) {
    console.warn("[agente] confirmó una cita sin agendarla; rehaciendo el turno");
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_CITA_FANTASMA },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/cita-fantasma`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-cita-fantasma",
    });
    if (
      resuelto.ok &&
      (ACCIONES_QUE_AGENDAN.includes(resuelto.accion.action) ||
        !textosAlCliente(resuelto.accion).some(anunciaCitaAgendada))
    ) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "cita_fantasma", true);
    } else if (!resuelto.ok) {
      return resuelto.resultado;
    } else {
      console.error(
        "[agente] sigue confirmando una cita inexistente; lo toma una persona"
      );
      agregarGuardarrail(traza, "cita_fantasma", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Prometió un catálogo, una foto o un documento y no ejecutó `send_image`
   * (18-ago-2026): el cliente lee "te comparto el catálogo" y no recibe nada.
   *
   * Mismo tratamiento que el cierre falso y la cita fantasma: una oportunidad
   * de rehacerlo con la corrección delante y, si insiste, lo atiende una
   * persona — igual que ellos, y a diferencia de "producto olvidado", porque
   * aquí el cliente se queda esperando algo que nunca llega, no un detalle
   * recuperable en el resumen.
   *
   * Medido en producción el mismo día: no fue un caso aislado de una
   * conversación de pruebas — pasó también con una clienta con una cita real
   * agendada, en un negocio distinto. Detalle en `anuncio-de-cierre.ts`.
   */
  if (action.action !== "send_image" && textosAlCliente(action).some(prometeRecurso)) {
    console.warn("[agente] prometió un recurso sin enviarlo; rehaciendo el turno");
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_RECURSO_PROMETIDO },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/recurso-prometido`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-recurso-prometido",
    });
    if (
      resuelto.ok &&
      (resuelto.accion.action === "send_image" ||
        !textosAlCliente(resuelto.accion).some(prometeRecurso))
    ) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "recurso_prometido", true);
    } else if (!resuelto.ok) {
      return resuelto.resultado;
    } else {
      console.error(
        "[agente] sigue prometiendo un recurso sin enviarlo; lo toma una persona"
      );
      agregarGuardarrail(traza, "recurso_prometido", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Fase 10T — "handoff fantasma": promete un humano (ver
   * anuncio-de-cierre.ts) y la acción emitida no es `handoff`. Mismo
   * tratamiento que el recurso prometido: una oportunidad de rehacerlo con
   * la corrección delante y, si insiste, se deriva de verdad — es la única
   * forma de cumplir lo que el cliente ya leyó.
   */
  if (action.action !== "handoff" && textosAlCliente(action).some(prometeHumanoSinDerivar)) {
    console.warn("[agente] prometió un humano sin derivar; rehaciendo el turno");
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_HUMANO_PROMETIDO },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/humano-prometido`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-humano-prometido",
    });
    if (
      resuelto.ok &&
      (resuelto.accion.action === "handoff" ||
        !textosAlCliente(resuelto.accion).some(prometeHumanoSinDerivar))
    ) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "humano_prometido", true);
    } else if (!resuelto.ok) {
      return resuelto.resultado;
    } else {
      console.error(
        "[agente] sigue prometiendo un humano sin derivar; se deriva de verdad"
      );
      agregarGuardarrail(traza, "humano_prometido", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Confirma un pago que nadie verificó (24-ago-2026, ver
   * anuncio-de-cierre.ts). Mismo tratamiento que el cierre falso, la cita
   * fantasma y el recurso prometido: una oportunidad de rehacerlo con la
   * corrección delante y, si insiste, lo atiende una persona — un pago que
   * no existe pasando por confirmado es dinero real en juego, no un detalle
   * recuperable en el resumen.
   */
  if (textosAlCliente(action).some(confirmaPagoSinVerificar)) {
    console.warn("[agente] confirmó un pago sin verificarlo; rehaciendo el turno");
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_PAGO_SIN_VERIFICAR },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/pago-sin-verificar`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-pago-sin-verificar",
    });
    if (
      resuelto.ok &&
      !textosAlCliente(resuelto.accion).some(confirmaPagoSinVerificar)
    ) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "pago_sin_verificar", true);
    } else if (!resuelto.ok) {
      return resuelto.resultado;
    } else {
      console.error(
        "[agente] sigue confirmando un pago sin verificarlo; lo toma una persona"
      );
      agregarGuardarrail(traza, "pago_sin_verificar", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Fase 8C (auditoría de Fase 8B) — fidelidad de los datos de cuenta que el
   * modelo cita, contra `ficha.pago.datosDeCuenta` real. `fichaDelNegocio`
   * se lee siempre (línea ~1049), sin depender de `paymentSource`, así que
   * esto protege tanto `payment_source='ficha'` como el `'prompt'` por
   * defecto — en ambos casos el dato real es el mismo. Mismo tratamiento que
   * el resto de la familia: una oportunidad de rehacerlo con la corrección
   * delante y, si insiste, lo atiende una persona.
   */
  const datosDeCuentaReales = fichaDelNegocio
    ? (fichaDelNegocio as FichaDelNegocio).pago?.datosDeCuenta
    : undefined;
  if (
    datosDeCuentaReales &&
    textosAlCliente(action).some((t) => contradiceDatosDeCuenta(t, datosDeCuentaReales))
  ) {
    console.warn("[pago] citó datos de cuenta que no coinciden con los reales; rehaciendo el turno");
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_DATOS_DE_CUENTA },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/datos-de-cuenta-contradichos`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-datos-de-cuenta-contradichos",
    });
    if (
      resuelto.ok &&
      !textosAlCliente(resuelto.accion).some((t) => contradiceDatosDeCuenta(t, datosDeCuentaReales))
    ) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "datos_de_cuenta_contradichos", true);
    } else if (!resuelto.ok) {
      return resuelto.resultado;
    } else {
      console.error(
        "[pago] sigue citando datos de cuenta que no coinciden con los reales; lo toma una persona"
      );
      agregarGuardarrail(traza, "datos_de_cuenta_contradichos", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * `provide_requirement` y `update_lead` traen `reply` OPCIONAL en el
   * esquema —"para seguir la conversación en el mismo turno"— pero el
   * ejecutor solo manda algo `if (action.reply)`: si el modelo la omite, el
   * turno termina sin una sola palabra al cliente. Sin error, sin handoff,
   * sin fila de mensaje: silencio total.
   *
   * **Caso real (Lis Pastelería, 24-ago-2026, 17:07 Colombia)**: la clienta
   * dio nombre, teléfono y dirección para su domicilio. El modelo emitió
   * `provide_requirement` (requisitoId "direccion") SIN `reply`. El estado
   * se guardó (`conversation_state.datos.direccion`), pero como este negocio
   * no tiene destino de captura para "direccion" en `CAMPO_DE_REQUISITO`
   * (deuda ya documentada, docs/korexia/103), `capturar()` además falló — y
   * ninguna de las dos cosas importó para el cliente: no llegó nada. Quedó
   * esperando 4 minutos hasta que la dueña, viendo el chat sin responder,
   * contestó a mano.
   *
   * Ningún guardarraíl de texto lo detecta: `textosAlCliente(action)` ya
   * devuelve `[]` cuando no hay `reply`, así que los detectores que revisan
   * TEXTO no tienen nada que mirar. Este es estructural, no de texto: la
   * condición es la AUSENCIA de cualquier mensaje al cliente en una acción
   * que no cierra la conversación por otra vía (a diferencia de `handoff`,
   * que sí puede quedarse callado a propósito mientras espera a una
   * persona).
   */
  const ACCIONES_QUE_SIGUEN_LA_CONVERSACION = ["provide_requirement", "update_lead"];
  if (
    ACCIONES_QUE_SIGUEN_LA_CONVERSACION.includes(action.action) &&
    textosAlCliente(action).length === 0
  ) {
    console.warn(`[agente] "${action.action}" sin reply; el cliente se quedaría sin respuesta, rehaciendo el turno`);
    const messagesReintento: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_TURNO_MUDO },
    ];
    const reintento = await chatJson(AgentAction, messagesReintento);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/turno-mudo`
    );
    const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
      organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
      sufijoDeUso: "-turno-mudo",
    });
    if (
      resuelto.ok &&
      (!ACCIONES_QUE_SIGUEN_LA_CONVERSACION.includes(resuelto.accion.action) ||
        textosAlCliente(resuelto.accion).length > 0)
    ) {
      action = resuelto.accion;
      agregarGuardarrail(traza, "turno_mudo", true);
    } else if (!resuelto.ok) {
      return resuelto.resultado;
    } else {
      console.error(
        `[agente] "${action.action}" sigue sin reply; lo toma una persona`
      );
      agregarGuardarrail(traza, "turno_mudo", false);
      await derivarAUnaPersona(conversation);
      registrarHandoff(traza, "model_output_recovery_failed");
      traza.accionFinal = "handoff";
      registrarTrazaDelTurno(traza);
      return { action: "handoff", reason: "error" };
    }
  }

  /**
   * Requisito declarado por el negocio, sin cumplir, y la acción ya está
   * cerrando (19-ago-2026, docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md).
   *
   * Corre en LOS DOS verticales con el mismo código: `book_appointment` y
   * `notify_order` comparten el mismo hueco (ninguno exige nada declarado
   * cuando `stateSource='prompt'`, que es toda la flota real hoy).
   *
   * Mismo tratamiento que el cierre falso y la cita fantasma: una
   * oportunidad de rehacerlo con la corrección delante y, si insiste, lo
   * atiende una persona — el equipo necesita este dato para identificar a
   * la clienta, no es un detalle recuperable después.
   */
  const ACCIONES_DE_CIERRE = ["book_appointment", "notify_order"];
  if (requisitos?.length && ACCIONES_DE_CIERRE.includes(action.action)) {
    const faltan = await requisitosFaltantes({
      organizationId,
      contactId: conversation.contactId,
      requisitos,
    });
    if (faltan.length > 0) {
      console.warn(
        `[requisitos] faltan antes de cerrar (${faltan.map((r) => r.id).join(", ")}); rehaciendo el turno`
      );
      const messagesReintento: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: result.raw },
        { role: "user", content: correccionDeRequisitoFaltante(faltan) },
      ];
      const reintento = await chatJson(AgentAction, messagesReintento);
      await registrarUsoIa(
        organizationId,
        reintento.usage,
        `conv:${conversationId}/requisito-faltante`
      );
      const resuelto = await resolverAccionTrasReintento(messagesReintento, reintento, {
        organizationId, conversationId, conversation, services, hours, now: opts?.now, traza,
        sufijoDeUso: "-requisito-faltante",
      });
      if (resuelto.ok && !ACCIONES_DE_CIERRE.includes(resuelto.accion.action)) {
        action = resuelto.accion;
        agregarGuardarrail(traza, "requisito_faltante", true);
      } else if (!resuelto.ok) {
        return resuelto.resultado;
      } else {
        console.error(
          "[requisitos] sigue cerrando sin los datos declarados; lo toma una persona"
        );
        agregarGuardarrail(traza, "requisito_faltante", false);
        await derivarAUnaPersona(conversation);
        registrarHandoff(traza, "missing_required_information");
        traza.accionFinal = "handoff";
        registrarTrazaDelTurno(traza);
        return { action: "handoff", reason: "error" };
      }
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
    /*
     * Incidente real (6-sep-2026): esto comprobaba el FORMATO del texto
     * (`TIENE_TOTAL`) y no el HECHO. El resumen de Lis dice "TOTAL SIN
     * DOMICILIO: $19.000" —formato que el propio negocio pidió en su
     * prompt— así que la comprobación fallaba, se bloqueaba un cierre
     * legítimo y el bot repetía el resumen en bucle mientras la clienta ya
     * había confirmado. Ahora se pregunta primero por el total que el
     * BACKEND calculó contra el catálogo real (`estadoGuardado.totalCents`,
     * Fase 2) y solo se cae al texto cuando ese dato no existe. Ver
     * `elClienteVioUnTotal` en anuncio-de-cierre.ts.
     */
    const yaHuboResumen = elClienteVioUnTotal(
      history.filter((m) => m.direction === "out").map((m) => m.text),
      estadoGuardado?.totalCents
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
  if (!contrataCitas(vertical)) {
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
    action.action === "notify_order" || contrataCitas(vertical)
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

  /**
   * Octavo guardarraíl: el cliente confirmó y no se cerró (3-sep-2026).
   *
   * Distinto de "resumen mal armado" (arriba): ahí el mensaje nuevo del
   * agente está roto por sí solo. Aquí está bien formado — el fallo es que
   * NO DEBIÓ mandarse, porque el cliente ya había dicho que sí en su
   * mensaje anterior. Incidente real documentado dos veces (Natalia,
   * 13-ago; y el reportado el 3-sep): el cliente confirma, el agente repite
   * el mismo resumen pidiendo confirmar, hasta que una persona interviene a
   * mano. Ver `anuncio-de-cierre.ts` para el detalle completo.
   *
   * Solo en pedidos, igual que el resumen: en citas el cierre no depende de
   * `notify_order` ni de un resumen con total.
   *
   * Excluido explícitamente cuando `falloDeResumen` ya disparó: el caso de
   * Natalia junta las dos fallas (pide confirmar Y se despide en el mismo
   * mensaje, justo después de que la clienta ya dijo que sí) — sin esta
   * exclusión, ambos guardarraíles reintentaban el turno por separado sobre
   * la MISMA respuesta rota, gastando una llamada de más al modelo sin
   * arreglar nada que el primero no estuviera ya intentando arreglar.
   */
  const confirmoSinCierre =
    action.action === "notify_order" || contrataCitas(vertical) || falloDeResumen
      ? false
      : confirmoPeroNoSeCerro({
          ultimaRespuestaPrevia,
          mensajesDelCliente: pendientesDelCliente,
          accionNueva: action.action,
          textoDeLaAccionNueva: textosAlCliente(action).join(" "),
        });
  if (confirmoSinCierre) {
    console.warn(
      `[agente] cliente confirmó y no se cerró el pedido en ${conversationId}; rehaciendo el turno`
    );
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      { role: "user", content: CORRECCION_DE_CONFIRMACION_NO_CERRADA },
    ]);
    await registrarUsoIa(
      organizationId,
      reintento.usage,
      `conv:${conversationId}/confirmo-sin-cierre`
    );
    if (reintento.ok && reintento.data.action === "notify_order") {
      action = reintento.data;
    } else {
      // Si insiste, es exactamente el patrón que ya le costó una intervención
      // manual a Natalia (13-ago) tres veces seguidas: mejor derivar de una
      // vez que dejar al cliente confirmando en bucle.
      console.error(
        `[agente] insiste en no cerrar tras confirmar en ${conversationId}; lo toma una persona`
      );
      await derivarAUnaPersona(conversation, {
        reason: "modelo",
        teamSummary:
          "El cliente confirmó el pedido y el asistente volvió a pedirle que confirmara en vez de cerrarlo. Revisa la conversación: puede que el cliente ya haya dicho que sí más de una vez.",
      });
      return { action: "handoff", reason: "confirmo sin cierre" };
    }
  }

  /**
   * Séptimo guardarraíl: contenido obligatorio del CRM que no llegó al
   * cliente (24-ago-2026).
   *
   * Distinto de "recurso prometido" (arriba): aquel detecta que el modelo
   * PROMETIÓ algo en su propio texto y no lo cumplió. Este no depende de que
   * el modelo prometa nada — el disparador es lo que escribió EL CLIENTE, no
   * lo que dijo el agente. Es el caso de Lis Pastelería: el dueño ya tenía
   * escrita "SIEMPRE que el cliente pregunte por los productos envíale el
   * link del catálogo", y el modelo la incumplía 1 de cada 3 veces sin
   * prometer nada — simplemente no lo mencionaba.
   *
   * Medido con el pipeline real, sobre el caso que lo originó: 33 % de fallo
   * antes de nada · 12,5 % tras corregir la regla en el CRM (menos
   * inferencia que hacer) · **0 % de fallo del cliente** con este
   * guardarraíl, porque la última red no es un reintento — es el propio
   * servidor añadiendo el literal exacto que el negocio escribió. Detalle y
   * la medición completa en docs/korexia/125.
   *
   * Genérico: no hay ninguna palabra de "catálogo" aquí ni en
   * `contenido-obligatorio.ts`. Cualquier enlace en cualquier regla propia o
   * entrada de conocimiento de cualquier negocio queda protegido igual.
   */
  if (fichaDelNegocio) {
    const contenidoObligatorio = extraerContenidoObligatorio(
      fichaDelNegocio as FichaDelNegocio,
      kb
    );
    // Con algo ya en el carrito, "añádelo a mi pedido" deja de significar
    // "muéstrame el catálogo" — ver el incidente en `disparadoPor`.
    const hayPedidoEnCurso = (estadoGuardado?.items?.length ?? 0) > 0;
    const disparado = contenidoObligatorio.filter((c) =>
      disparadoPor(pendientesDelCliente, c, hayPedidoEnCurso)
    );
    if (disparado.length > 0) {
      const faltaAntes = disparado.filter(
        (c) => !textosAlCliente(action).some((t) => t.includes(c.literal))
      );
      if (faltaAntes.length > 0) {
        console.warn(
          `[agente] falta contenido obligatorio (${faltaAntes.map((f) => f.literal).join(", ")}); rehaciendo el turno`
        );
        const reintento = await chatJson(AgentAction, [
          ...messages,
          { role: "assistant", content: result.raw },
          { role: "user", content: correccionDeContenidoFaltante(faltaAntes) },
        ]);
        await registrarUsoIa(
          organizationId,
          reintento.usage,
          `conv:${conversationId}/contenido-obligatorio`
        );
        if (reintento.ok) action = reintento.data;

        const faltaDespues = disparado.filter(
          (c) => !textosAlCliente(action).some((t) => t.includes(c.literal))
        );
        if (faltaDespues.length > 0) {
          console.warn(
            `[agente] sigue sin incluir ${faltaDespues.map((f) => f.literal).join(", ")} tras el reintento; se añade directamente`
          );
          action = agregarContenidoFaltante(action, faltaDespues);
        }
        // Siempre `true`: la última red (agregarContenidoFaltante) fuerza el
        // literal directamente, así que este guardarraíl nunca deriva a una
        // persona — 0% de fallo del cliente, doc 125.
        agregarGuardarrail(traza, "contenido_obligatorio", true);
      }
    }
  }

  /**
   * Prioridad 1 (programa de mejora integral) — mismo patrón del incidente
   * de domicilio, aplicado a `conversation_state`: la propuesta de este
   * turno se guardó con `confirmado:true` justo después de la primera
   * llamada al modelo (`guardarEstadoPropuesto`, arriba), pero entre ese
   * guardado y AQUÍ pueden correr hasta 8 guardarraíles de texto que
   * reescriben `action` sin volver a extraer el estado (ninguno llama
   * `chatJsonConEstado`, todos usan `chatJson` plano). Si ninguno de ellos
   * terminó cerrando un `notify_order` real, un pedido puede quedar
   * `confirmado:true` en base de datos sin que el turno haya cerrado nada
   * — mintiendo sobre lo que en verdad pasó. En este punto `action` ya es
   * la decisión final (ver el comentario de "Punto único de registro de la
   * traza" más abajo), así que aquí es donde se puede saber con certeza si
   * de verdad hubo un cierre.
   */
  if (estadoRecienGuardado?.guardadoConfirmadoTrue && action.action !== "notify_order") {
    await corregirConfirmadoSinCierre(organizationId, conversation.id);
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
      traza.accionFinal = action.action;
      registrarTrazaDelTurno(traza);
      return action;
    }
  }

  /**
   * Punto único de registro de la traza (docs/korexia/145) para el resto de
   * acciones: en este punto `action` ya refleja la decisión final, con
   * todos los guardarraíles de arriba ya aplicados — lo que sigue es solo
   * EJECUTARLA (enviar el mensaje, guardar en la base), no decidir nada más.
   *
   * Un `handoff` que llega hasta aquí sin causa ya anotada es una decisión
   * VOLUNTARIA del modelo (una regla de escalado del negocio, no un error
   * de esquema ni un guardarraíl agotado — esos ya marcaron su causa antes
   * de llegar aquí): caso real, "Retiro de acrílicas" (26-ago-2026, doc
   * 144), donde el modelo derivó por dudar si el salón podía hacer dos
   * servicios simultáneos con especialistas distintas.
   */
  if (action.action === "handoff" && !traza.handoffCausa) {
    registrarHandoff(traza, "business_rule");
  }
  /*
   * Nivel 1 de recuperación (docs/korexia/144): `send_menu` sin `reply` ya
   * es una acción válida — el ejecutor de más abajo usa el fallback
   * determinista (el texto por defecto de `armarMenuDeIntenciones`/
   * `armarMenuDelCatalogo`, o "¿En qué te puedo ayudar?" en la
   * degradación). Se detecta aquí, sin esperar a la ejecución: la ausencia
   * del campo ya se sabe en este punto.
   */
  if (action.action === "send_menu" && !action.reply) {
    registrarRecuperacion(traza, 1, true);
  }
  traza.accionFinal = action.action;
  registrarTrazaDelTurno(traza);

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
     * El cliente acaba de dar un dato que este negocio declaró como
     * requisito (docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md). `capturar`
     * es la ÚNICA función que escribe — este ejecutor no sabe de columnas,
     * solo delega. Si `requisitoId` no está declarado o no tiene destino
     * conocido, se registra y se sigue: un dato que no se pudo guardar no
     * puede tumbar el turno, igual que `anotarOfrecidos`.
     */
    case "provide_requirement": {
      const resultado = await capturar({
        organizationId,
        contactId: conversation.contactId,
        requisitos: requisitos ?? [],
        requisitoId: action.requisitoId,
        valor: action.valor,
      });
      if (!resultado.ok) {
        console.warn(`[requisitos] no se pudo capturar "${action.requisitoId}": ${resultado.motivo}`);
      }
      if (action.reply) await deliverReply(conversation, action.reply);
      return action;
    }
    /*
     * Mandar la foto (o el catálogo en PDF) que pidió el cliente.
     *
     * Se degrada a texto en TRES casos, y ninguno deja al cliente sin
     * respuesta: si el archivo no existe, si no se puede construir una URL
     * pública (falta `PUBLIC_MEDIA_BASE_URL`), o si el envío falla. Una foto
     * es un extra; quedarse mudo, no.
     *
     * El modelo sigue pidiendo `send_image` para las dos cosas — no sabe ni
     * necesita saber si lo que hay detrás de una etiqueta es una imagen o un
     * PDF de varias páginas. Lo decide `foto.mimeType`, no el modelo.
     */
    case "send_image": {
      // El modelo escribe `label` tanto como `etiqueta` (ver la nota del
      // esquema): se acepta cualquiera de los dos y, si no viene ninguno, se
      // trata como una foto que no existe — es decir, se responde con texto.
      const pedida = action.etiqueta ?? action.label ?? "";
      const foto = pedida ? await fotoPorEtiqueta(organizationId, pedida) : null;

      /*
       * Cómo se entrega lo decide el RECURSO, no el modelo ni el código: el
       * negocio lo declaró al cargarlo (`media_asset.entrega`). El núcleo solo
       * distingue "archivo" de "enlace" — no sabe si detrás hay un menú, un
       * catálogo, un tarifario o una guía, y por eso esto vale igual para
       * cualquier negocio del CRM.
       */
      const via = foto ? comoSeEntrega(foto) : { archivo: false, enlace: false };
      const urlArchivo = via.archivo ? urlPublicaDeFoto(foto!.id) : null;
      const enlace = via.enlace ? foto!.url : null;

      // Nada que entregar: ni existe, ni tiene archivo servible, ni enlace.
      // Se responde con texto, como siempre — una promesa que no se puede
      // cumplir es peor que una respuesta escrita.
      if (!foto || (!urlArchivo && !enlace)) {
        console.warn(
          `[agente] no se pudo mandar "${pedida}" (${!foto ? "no existe" : "sin archivo servible ni enlace"}); se responde con texto`
        );
        if (action.reply) await deliverReply(conversation, action.reply);
        return action;
      }

      // El enlace viaja SIEMPRE en el texto, vaya solo o acompañando al
      // archivo: el pie de una imagen y el cuerpo de un mensaje son el mismo
      // campo para quien lo lee.
      const texto = [action.reply, enlace].filter(Boolean).join("\n\n") || undefined;

      if (!urlArchivo) {
        await deliverReply(conversation, texto!);
        return action;
      }

      if (foto.mimeType === "application/pdf") {
        await deliverDocument(conversation, urlArchivo, foto.etiqueta, texto);
      } else {
        await deliverImage(conversation, urlArchivo, texto);
      }
      return action;
    }
    /*
     * El menú guiado de WhatsApp (25-ago-2026): el modelo pide CUÁNDO
     * ("intenciones" al abrir, "catalogo" cuando preguntan qué venden), y el
     * servidor arma las filas desde datos reales — nunca desde lo que
     * proponga el modelo. Si no hay ficha.menu, no hay catálogo, o el menú
     * no cabe en los límites de WhatsApp, degrada a `reply` — igual que
     * `send_image` con un recurso que no existe.
     */
    case "send_menu": {
      const menu =
        action.tipo === "intenciones"
          ? armarMenuDeIntenciones(fichaDelNegocio?.menu?.opciones ?? [], action.reply)
          : armarMenuDelCatalogo(
              await catalogoDePedidosQuery(organizationId),
              action.categoria ?? null,
              action.reply
            );

      if (!menu) {
        console.warn(
          `[agente] no se pudo armar el menú "${action.tipo}" (sin datos o fuera de los límites de WhatsApp); se responde con texto`
        );
        // `reply` es opcional a propósito (docs/korexia/144): sin fallback
        // aquí, un turno donde el modelo lo omitió se quedaría sin una sola
        // palabra para el cliente.
        await deliverReply(conversation, action.reply ?? "¿En qué te puedo ayudar?");
        return action;
      }
      await deliverMenu(conversation, menu);
      return action;
    }
    case "handoff": {
      /**
       * El cliente SIEMPRE se entera de que viene una persona.
       *
       * `farewell` es opcional en el contrato, así que hasta el 15-sep-2026
       * una derivación sin despedida salía MUDA: el agente dejaba de
       * responder y el cliente no recibía nada. Si además el negocio no
       * tiene números de aviso configurados —el caso de Lis, MALIA y La
       * Churra—, tampoco se enteraba el equipo: silencio por los dos lados.
       *
       * Incidente real (Lis Pastelería, 15-sep, `cv_z4d9leo1jbencecfx2dl`):
       * la clienta mandó una foto del producto que quería, el modelo derivó
       * sin `farewell`, y estuvo **nueve minutos** sin recibir una sola
       * palabra —ni del bot ni de nadie— hasta que alguien miró la bandeja
       * por casualidad.
       *
       * El prompt ya le pide al modelo despedirse aquí, y casi siempre lo
       * hace; esto es la red para cuando no. Nunca pisa su texto: solo
       * cubre la ausencia.
       */
      await deliverReply(conversation, action.farewell || AVISO_DE_DERIVACION);
      await applyHandoff(conversationId, organizationId, "modelo");
      // Fase 10T — bug real: este camino (decisión del MODELO, no error ni
      // FR-022) marcaba el handoff sin avisar nunca al equipo por WhatsApp —
      // solo quedaba el evento SSE del CRM. El prompt le pide al modelo decir
      // siempre "te comunico con el equipo" justo en este camino silencioso.
      await notificarEquipoDeHandoff(
        conversation,
        action.reason ? `${AVISO_EQUIPO_MODELO} Motivo: ${action.reason}` : AVISO_EQUIPO_MODELO
      );
      return action;
    }
    case "notify_order": {
      /**
       * Fase 1 del plan de `docs/korexia/156`: el cierre del pedido —la única
       * acción irreversible del vertical— vive en `orders/policy.ts`. Aquí
       * queda solo la llamada y los efectos que este módulo posee
       * (`deliverReply`, ownership, nota del lead, relevo), que se pasan
       * explícitos para no crear un ciclo entre los dos archivos.
       *
       * Es una mudanza: no cambió ninguna decisión ni el orden de las
       * operaciones. Los comentarios que explican POR QUÉ ese orden es el que
       * es —cada uno con su incidente detrás— se fueron con el código.
       */
      await ejecutarConfirmacionDePedido(
        {
          conversation,
          organizationId,
          conversationId,
          summary: action.summary,
          farewell: action.farewell,
          messageIds: pendientes.map((m) => m.id),
          domicilioEstructurado,
        },
        {
          asegurarOwnershipVigente,
          deliverReply,
          appendLeadNote,
          applyHandoff,
        }
      );
      return action;
    }
    case "book_appointment": {
      /**
       * `reservas[]` (19-ago-2026, docs/korexia/108-RESERVAS-DE-VARIAS-PERSONAS.md):
       * cada una se procesa de forma INDEPENDIENTE, nunca todo-o-nada — el
       * cupo de una no puede depender de si la otra tuvo hueco. Caso real
       * que lo motivó: clienta + su mamá, cada una con su servicio, hora y
       * especialista; solo una de las dos se pudo agendar antes de esto, y
       * el texto anunciaba las dos como agendadas.
       */
      // Fase 11-A — mismo criterio que notify_order: sin ownership vigente,
      // ni vale la pena reclamar la clave de idempotencia.
      await asegurarOwnershipVigente(conversation);

      const agendadas: { nombreVisita: string; fecha: string; hora: string; staffName: string }[] =
        [];
      const fallidas: { nombreVisita: string; motivo: string }[] = [];

      /**
       * Programa de mejora integral, Prioridad 5 — idempotencia REAL
       * (Postgres) antes de crear ninguna cita, mismo principio que
       * `notify_order` (Fase 10N-A). Riesgo real (auditoría 10U): un turno
       * vivo puede tardar más de `HUERFANO_TRAS_MS` y `rescatarHuerfanos`
       * reasignarlo mientras el original sigue vivo (ver `cola.ts`); si el
       * turno se reintenta completo y pide un horario DISTINTO al ya
       * reservado, el `EXCLUDE` de `appointment_resource` no lo detecta —
       * sería una segunda cita real. Si este mismo lote de mensajes ya
       * disparó una ejecución de `book_appointment` en esta conversación,
       * esta ejecución NUNCA vuelve a llamar `crearCitaMultiple`.
       */
      const { primeraVez: primeraVezDeEsteLote, id: confirmacionDeCitaId } =
        await registrarConfirmacionDeCita({
          organizationId,
          conversationId,
          messageIds: pendientes.map((m) => m.id),
          kind: "reserva",
        });
      if (!primeraVezDeEsteLote) {
        console.warn(
          `[citas] book_appointment duplicado (mismos mensajes disparadores) en ${conversationId}; no se vuelve a agendar, se reporta lo que ya exista`
        );
      }

      for (const reserva of action.reservas) {
        // Uno o varios servicios en la MISMA visita de esta reserva — igual
        // que antes, todo o nada dentro de la propia reserva.
        const servicios: ServiceRow[] = [];
        let noEncontrado: string | null = null;
        for (const nombre of reserva.servicios) {
          const s = buscarServicio(services, nombre);
          if (!s) {
            noEncontrado = nombre;
            break;
          }
          servicios.push(s);
        }
        const nombreVisita = noEncontrado
          ? reserva.servicios.join(" + ")
          : servicios.map((s) => s.name).join(" + ");

        if (noEncontrado) {
          fallidas.push({
            nombreVisita,
            motivo: `no identifiqué "${noEncontrado}" en el catálogo`,
          });
          continue;
        }

        const resuelto = await resolverEspecialistaMultiple(
          organizationId,
          servicios.map((s) => s.id),
          reserva.especialista
        );
        if (!resuelto.ok) {
          fallidas.push({
            nombreVisita,
            motivo: resuelto.opciones.length
              ? `para "${nombreVisita}" atienden: ${resuelto.opciones.join(", ")}`
              : `nadie atiende "${nombreVisita}" junto en la misma cita`,
          });
          continue;
        }
        const fecha = normalizarFecha(reserva.fecha) ?? reserva.fecha;

        /**
         * Solo se agenda un horario que el agente haya ofrecido en esta
         * conversación. `crearCita` ya comprueba que el hueco esté libre, pero
         * eso no impide agendar uno que nunca se ofreció: el caso real es una
         * fecha relativa mal entendida ("el miércoles", "mañana en la tarde")
         * que cae por casualidad en un hueco libre. Idea tomada de `nea-agent`.
         */
        const ofrecido = await estaEntreLosOfrecidos({
          organizationId,
          conversationId: conversation.id,
          fecha,
          hora: reserva.hora,
        });
        if (!ofrecido.ok) {
          const opciones = ofrecido.ofrecidos
            .map((o) => `${o.fecha} a las ${horaAAmPm(o.hora)}`)
            .join(", ");
          console.warn(
            `[citas] reserva rechazada en ${conversation.id}: ${fecha} ${reserva.hora} ` +
              `no está entre los ofrecidos (${opciones})`
          );
          fallidas.push({
            nombreVisita,
            motivo: opciones
              ? `los horarios que tengo disponibles son ${opciones}`
              : "ese horario no fue uno de los que ofrecí",
          });
          continue;
        }

        /**
         * Confirmación por servicio (docs/korexia/149). `estaEntreLosOfrecidos`
         * ya garantizó que el HORARIO se ofreció, pero no QUÉ servicios se
         * ofrecieron para él. El incidente real (Lashes Valen, 26-27-ago-2026)
         * fue el modelo agendando dos servicios ("manos y pies") cuando solo
         * había consultado disponibilidad para uno: `offered_slot` guardaba el
         * horario, así que pasaba el filtro anterior. Aquí se compara servicio
         * a servicio la combinación que se intenta agendar contra la que de
         * verdad se consultó junta para esa fecha+hora exactas.
         *
         * Solo para visitas de MÁS de un servicio: con uno solo no hay
         * combinación que verificar y el comportamiento no cambia (cero riesgo
         * de regresión). Lista vacía = el horario no pasó por una consulta
         * (fecha/hora directa): permisivo a propósito, igual que
         * `estaEntreLosOfrecidos` — no se bloquea lo que no se puede corroborar.
         *
         * NO reinterpreta ambigüedad de lenguaje: solo detecta la
         * inconsistencia entre lo consultado y lo que se intenta agendar. Si el
         * modelo consultó ambos servicios (aunque el cliente respondiera
         * "sí, tradicional"), ambos quedaron en `offered_slot` y pasa.
         */
        if (servicios.length > 1) {
          const ofrecidosParaHorario = await serviciosOfrecidosPara(
            organizationId,
            conversation.id,
            fecha,
            reserva.hora
          );
          const idsOfrecidos = new Set(ofrecidosParaHorario);
          const sinCorroborar =
            ofrecidosParaHorario.length > 0
              ? servicios.filter((s) => !idsOfrecidos.has(s.id))
              : [];
          if (sinCorroborar.length > 0) {
            const nombresSinCorroborar = sinCorroborar.map((s) => s.name).join(", ");
            const corroborados = servicios
              .filter((s) => idsOfrecidos.has(s.id))
              .map((s) => s.name)
              .join(", ");
            console.warn(
              `[citas] reserva rechazada en ${conversation.id}: para ${fecha} ${reserva.hora} ` +
                `se pidió agendar [${servicios.map((s) => s.name).join(", ")}] pero solo se ` +
                `consultó disponibilidad para [${corroborados || "ninguno de ellos"}]; ` +
                `servicio(s) sin corroborar: ${nombresSinCorroborar}`
            );
            // El [traza] del turno ya se emitió antes del switch (crash-safety,
            // docs/korexia/145); este guardarraíl se decide dentro del case, así
            // que su evidencia en vivo es el console.warn de arriba (más rico:
            // nombra el servicio). `agregarGuardarrail` deja el registro en el
            // objeto de traza por consistencia y de cara a futuros consumidores.
            agregarGuardarrail(traza, "appointment_incomplete_services", true);
            fallidas.push({
              nombreVisita,
              motivo:
                `"${nombresSinCorroborar}" no quedó parte de ningún horario consultado ` +
                `para esta visita — antes de agendar, vuelve a usar consult_availability ` +
                `con TODOS los servicios de la visita juntos`,
            });
            continue;
          }
          // Combinación corroborada (o sin registro que corroborar): el chequeo
          // corrió limpio, no bloqueó nada.
          agregarGuardarrail(traza, "appointment_incomplete_services", false);
        }

        let resultado:
          | Awaited<ReturnType<typeof crearCitaMultiple>>
          | Awaited<ReturnType<typeof buscarCitaYaCreada>>;
        if (primeraVezDeEsteLote) {
          try {
            resultado = await crearCitaMultiple({
              organizationId,
              contactId: conversation.contactId,
              services: servicios,
              fecha,
              hora: reserva.hora,
              staffIdPreferido: resuelto.staffId,
              hours,
              now: opts?.now,
            });
          } catch (err) {
            /**
             * Fase 10V, Hallazgo D — un error INESPERADO (no el `sin_cupo`/
             * `fuera_de_horario` que `crearCitaMultiple` ya maneja sin
             * lanzar) dejaría, sin esto, la clave de idempotencia tomada
             * para siempre sin que la cita se haya creado nunca: el
             * reintento del job vería `primeraVezDeEsteLote=false` y jamás
             * volvería a intentarlo. Si NINGUNA reserva de este lote se
             * creó todavía, deshacer la clave es seguro (nada que
             * duplicar) y dejar que el reintento del job lo intente de
             * cero. Si YA se creó alguna, deshacer arriesgaría duplicarla
             * en el reintento — se reporta esta reserva puntual como
             * fallida en vez de eso (riesgo residual documentado, no un
             * rediseño completo: ver el informe de la Fase 10V).
             */
            if (agendadas.length === 0) {
              await borrarConfirmacionDeCita({
                conversationId,
                messageIds: pendientes.map((m) => m.id),
              }).catch((errDeshacer) => {
                console.error(
                  "[citas] no se pudo deshacer la idempotencia tras un error inesperado:",
                  errDeshacer
                );
              });
              throw err;
            }
            console.error(
              `[citas] crearCitaMultiple lanzó un error inesperado en ${conversation.id} tras ya haber creado ${agendadas.length} reserva(s) de este lote; no se deshace la idempotencia (evitaría duplicar lo ya creado)`,
              err
            );
            fallidas.push({ nombreVisita, motivo: "ocurrió un error inesperado al agendar" });
            break;
          }
        } else {
          resultado = await buscarCitaYaCreada(
            organizationId,
            conversation.contactId,
            servicios[0]!.id,
            fecha,
            reserva.hora
          );
        }
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
                c.serviceId === servicios[0]!.id &&
                utcAFechaHoraBogota(c.startsAt).fecha === fecha &&
                utcAFechaHoraBogota(c.startsAt).hora === reserva.hora
            );
          fallidas.push({
            nombreVisita,
            motivo: suya
              ? "esa cita ya está confirmada"
              : resultado.reason === "fuera_de_horario"
                ? "esa fecha no se puede agendar"
                : "ese horario ya no está disponible",
          });
          continue;
        }
        agendadas.push({ nombreVisita, fecha, hora: reserva.hora, staffName: resultado.staffName });
      }

      const lineas = [
        ...agendadas.map(
          (a) =>
            `✅ Quedaste agendada: *${a.nombreVisita}* el ${a.fecha} a las ${horaAAmPm(a.hora)} con ${a.staffName}.`
        ),
        ...fallidas.map((f) => `⚠️ *${f.nombreVisita}* no se pudo agendar: ${f.motivo}.`),
      ];

      if (agendadas.length === 0) {
        // Nada que confirmar: solo informar qué falló, sin avisar al equipo
        // ni tocar el embudo — no hay ninguna cita real de por medio.
        await deliverReply(conversation, lineas.join("\n"));
        return action;
      }

      // La(s) cita(s) ya existen: lo ofrecido dejó de tener sentido para
      // TODA la conversación, no solo para la reserva que lo consumió — se
      // limpia una sola vez, después del bucle completo.
      await limpiarOfrecidos(organizationId, conversation.id).catch(() => {});
      await avisarYConfirmar({
        conversation,
        organizationId,
        confirmacion: lineas.join("\n"),
        nota: agendadas
          .map((a) => `Cita agendada: ${a.nombreVisita} · ${a.fecha} ${a.hora} · ${a.staffName}`)
          .join(" | "),
        avisoEquipo: agendadas
          .map(
            (a) =>
              `📅 Nueva cita: ${a.nombreVisita} el ${a.fecha} a las ${horaAAmPm(a.hora)} con ${a.staffName}.`
          )
          .join("\n"),
        farewell: action.farewell,
        confirmationId: confirmacionDeCitaId,
      });
      return action;
    }
    case "reschedule_appointment": {
      // Fase 11-A — antes de tocar una cita real: sin ownership vigente, ni
      // se intenta. La idempotencia propia de `reprogramarCita` (Fase 8A)
      // vive más abajo, después de resolver la cita y el servicio.
      await asegurarOwnershipVigente(conversation);
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
        // Fase 10T — bug real: esto le decía al cliente "te comunico con el
        // equipo" con `deliverReply` puro, sin ejecutar NINGÚN handoff real
        // (ni `applyHandoff`, ni aviso al equipo) — el agente seguía activo y
        // respondiendo normal al siguiente mensaje, promesa vacía. Ahora usa
        // el mismo camino real que cualquier otra derivación por error.
        await derivarAUnaPersona(conversation, { reason: "error" });
        return { action: "handoff", reason: "error" };
      }
      const nuevaFecha = normalizarFecha(action.nuevaFecha) ?? action.nuevaFecha;

      /**
       * Fase 8A — mismo mecanismo de idempotencia que `book_appointment`
       * (auditoría Fase 8, hallazgo A2/B3): antes de reprogramar de verdad,
       * registrar el lote de mensajes disparadores. Si un turno huérfano
       * rescatado (`cola.ts`) sigue vivo y ejecuta este mismo case dos veces,
       * la segunda ejecución no debe volver a mover la cita ni a duplicar el
       * aviso al equipo.
       */
      const { primeraVez: primeraVezDeEsteLote, id: confirmacionDeCitaId } =
        await registrarConfirmacionDeCita({
          organizationId,
          conversationId,
          messageIds: pendientes.map((m) => m.id),
          kind: "reprogramacion",
        });

      let yaAplicado = false;
      if (!primeraVezDeEsteLote) {
        // Repetición del mismo lote de mensajes — antes de reprogramar otra
        // vez, comprobar con una lectura fresca si el cambio YA quedó
        // aplicado (la primera ejecución pudo haber fallado, así que no se
        // asume éxito a ciegas — mismo criterio que `buscarCitaYaCreada` en
        // `book_appointment`).
        const activasAhora = await citasActivasDeContacto(organizationId, conversation.contactId);
        const citaAhora = activasAhora.find((c) => c.id === cita.id);
        if (citaAhora) {
          const actual = utcAFechaHoraBogota(citaAhora.startsAt);
          yaAplicado = actual.fecha === nuevaFecha && actual.hora === action.nuevaHora;
        }
        if (yaAplicado) {
          console.warn(
            `[citas] reschedule_appointment duplicado (mismos mensajes disparadores) en ${conversationId}; ya estaba aplicado, no se repite`
          );
        }
      }

      if (!yaAplicado) {
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
          if (resultado.reason === "especialista_no_disponible") {
            // Fase 10U — bug real: la especialista de la cita original ya no
            // está activa (o ya no ofrece este servicio). No es "elige otra
            // hora" (`sin_cupo`) — con ella ninguna hora sirve. Handoff real,
            // mismo camino que "servicio ya no está en el catálogo" (Fase 10T).
            await derivarAUnaPersona(conversation, { reason: "error" });
            return { action: "handoff", reason: "error" };
          }
          const msg =
            resultado.reason === "fuera_de_horario"
              ? "Esa fecha no se puede agendar. ¿Qué otro día te gustaría?"
              : `Ese horario ya no está disponible con ${cita.staffName}. ¿Qué otra hora prefieres?`;
          await deliverReply(conversation, msg);
          return action;
        }
      }
      await avisarYConfirmar({
        conversation,
        organizationId,
        confirmacion: `✅ Tu cita de *${cita.serviceName}* quedó reprogramada para el ${nuevaFecha} a las ${horaAAmPm(action.nuevaHora)} con ${cita.staffName}.`,
        nota: `Cita reprogramada: ${cita.serviceName} → ${nuevaFecha} ${action.nuevaHora}`,
        avisoEquipo: `🔁 Cita reprogramada: ${cita.serviceName} ahora el ${nuevaFecha} a las ${horaAAmPm(action.nuevaHora)} con ${cita.staffName}.`,
        farewell: action.farewell,
        confirmationId: confirmacionDeCitaId,
      });
      return action;
    }
    case "cancel_appointment": {
      // Fase 11-A — mismo criterio que reschedule_appointment.
      await asegurarOwnershipVigente(conversation);
      const activas = await citasActivasDeContacto(organizationId, conversation.contactId);
      const cita = encontrarCitaActiva(activas, action.servicio);
      if (!cita) {
        await deliverReply(
          conversation,
          `No encontré una cita activa tuya para "${action.servicio}".`
        );
        return action;
      }

      /**
       * Fase 8A — mismo mecanismo que `book_appointment`/`reschedule_appointment`
       * de arriba. A diferencia de reprogramar, cancelar es seguro de
       * verificar sin una segunda lectura: `cita` salió de
       * `citasActivasDeContacto` (solo citas activas) hace un instante, así
       * que si esta ejecución perdió la carrera de idempotencia, la otra
       * ejecución (que sí es `primeraVez`) es la única que debe llamar a
       * `cancelarCita` — esta solo se une al aviso, ya idempotente por sí
       * mismo vía `intentarNotificarCita`.
       */
      const { primeraVez: primeraVezDeEsteLote, id: confirmacionDeCitaId } =
        await registrarConfirmacionDeCita({
          organizationId,
          conversationId,
          messageIds: pendientes.map((m) => m.id),
          kind: "cancelacion",
        });
      if (primeraVezDeEsteLote) {
        await cancelarCita(organizationId, cita.id);
      } else {
        console.warn(
          `[citas] cancel_appointment duplicado (mismos mensajes disparadores) en ${conversationId}; ya estaba cancelada, no se repite`
        );
      }
      const { fecha, hora } = utcAFechaHoraBogota(cita.startsAt);
      await avisarYConfirmar({
        conversation,
        organizationId,
        confirmacion: `Listo, cancelé tu cita de *${cita.serviceName}* del ${fecha} a las ${horaAAmPm(hora)}.`,
        nota: `Cita cancelada: ${cita.serviceName} · ${fecha} ${hora}`,
        avisoEquipo: `❌ Cita cancelada: ${cita.serviceName} del ${fecha} a las ${horaAAmPm(hora)} (${cita.staffName}).`,
        farewell: action.farewell,
        confirmationId: confirmacionDeCitaId,
      });
      return action;
    }
  }
  return null;
}

type Conversation = typeof schema.conversation.$inferSelect & {
  /**
   * Fase 11-A — a qué job/generación pertenece la ejecución EN CURSO de
   * `runAgentTurn`, cuando viene de la cola real (`worker.ts`). Se asigna
   * UNA vez, al principio del turno (ver `runAgentTurn`), sobre el mismo
   * objeto `conversation` que ya viaja por todo el archivo — así ningún
   * punto de llamada de `deliverReply`/`derivarAUnaPersona`/etc. necesita
   * un parámetro nuevo para enterarse.
   *
   * `undefined` para cualquier llamador que no pase por la cola
   * (Laboratorio, scripts, pruebas que invocan `runAgentTurn` directo): en
   * ese caso no hay ningún worker concurrente del que protegerse, y
   * `asegurarOwnershipVigente` no hace ninguna consulta — cero cambio de
   * comportamiento para esos caminos.
   */
  jobOwnership?: { jobId: string; generation: number };
};

/**
 * Fase 11-A — el worker que la lanza ya no es dueño de la generación que
 * reclamó (otro worker la reasignó vía `rescatarHuerfanos`). Se usa como una
 * señal DISTINGUIBLE de cualquier otro fallo: `worker.ts` la reconoce y NO
 * la trata como un error del turno (no reintenta, no ensucia el log de
 * fallos) — es la salida controlada que pide la Parte A: ni un mensaje ni un
 * efecto más, y sin intentar finalizar el job como propio (`completarTrabajo`/
 * `fallarTrabajo` ya son no-op para una generación vieja, pero ni falta hace
 * llamarlos).
 */
export class OwnershipPerdidaError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly generation: number
  ) {
    super(
      `[fencing] el worker ya no es dueño del job ${jobId} (generación ${generation}); se detiene antes de un efecto externo`
    );
    this.name = "OwnershipPerdidaError";
  }
}

/**
 * El chequeo real, contra Postgres — nunca una bandera en memoria (ver el
 * comentario de `siguePoseyendoElTrabajo` en `cola.ts`). Se llama al
 * principio de cada función que produce un efecto externo crítico; lanza
 * `OwnershipPerdidaError` si el worker ya perdió la generación, ANTES de que
 * esa función haga nada más.
 */
async function asegurarOwnershipVigente(conversation: Conversation): Promise<void> {
  const ownership = conversation.jobOwnership;
  if (!ownership) return;
  const vigente = await siguePoseyendoElTrabajo(ownership);
  if (!vigente) {
    console.warn(
      `[fencing] worker perdió ownership del job ${ownership.jobId} (generación ${ownership.generation}, conversación ${conversation.id}); se detiene antes de un efecto externo`
    );
    throw new OwnershipPerdidaError(ownership.jobId, ownership.generation);
  }
}

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

const AVISO_EQUIPO_MODELO =
  "🤖 El agente derivó una conversación a una persona por regla de negocio. " +
  "Revisa la bandeja cuanto antes.";

/**
 * Fase 10T — extraído de `derivarAUnaPersona` para que TODO handoff (error,
 * cliente, o decisión del modelo por regla de negocio) avise al equipo por
 * el mismo camino real, sin duplicar el try/catch.
 */
async function notificarEquipoDeHandoff(conversation: Conversation, summary: string): Promise<void> {
  await asegurarOwnershipVigente(conversation);
  try {
    const phone = await contactPhoneOf(conversation.organizationId, conversation.contactId);
    const resultado = await notifyTeam({
      organizationId: conversation.organizationId,
      summary,
      customerPhone: phone,
      isTest: conversation.isTest,
    });
    /**
     * El resultado se descartaba entero, y con él la única señal de que la
     * promesa que se le acaba de hacer al cliente —"te comunico con una
     * persona del equipo"— no la iba a cumplir nadie. Una derivación sin
     * destinatarios no dejaba NI UNA LÍNEA en los logs: por eso el incidente
     * de MALIA (8-sep-2026) hubo que reconstruirlo desde la base de datos.
     *
     * No se convierte en excepción a propósito: la derivación en sí es
     * correcta y la conversación tiene que quedar marcada en la bandeja pase
     * lo que pase. Lo que cambia es que ahora se ve.
     */
    if (!resultado.sent && !conversation.isTest) {
      console.error(
        `[agente] conv=${conversation.id} se le prometió una persona al cliente y ` +
          `el aviso al equipo NO llegó a nadie: ${resultado.detail}`
      );
    }
  } catch (err) {
    console.error("[agente] no se pudo avisar al equipo de la derivación:", err);
  }
}

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
  await asegurarOwnershipVigente(conversation);
  const reason = opts?.reason ?? "error";
  const teamSummary = opts?.teamSummary ?? AVISO_EQUIPO_ERROR;

  try {
    await deliverReply(conversation, AVISO_DE_DERIVACION, { esAviso: true });
  } catch (err) {
    /**
     * Fase 6B — hallazgo de auditoría: este catch trataba
     * `OwnershipPerdidaError` (lanzada por la propia reverificación interna
     * de `deliverReply`, una consulta real a Postgres — no una bandera en
     * memoria) igual que cualquier fallo de envío benigno, y seguía adelante
     * con `applyHandoff` SIN ninguna protección de ownership. La propiedad
     * exigida es "perder ownership antes de un efecto externo crítico => no
     * ejecutar ese efecto" — `applyHandoff` es exactamente ese efecto. Si se
     * perdió la generación en la ventana entre el chequeo de arriba y este,
     * se aborta aquí mismo: no se marca el handoff, no se notifica al
     * equipo. El nuevo dueño del job se encarga de todo el turno de cero.
     */
    if (err instanceof OwnershipPerdidaError) throw err;
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
  await notificarEquipoDeHandoff(conversation, teamSummary);
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
  await asegurarOwnershipVigente(conversation);
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
  await asegurarOwnershipVigente(conversation);
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

/**
 * Manda un documento (un catálogo en PDF) con su pie. Mismo criterio que
 * `deliverImage`: si falla, cae a texto y sigue — no deriva a una persona.
 */
async function deliverDocument(
  conversation: Conversation,
  url: string,
  etiqueta: string,
  pie?: string
): Promise<void> {
  await asegurarOwnershipVigente(conversation);
  if (conversation.isTest) {
    await persistTestOutbound(conversation, `[documento: ${url}]${pie ? `\n${pie}` : ""}`);
    return;
  }
  try {
    await sendDocument({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      link: url,
      // WhatsApp necesita un nombre de archivo para la burbuja; la etiqueta
      // ya es cómo el negocio lo nombra ("catálogo de diseños").
      filename: /\.pdf$/i.test(etiqueta) ? etiqueta : `${etiqueta}.pdf`,
      caption: pie,
      aiGenerated: true,
    });
  } catch (err) {
    console.warn("[agente] falló el envío del documento; se responde con texto:", err);
    if (pie) await deliverReply(conversation, pie);
  }
}

/**
 * Manda un menú interactivo (lista o botones). Mismo criterio que
 * `deliverImage`: si falla, cae a texto plano con las mismas opciones y
 * sigue — un menú es una mejora de forma, nunca un motivo para dejar al
 * cliente sin respuesta.
 */
async function deliverMenu(
  conversation: Conversation,
  menu: MenuInteractivo
): Promise<void> {
  await asegurarOwnershipVigente(conversation);
  if (conversation.isTest) {
    await persistTestOutbound(conversation, textoPlanoDeMenu(menu));
    return;
  }
  try {
    await sendInteractiveMenu({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      menu,
      aiGenerated: true,
    });
  } catch (err) {
    console.warn("[agente] falló el envío del menú; se responde con texto:", err);
    await deliverReply(conversation, textoPlanoDeMenu(menu));
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
    /*
     * Último recinto: falló el envío Y falló guardar el fallo.
     *
     * Hasta el 16-ago-2026 aquí se volcaba el texto ENTERO "para poder
     * reenviarlo a mano" — y el texto de un turno del agente es el resumen del
     * pedido: nombre, teléfono y dirección del cliente, en el log del
     * contenedor. Se cambia por la medida y la huella: siguen respondiendo
     * *"¿hubo respuesta?"*, *"¿de qué tamaño?"* y *"¿es la misma que la de ese
     * otro turno?"*, que es lo que se pregunta al investigar. Lo que se pierde
     * es poder copiar el texto del log, y hace falta que fallen la base de
     * datos DOS veces seguidas para llegar hasta aquí.
     */
    console.error(
      `[agente] respuesta PERDIDA en ${conversation.id} (no se pudo guardar): ` +
        `texto=${resumirTexto(text)}`,
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
  /**
   * Fase 6B, extendido en Fase 8A — la fila de `appointmentBookingConfirmation`
   * que `registrarConfirmacionDeCita` ya creó para esta operación
   * (`book_appointment`, `reschedule_appointment` o `cancel_appointment`,
   * ver `kind`). Cuando existe, el aviso pasa por `intentarNotificarCita`
   * (registro/aviso/reintento — mismo patrón que `notify_order`, Fase
   * 11-B) en vez de llamar `notifyTeam` directo: si el envío falla,
   * `reintentarNotificacionesDeCitaPendientes` (worker.ts) lo reintenta
   * solo, en vez de perderse en silencio. Solo queda sin pasar para
   * conversaciones de prueba (ver el `else` de abajo, gateado también por
   * `isTest`) — nunca por tipo de operación.
   */
  confirmationId?: string;
}): Promise<void> {
  // Fase 11-A — `notifyTeam`, aquí abajo, es un efecto externo crítico
  // (mismo tipo que el de `notify_order`) sin ningún otro punto de
  // comprobación en su camino — se verifica ownership antes de tocar nada.
  await asegurarOwnershipVigente(params.conversation);
  await appendLeadNote(params.organizationId, params.conversation.contactId, params.nota);
  const phone = await contactPhoneOf(params.organizationId, params.conversation.contactId);
  if (params.confirmationId && !params.conversation.isTest) {
    /**
     * Mismo criterio que `notify_order` (Fase 11-B): para conversaciones
     * reales, `intentarNotificarCita` corre la máquina de estados que
     * también usará cualquier reintento posterior
     * (`appointmentBookingConfirmation.notifyStatus`).
     */
    await guardarContenidoDeCita(params.confirmationId, params.avisoEquipo, phone);
    const resultado = await intentarNotificarCita({
      id: params.confirmationId,
      organizationId: params.organizationId,
      summary: params.avisoEquipo,
      customerPhone: phone,
    });
    if (resultado.estado === "fallo_recuperable") {
      console.warn(
        `[citas] aviso al equipo no entregado en el primer intento (conversación ${params.conversation.id}); reintentarNotificacionesDeCitaPendientes lo reintentará: ${resultado.detail}`
      );
    }
  } else {
    /**
     * Camino directo: CUALQUIER conversación de prueba (Laboratorio) —
     * `isTest: true` simula el aviso sin mandar nada real, y no debe
     * generar una fila que `reintentarNotificacionesDeCitaPendientes`
     * intente reenviar de verdad. Desde la Fase 8A, `confirmationId` llega
     * para las tres operaciones (`book_appointment`, `reschedule_appointment`,
     * `cancel_appointment`) en conversaciones reales — este `else` ya no
     * distingue por tipo de operación.
     */
    await notifyTeam({
      organizationId: params.organizationId,
      summary: params.avisoEquipo,
      customerPhone: phone,
      isTest: params.conversation.isTest,
    });
  }
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
 * Programa de mejora integral, Prioridad 5 — se usa SOLO cuando este lote de
 * mensajes ya disparó una ejecución de `book_appointment` (idempotencia,
 * ver el llamador): en vez de arriesgarse a llamar `crearCitaMultiple` una
 * segunda vez, busca si la cita YA quedó creada por la ejecución anterior,
 * para reportarla con datos reales — o decir honestamente que no se pudo
 * confirmar, nunca fingir un éxito que no ocurrió ni crear una duplicada.
 * Mismo criterio de match que ya usaba el chequeo "suya" de más abajo
 * (servicio + fecha + hora), reutilizado aquí en vez de duplicado dos veces.
 */
async function buscarCitaYaCreada(
  organizationId: string,
  contactId: string,
  serviceId: string,
  fecha: string,
  hora: string
): Promise<{ ok: true; staffName: string } | { ok: false; reason: "sin_cupo" }> {
  const activas = await citasActivasDeContacto(organizationId, contactId);
  const existente = activas.find(
    (c) =>
      c.serviceId === serviceId &&
      utcAFechaHoraBogota(c.startsAt).fecha === fecha &&
      utcAFechaHoraBogota(c.startsAt).hora === hora
  );
  return existente ? { ok: true, staffName: existente.staffName } : { ok: false, reason: "sin_cupo" };
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
  msModelo?: number;
  requisitos?: Requisito[];
  vertical: Vertical;
  /** Contra qué se resuelve la modalidad que proponga el modelo. */
  modalidadesOfrecidas: readonly string[];
  /**
   * La verificación de domicilio conocida, para NO borrarla al guardar.
   *
   * `validarPropuesta` reconstruye el estado desde lo que propone el modelo
   * —items, datos, reserva, modalidad, total, paso— y **`entrega` no está en
   * esa lista**. Como el campo es opcional en el tipo, TypeScript nunca se
   * quejó: cada turno guardaba `entrega: undefined` y borraba la verificación
   * del turno anterior.
   *
   * Medido en producción el 9-sep-2026: de 101 conversaciones de MALIA con
   * estado guardado, **solo 4 conservaban la entrega**. Las otras 97 llegaban
   * al cierre sin zona verificada y el guardarraíl financiero las derivaba —
   * cuatro clientes en un solo día (Carol, Michael, Laura, Karol), y cada una
   * parecía un bug distinto.
   */
  entregaConocida?: EntregaVerificada | null;
  /**
   * Prioridad 3 (programa de mejora integral) — la versión leída al empezar
   * el turno. Si otra ejecución viva de `runAgentTurn` para la MISMA
   * conversación ya escribió después (rescate de huérfanos que reasignó un
   * turno que en realidad seguía vivo, ver `cola.ts`), esta escritura no se
   * aplica — nunca se pisa un estado más nuevo con una decisión tomada
   * sobre datos viejos.
   */
  versionEsperada?: number;
}): Promise<{
  guardadoConfirmadoTrue?: boolean;
  /**
   * Fase 8J — por qué el backend NO aceptó el carrito, en las mismas palabras
   * que ya calcula `validarPropuesta`. Antes esto solo se registraba en una
   * métrica y se descartaba: el modelo seguía el turno creyendo que su
   * propuesta valía, y el cliente recibía una respuesta construida sobre un
   * pedido que el sistema jamás iba a aceptar.
   */
  rechazo?: { motivos: string[]; preguntas: string[] };
} | null> {
  // El reloj arranca antes del primer `await`: lo que se mide es lo que el
  // backend tarda de más por llevar el estado, y eso incluye leer el catálogo.
  const t0 = Date.now();
  const metrica = (
    resultado: "guardado" | "rechazado" | "sin_propuesta" | "error",
    extra: { validacion?: ReturnType<typeof validarPropuesta>; detalle?: string } = {}
  ) =>
    registrarMetricaDeEstado({
      organizationId: entrada.organizationId,
      conversationId: entrada.conversationId,
      resultado,
      validacion: extra.validacion,
      msModelo: entrada.msModelo,
      msBackend: Date.now() - t0,
      detalle: extra.detalle,
    });

  // Sin `estado` en la respuesta no hay nada que guardar: pasa cuando el agente
  // deriva a una persona o no responde, y es legítimo. Se anota igual: si esto
  // deja de ser raro, el modelo dejó de extraer y hay que enterarse.
  if (!entrada.propuesta) {
    metrica("sin_propuesta");
    return null;
  }

  try {
    const productos = await catalogoDe(entrada.organizationId, entrada.vertical);
    const v = validarPropuesta(
      entrada.propuesta,
      productos,
      undefined,
      entrada.requisitos,
      entrada.modalidadesOfrecidas
    );
    if (!v.ok) {
      metrica("rechazado", { validacion: v });
      /*
       * Fase 8J — se devuelve el porqué en vez de tragárselo. El llamador
       * decide qué hacer con él (hoy: una corrección al modelo antes de que
       * el cliente vea nada); aquí solo se deja de perder la información.
       */
      return {
        rechazo: {
          motivos: v.rechazos,
          preguntas: v.dudas.map((d) => d.preguntar).filter(Boolean),
        },
      };
    }
    const resultado = await guardarEstado({
      conversationId: entrada.conversationId,
      organizationId: entrada.organizationId,
      // La entrega verificada sobrevive al turno: la propuesta del modelo no
      // la trae y sin esto se borraba sola (ver `conEntregaConservada`).
      estado: conEntregaConservada(v.estado, entrada.entregaConocida),
      actor: "pipeline",
      proceso: "runAgentTurn",
      versionEsperada: entrada.versionEsperada,
    });
    if (!resultado.ok) {
      // Perdimos la carrera: no se escribió nada nuestro, así que no hay
      // nada que luego "corregir" — el estado de la otra ejecución queda
      // intacto, que es lo correcto.
      metrica("error", { detalle: "carrera de escritura perdida (versionEsperada obsoleta)" });
      return null;
    }
    metrica("guardado", { validacion: v });
    return { guardadoConfirmadoTrue: v.estado.confirmado === true };
  } catch (err) {
    metrica("error", { detalle: (err as Error).message });
    return null;
  }
}

/**
 * Prioridad 1 (programa de mejora integral, ver el llamador) — deja
 * `conversation_state.estado.confirmado` en `false` cuando el turno que lo
 * marcó `true` terminó SIN cerrar un pedido real. Nunca lanza: es una
 * corrección de higiene sobre un dato que ya se guardó, no puede convertirse
 * en un turno perdido si falla.
 */
async function corregirConfirmadoSinCierre(
  organizationId: string,
  conversationId: string
): Promise<void> {
  try {
    // Se relee justo antes de escribir (no se reutiliza una versión leída
    // hace varios guardarraíles atrás): la ventana entre esta lectura y la
    // escritura de abajo es la más corta posible, pero sigue protegida por
    // `versionEsperada` igual que la escritura principal.
    const fila = await leerEstadoConVersion(conversationId, organizationId);
    if (!fila || !fila.estado.confirmado) return;
    console.warn(
      `[estado] ${organizationId}: el turno terminó sin cerrar un pedido, pero el estado había quedado confirmado:true; se corrige a false.`
    );
    await guardarEstado({
      conversationId,
      organizationId,
      estado: { ...fila.estado, confirmado: false },
      versionEsperada: fila.version,
      actor: "pipeline",
      proceso: "correccion_confirmado_sin_cierre",
    });
  } catch (err) {
    console.error("[estado] no se pudo corregir confirmado sin cierre:", err);
  }
}


/**
 * Cómo debe venir el estado, descrito para el proveedor.
 *
 * Se construye por turno porque depende del negocio: los `datos` son los
 * requisitos que ESE negocio declaró en su ficha, y la `reserva` solo existe
 * en el vertical de citas. Ni un nombre de cliente ni de producto aquí — la
 * forma es del núcleo, el contenido lo pone el catálogo de cada uno.
 */
function esquemaDelEstado(
  requisitos: Requisito[],
  vertical: Vertical,
  modalidadesOfrecidas: readonly string[] = []
): unknown {
  const propiedades: Record<string, unknown> = {
    items: {
      type: "array",
      description: "Una entrada por CADA cosa que pida el cliente, con sus propias opciones.",
      items: {
        type: "object",
        properties: {
          ofrecible: {
            type: ["string", "null"],
            description: "El nombre tal como aparece en el catálogo del negocio.",
          },
          cantidad: { type: ["number", "null"] },
          opciones: {
            type: "array",
            description: "Una entrada por cada elección, en el orden en que las dijo.",
            items: {
              type: "object",
              properties: {
                grupo: { type: ["string", "null"] },
                opcion: { type: ["string", "null"] },
              },
              required: ["grupo", "opcion"],
              additionalProperties: false,
            },
          },
          gruposDeclinados: {
            type: "array",
            description:
              "Nombres de grupos OPCIONALES del catálogo que el cliente dijo explícitamente que NO quiere para esto (ej. \"sin toppings\"). No pongas aquí un grupo que simplemente no se ha mencionado todavía.",
            items: { type: "string" },
          },
        },
        required: ["ofrecible", "cantidad", "opciones", "gruposDeclinados"],
        additionalProperties: false,
      },
    },
    datos: {
      type: "object",
      description: "Lo que este negocio necesita para cerrar. Del pedido entero, no de cada cosa.",
      properties: Object.fromEntries(
        requisitos.map((r) => [r.id, { type: ["string", "null"], description: r.etiqueta }])
      ),
      required: requisitos.map((r) => r.id),
      additionalProperties: false,
    },
    paso: { type: ["string", "number", "null"] },
    confirmado: { type: ["boolean", "null"] },
  };
  /*
   * Solo se declara si el negocio ofrece MÁS DE UNA: con una sola no hay nada
   * que elegir, y pedírsela al modelo sería invitarle a inventar una decisión
   * que el cliente nunca tomó.
   *
   * Va con `enum` a propósito, y no contradice la regla 4 (nada de enums
   * cerrados): los valores no están escritos en el núcleo, salen de la ficha
   * de cada negocio. Lo que se cierra es lo que puede DECIR el modelo sobre
   * una decisión que ya tiene opciones conocidas — y aun así el backend lo
   * vuelve a resolver contra la ficha antes de creérselo.
   */
  if (modalidadesOfrecidas.length > 1) {
    propiedades.modalidadDeEntrega = {
      type: ["string", "null"],
      enum: [...modalidadesOfrecidas, null],
      description: "Cómo eligió el cliente recibir ESTE pedido. null si aún no lo ha dicho.",
    };
  }
  if (contrataCitas(vertical)) {
    propiedades.reserva = {
      type: ["object", "null"],
      description: "UNA sola para toda la visita, aunque lleve varios servicios.",
      properties: {
        fecha: { type: ["string", "null"] },
        hora: { type: ["string", "null"] },
        especialista: { type: ["string", "null"] },
      },
      required: ["fecha", "hora", "especialista"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: propiedades,
    required: Object.keys(propiedades),
    additionalProperties: false,
  };
}

/** Quita las claves en `null` que el modo estricto obliga a emitir. */
function sinNulos(objeto: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== null));
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
  messages: ChatMessage[],
  requisitos: Requisito[] = [],
  vertical: Vertical = "pedidos",
  /** Las que ofrece ESTE negocio; salen de su ficha, no de una lista del núcleo. */
  modalidadesOfrecidas: readonly string[] = [],
  /** Para anotar el Nivel 2 de recuperación (docs/korexia/144/145) cuando se dispare. */
  traza?: TrazaDelTurno
): Promise<{ resultado: ChatJsonResult<AgentActionType>; propuesta?: PropuestaDelModelo }> {
  const EsquemaConEstado = z
    .object({ estado: z.record(z.string(), z.unknown()).optional() })
    .passthrough();

  // Solo memoria entre turnos (Fase 2): lo que de verdad reserva es la
  // acción book_appointment con su propio "servicios[]", no este bloque —
  // ver docs/korexia/88-AUDITORIA-SELECCION-MULTIPLE.md, sección 6 y 8.
  const bloqueReserva =
    vertical === "citas"
      ? ' Si el negocio es de citas, añade también "reserva": {"fecha": …, "hora": …, ' +
        '"especialista": …} con lo que el cliente haya dicho de cuándo y con quién — texto libre, ' +
        "nunca inventes un id. Es UNA sola reserva para toda la visita, aunque \"items\" lleve varios " +
        'servicios ("manos y pies" son dos items, una sola reserva).'
      : "";

  const bruto = await chatJson(EsquemaConEstado, [
    ...messages.slice(0, 1),
    {
      role: "system",
      content:
        'Además de la acción, añade al MISMO objeto JSON una clave "estado" con el pedido tal como va: ' +
        '{"items": [{"ofrecible": …, "cantidad": …, "opciones": [{"grupo": …, "opcion": …}]}], ' +
        `"datos": {${requisitos.map((r) => `"${r.id}": …`).join(", ")}}, ` +
        '"paso": …, "confirmado": false}.' +
        bloqueReserva +
        " " +
        /*
         * `items` es una LISTA porque un cliente pide varias cosas de una vez.
         * Se insiste en el texto y no solo en el esquema: el primer cliente real
         * que probó esto pidió dos cosas en un mensaje, y el agente acabó
         * preguntando por separado las opciones de cada una.
         *
         * ⚠️ Y sin ejemplos con nombres: los de un negocio concreto no entran en
         * el prompt que comparten todos (regla 1 de 79-ARQUITECTURA-MULTIEMPRESA).
         * El catálogo de cada negocio va aparte, y de ahí saca los suyos.
         */
        'En "items" va UNA ENTRADA POR CADA COSA que pida, con sus propias opciones: ' +
        "si pide dos cosas distintas en el mismo mensaje, son DOS entradas, cada una con lo suyo. " +
        "Nunca juntes las opciones de dos cosas distintas en la misma entrada. " +
        `Como mucho ${MAX_ITEMS}. ` +
        (requisitos.length
          ? `En "datos" va lo que este negocio necesita para cerrar: ` +
            requisitos.map((r) => `${r.id} (${r.etiqueta})`).join(", ") +
            ". Son del pedido entero: se piden UNA vez, aunque lleve varias cosas. "
          : "") +
        'En "opciones" va CADA cosa que el cliente eligió del catálogo para ESE item, una entrada por elección ' +
        'y en el orden en que las dijo: si pide dos veces lo mismo, van DOS entradas. ' +
        '"grupo" es el título bajo el que aparece esa opción en el catálogo: ' +
        "ponlo siempre que puedas, porque el mismo nombre puede estar en dos grupos con precios distintos. " +
        'En "gruposDeclinados" va el nombre de cada grupo OPCIONAL que el cliente rechazó explícitamente ' +
        '("sin toppings", "sin salsa", "ninguno"): una vez que lo diga, NO vuelvas a preguntar por ese grupo ' +
        "en los turnos siguientes. Si el cliente todavía no ha dicho nada de un grupo opcional, no lo pongas " +
        "aquí — eso significa que sigue pendiente, no que lo rechazó. " +
        (modalidadesOfrecidas.length > 1
          ? `Añade también "modalidadDeEntrega" con CÓMO dijo el cliente que quiere recibirlo, ` +
            `usando exactamente uno de estos valores: ${modalidadesOfrecidas.join(", ")}. ` +
            "Es la elección del cliente para ESTE pedido, no lo que el negocio ofrece. " +
            "Si todavía no lo ha dicho, va en null — no lo deduzcas ni lo des por supuesto. "
          : "") +
        "Lo que el cliente aún no haya dicho va en null (o lista vacía). No inventes nada.",
    },
      ...messages.slice(1),
    ],
    // Sin esto el modelo IGNORA la instrucción de arriba: medido el 19-ago-2026
    // sobre `gemini-2.5-flash`, 0 de 3 con el prompt pidiéndolo (incluso con un
    // prompt de tres líneas) contra 3 de 3 con el esquema exigido al proveedor.
    {
      jsonSchema: formatoDeRespuestaConEstado(
        esquemaDelEstado(requisitos, vertical, modalidadesOfrecidas)
      ),
    }
  );

  if (!bruto.ok) return { resultado: bruto as ChatJsonResult<AgentActionType> };

  const { estado, ...accion } = bruto.data as { estado?: unknown };
  /*
   * El modo estricto obliga al modelo a emitir TODOS los campos declarados, así
   * que los que no son de esta acción llegan en `null`. Se quitan antes de
   * validar: para un `z.string().optional()`, `reply: null` no es "sin reply"
   * — es un tipo que no encaja, y rechazaría la acción entera.
   */
  const validada = AgentAction.safeParse(sinNulos(accion));
  if (!validada.success) {
    // Con el nombre del campo, no solo "Required": el mensaje pelado no dice
    // cuál falta, y con doce acciones y el modo estricto emitiendo nulos,
    // adivinarlo cuesta una reproducción entera.
    const detalle =
      validada.error.issues
        .map((i) => `${i.path.join(".") || "(raíz)"} ${i.message}`)
        .join(" · ") || "?";
    const accionRecibida = String((accion as { action?: unknown }).action ?? "(sin action)");
    /*
     * NIVEL 2 de recuperación (docs/korexia/144): un reintento acotado (una
     * sola vez) pidiendo solo la acción corregida, antes de tratar esto
     * como un fallo del proveedor.
     *
     * Hace falta AQUÍ y no basta con los reintentos que ya tiene `chatJson`
     * (arriba, hasta 3): esa llamada valida contra `EsquemaConEstado`
     * (`passthrough`, acepta cualquier cosa) y la da por buena — este
     * rechazo ocurre una capa más arriba, así que sin este reintento el
     * turno se perdía a la primera, sin la red que sí tienen los negocios
     * sin Fase 2. Confirmado en la prueba real contra Lis: "Hola, buenas
     * noches" escaló a una persona el 71% de las veces exactamente por
     * esto (`send_menu` sin `reply`, un campo que hoy ya tiene fallback
     * seguro — ver `actions.ts`).
     */
    console.warn(
      `[agente] la acción con estado no cumple el contrato (${detalle}); reintentando solo la acción`
    );
    const reintento = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: bruto.raw },
      {
        role: "user",
        content: `ALTO. Tu respuesta anterior (acción "${accionRecibida}") no cumplió el contrato: ${detalle}. Repite la MISMA acción, corrigiendo únicamente eso. Responde ÚNICAMENTE el objeto JSON.`,
      },
    ]);
    if (reintento.usage) {
      reintento.usage.tokensIn += bruto.usage?.tokensIn ?? 0;
      reintento.usage.tokensOut += bruto.usage?.tokensOut ?? 0;
      reintento.usage.costUsd += bruto.usage?.costUsd ?? 0;
    }
    if (traza) registrarRecuperacion(traza, 2, reintento.ok);
    // Sin estado: se pierde la propuesta de ESTE turno (preferible a un
    // handoff) — el pedido se retoma con normalidad en el siguiente turno.
    return { resultado: reintento };
  }
  return {
    resultado: { ok: true, data: validada.data, raw: bruto.raw, usage: bruto.usage },
    propuesta: estado as PropuestaDelModelo | undefined,
  };
}
