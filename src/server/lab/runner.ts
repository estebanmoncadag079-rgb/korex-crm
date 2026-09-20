import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import type { AgentActionType } from "@/server/ai/actions";
import {
  businessStatus,
  horaHabilDePrueba,
  nowForBusiness,
  renderKb,
  type CatalogEntry,
} from "@/server/ai/prompts";
import { catalogoParaPrompt } from "@/server/appointments/queries";
import { catalogoDePedidos } from "@/server/catalog/queries";
import { renderCatalogoDePedidos } from "@/server/catalog/render";
import { computeScore, judgeCase } from "@/server/lab/judge";
import {
  concretarPersona,
  elegirRespuesta,
  personasPara,
  reglasDe,
  type Persona,
  type RespuestaReactiva,
  type ServicioDelCatalogo,
} from "@/server/lab/personas";
import type { TranscriptLine } from "@/lib/types";
import { horarioDeLaFila, type HorarioSemanal } from "@/server/horario";

/**
 * Runner del Laboratorio (FR-030/FR-034): corrida en segundo plano DENTRO del
 * proceso (sin cola externa), turnos secuenciales con debounce 0, timeout
 * global de 10 minutos, y lock de concurrencia por índice parcial UNIQUE en
 * BD (máx. 1 corrida `running` por organización).
 *
 * Sandbox (FR-031): las conversaciones se crean con is_test=true; el pipeline
 * del agente persiste las respuestas sin tocar la API, y el sender real lanza
 * si algo intenta enviarlas.
 */

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export class RunConflictError extends Error {}

/**
 * Qué clase de negocio es, para elegir los guiones.
 *
 * Es el mismo interruptor que enciende las acciones de citas en el agente: si
 * puede agendar, se le prueba agendando.
 */
async function verticalDe(organizationId: string): Promise<"pedidos" | "citas"> {
  const rows = await getDb()
    .select({ citas: schema.agentProfile.appointmentsEnabled })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0]?.citas ? "citas" : "pedidos";
}

export async function startRun(organizationId: string): Promise<string> {
  const db = getDb();
  let runId: string;
  try {
    const inserted = await db
      .insert(schema.agentTestRun)
      .values({ id: newId("testRun"), organizationId, status: "running" })
      .returning();
    runId = inserted[0]!.id;
  } catch (err) {
    // Violación del índice parcial UNIQUE → ya hay una corrida activa.
    if (isUniqueViolation(err)) {
      throw new RunConflictError("Ya hay una corrida en curso");
    }
    throw err;
  }

  await db.insert(schema.agentTestCase).values(
    personasPara(await verticalDe(organizationId)).map((p) => ({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: p.key,
      status: "pending" as const,
    }))
  );

  // Fire-and-forget in-process: el POST regresa ya; el progreso va por SSE.
  void executeRun(runId, organizationId).catch(async (err) => {
    console.error("[lab] corrida falló:", err);
    await failRun(runId, organizationId, String(err));
  });

  return runId;
}

async function executeRun(
  runId: string,
  organizationId: string
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("timeout de 10 minutos superado")),
      RUN_TIMEOUT_MS
    )
  );
  try {
    await Promise.race([runAllCases(runId, organizationId), timeout]);
  } catch (err) {
    await failRun(runId, organizationId, String(err));
  }
}

async function runAllCases(
  runId: string,
  organizationId: string
): Promise<void> {
  const db = getDb();
  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId))
    .orderBy(asc(schema.agentTestCase.createdAt));

  const kbEntries = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  const kbText = renderKb(kbEntries);

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];

  /**
   * Reloj de la corrida: una hora de atención, la misma para las seis
   * conversaciones y para el juez. Los guiones son de compra, y con el reloj
   * de producción una corrida nocturna medía otra cosa — el agente reagendaba
   * para el día siguiente, con razón, y el juez lo leía como desvío.
   */
  // El mismo horario canónico que ve el agente en producción: si el
  // Laboratorio leyera otro, mediría un negocio que no existe.
  const horario = horarioDeLaFila(profile ?? {});
  const labNow = horaHabilDePrueba(horario);

  // El juez necesita el mismo catálogo que vio el agente, o lee un
  // book_appointment/consult_availability como algo inventado.
  const catalog: CatalogEntry[] = profile?.appointmentsEnabled
    ? await catalogoParaPrompt(organizationId)
    : [];
  const appointments = profile?.appointmentsEnabled ? { catalog } : undefined;

  /**
   * Lo mismo para PEDIDOS (Problema A, docs de la corrección de Malía):
   * hasta hoy el juez de un negocio de pedidos no recibía ningún catálogo
   * real, solo `kbText`/`behaviorText` — así que una respuesta del agente
   * perfectamente correcta contra la base real (precio, sabor, topping) no
   * tenía con qué confirmarse, y quedaba marcada "alucinación" por defecto.
   *
   * Se reutiliza el MISMO texto que ya arma el agente en su propio prompt
   * (`renderCatalogoDePedidos`, `pipeline.ts:737`) — nada de un catálogo
   * paralelo para el juez: es la misma verdad, no una segunda copia que
   * pueda desalinearse.
   */
  let pedidosCatalog: string | undefined;
  if (!profile?.appointmentsEnabled && profile?.catalogSource === "tabla") {
    const productos = await catalogoDePedidos(organizationId);
    if (productos.length > 0) pedidosCatalog = renderCatalogoDePedidos(productos);
  }

  const behaviorTextBase = profile
    ? [
        `Nombre: ${profile.name}`,
        profile.tone ? `Tono: ${profile.tone}` : null,
        profile.instructions ? `Instrucciones: ${profile.instructions}` : null,
        profile.escalationRules ? `Escalado: ${profile.escalationRules}` : null,
        profile.greeting ? `Saludo configurado: ${profile.greeting}` : null,
        estadoParaElJuez(horario, labNow),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  let done = 0;
  const total = cases.length;
  publishProgress(organizationId, runId, "running", done, total);

  for (const testCase of cases) {
    // Los guiones son los del vertical del negocio: un salón se prueba
    // agendando, no pidiendo domicilios.
    const guion = personasPara(
      profile?.appointmentsEnabled ? "citas" : "pedidos"
    ).find((p) => p.key === testCase.persona);
    if (!guion) continue;

    /*
     * La clienta pide un servicio REAL de este salón, por su nombre.
     *
     * Nadie entra a un salón diciendo "deme lo más pedido": va por las uñas o
     * por las pestañas, y lo dice. Con guiones genéricos el agente nunca tenía
     * que reconocer un servicio en una frase — que es la mitad de su trabajo.
     */
    const servicios: ServicioDelCatalogo[] = catalog.map((c) => ({
      name: c.name,
      category: c.category,
      priceCents: c.priceCents,
    }));
    const persona = concretarPersona(guion, servicios);

    await db
      .update(schema.agentTestCase)
      .set({ status: "running" })
      .where(eq(schema.agentTestCase.id, testCase.id));

    const { transcript, conversationId } = await runConversation(
      organizationId,
      persona,
      labNow,
      servicios
    );

    const behaviorText = [behaviorTextBase, hechoTelefonoConocido(persona.phone)]
      .filter(Boolean)
      .join("\n");

    const outcome = await judgeCase({
      personaKey: persona.key,
      transcript,
      kbText,
      behaviorText,
      appointments,
      pedidosCatalog,
    });

    await db
      .update(schema.agentTestCase)
      .set({
        conversationId,
        transcript,
        status: outcome.status,
        veredicto: outcome.status === "done" ? outcome.verdict.veredicto : null,
        hallazgos: outcome.status === "done" ? outcome.verdict.hallazgos : null,
      })
      .where(eq(schema.agentTestCase.id, testCase.id));

    done += 1;
    publishProgress(organizationId, runId, "running", done, total);
  }

  const finalCases = await db
    .select({
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
    })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId));
  const score = computeScore(finalCases);

  await getDb()
    .update(schema.agentTestRun)
    .set({ status: "done", score, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "done", done, total, score);
}

/**
 * El estado del negocio, en las mismas palabras que lo recibió el agente.
 *
 * Sin esta línea el juez calificaba a ciegas todo lo que dependiera del reloj:
 * leía "reagendamos para mañana" como un desvío cuando era obediencia a un
 * "EL NEGOCIO ESTÁ CERRADO" que él no veía.
 */
function estadoParaElJuez(horario: HorarioSemanal, now: Date): string {
  const estado = businessStatus(horario, now);
  const hora = `ESTADO DEL NEGOCIO durante la simulación: ${nowForBusiness(now)} (formato 24 h)`;
  if (!estado) return `${hora}. Sin horario configurado.`;
  return `${hora}. El negocio estaba ${estado.toUpperCase()} y el agente lo sabía.`;
}

/**
 * El agente recibe el teléfono del contacto como un hecho ya conocido
 * (`fichaDelContacto`, prompts.ts) — nunca lo pregunta ni lo inventa, lo
 * copia. El juez solo ve el transcript, así que un resumen con ese teléfono
 * sin que el cliente lo haya escrito en el chat le parecía un dato salido de
 * la nada. Sin esta línea, usar bien un dato real quedaba marcado como
 * alucinación.
 */
export function hechoTelefonoConocido(phone: string): string {
  return `El sistema ya conocía el teléfono de WhatsApp de este cliente antes del primer mensaje (viene del contacto, no lo escribió en el chat): ${phone}. Que el agente lo use en un resumen o cierre sin que el cliente lo haya repetido es correcto — no es una alucinación.`;
}

/**
 * Traduce una acción del agente a una línea que el juez pueda leer.
 *
 * Sin esto el juez solo veía texto: un "ya te contactan" con handoff REAL le
 * parecía idéntico a una promesa vacía, y marcaba en rojo conversaciones que
 * el agente había resuelto bien. Devuelve null para lo que no aporta nada
 * (una respuesta normal ya se ve en el propio transcript).
 */
function describirAccion(accion: AgentActionType): string | null {
  switch (accion.action) {
    case "handoff":
      return "el agente ESCALÓ la conversación a una persona del equipo (acción ejecutada de verdad: la conversación quedó en atención humana)";
    case "notify_order":
      return "el agente REGISTRÓ el pedido y avisó al equipo por WhatsApp (acción ejecutada de verdad)";
    case "move_stage":
      return `el agente movió el lead a la etapa "${accion.stage}"`;
    case "update_lead":
      return "el agente guardó una nota en la ficha del cliente";
    case "book_appointment":
      return "el agente AGENDÓ la cita de verdad (acción ejecutada, guardada en la base de datos)";
    case "reschedule_appointment":
      return "el agente REPROGRAMÓ la cita de verdad (acción ejecutada, guardada en la base de datos)";
    case "cancel_appointment":
      return "el agente CANCELÓ la cita de verdad (acción ejecutada, guardada en la base de datos)";
    default:
      return null;
  }
}

/**
 * Cuántas veces puede el cliente salirse del guion para contestar una pregunta
 * del agente. El tope no es estético: el agente lee los últimos 20 mensajes, y
 * el guion más largo (6 líneas) más sus respuestas tiene que caber entero ahí
 * — si no, la conversación empieza a olvidar su propio principio.
 */
export const MAX_RESPUESTAS_REACTIVAS = 3;

/** Lo que dice a continuación el cliente simulado, o `null` si ya no tiene nada más que decir. */
export type PasoDelCliente =
  | { tipo: "reactiva"; texto: string; indice: number }
  | { tipo: "script"; texto: string };

/**
 * Decide la siguiente línea del cliente simulado: pura, sin tocar la base de
 * datos ni al agente — así se puede probar el bug de cierre (docs de esta
 * corrección) sin levantar Postgres ni el LLM.
 *
 * La reactiva se evalúa SIEMPRE primero, incluso con el guion ya agotado: el
 * guion de "cliente decidido" termina en una pregunta del cliente ("¿cuánto es
 * el total?"), y la respuesta del agente a ESA pregunta es la que dispara la
 * reactiva que confirma el pedido ("Sí, así está perfecto..."). Antes, en
 * cuanto se acababan las líneas del guion la conversación terminaba sin darle
 * oportunidad de sonar: el pedido parecía no cerrarse nunca, y el rojo era del
 * simulador, no del agente.
 */
export function siguientePasoDelCliente(
  persona: Persona,
  reglas: RespuestaReactiva[],
  estado: {
    siguienteLinea: number;
    reactivas: number;
    usadas: Set<number>;
    ultimaDelAgente: string | null;
  }
): PasoDelCliente | null {
  const reactiva =
    estado.reactivas < MAX_RESPUESTAS_REACTIVAS && estado.ultimaDelAgente
      ? elegirRespuesta(reglas, estado.usadas, estado.ultimaDelAgente)
      : null;
  if (reactiva) return { tipo: "reactiva", texto: reactiva.texto, indice: reactiva.indice };
  if (estado.siguienteLinea < persona.script.length) {
    return { tipo: "script", texto: persona.script[estado.siguienteLinea]! };
  }
  return null; // ni guion pendiente ni una reactiva que aplique: nada más que decir
}

/** Conversa el guion completo contra el agente real; corta al primer handoff. */
async function runConversation(
  organizationId: string,
  persona: Persona,
  labNow: Date,
  /** El catálogo del negocio: las respuestas reactivas también nombran servicios. */
  catalogo: ServicioDelCatalogo[]
): Promise<{
  transcript: TranscriptLine[];
  conversationId: string;
}> {
  const db = getDb();

  // Contacto sintético ARCHIVADO (no aparece en la lista ni genera leads).
  const contactId = await upsertTestContact(organizationId, persona);

  const convId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  // Acciones ejecutadas, con el punto del transcript donde ocurrieron.
  const acciones: { trasMensajes: number; texto: string }[] = [];

  const reglas = reglasDe(persona, catalogo);
  const usadas = new Set<number>();
  let siguienteLinea = 0;
  let reactivas = 0;
  let ultimaDelAgente: string | null = null;

  for (;;) {
    const paso = siguientePasoDelCliente(persona, reglas, {
      siguienteLinea,
      reactivas,
      usadas,
      ultimaDelAgente,
    });
    if (!paso) break;
    const line = paso.texto;
    if (paso.tipo === "reactiva") {
      usadas.add(paso.indice);
      reactivas += 1;
    } else {
      siguienteLinea += 1;
    }

    const now = new Date();
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: convId,
      direction: "in",
      type: "text",
      text: line,
      status: "delivered",
      waTimestamp: now,
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, convId));

    // Turno REAL del agente, secuencial y sin debounce (FR-030).
    const accion = await runAgentTurn(convId, { now: labNow });
    ultimaDelAgente = textoAlCliente(accion);
    const nota = accion ? describirAccion(accion) : null;
    if (nota) {
      const conteo = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.message)
        .where(eq(schema.message.conversationId, convId));
      acciones.push({ trasMensajes: conteo[0]?.n ?? 0, texto: nota });
    }

    const convRows = await db
      .select({ handoffAt: schema.conversation.handoffAt })
      .from(schema.conversation)
      .where(eq(schema.conversation.id, convId))
      .limit(1);
    if (convRows[0]?.handoffAt) break; // primer handoff → fin del guion
  }

  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, convId))
    .orderBy(asc(schema.message.createdAt));

  // Se intercalan las acciones en su sitio, no al final: al juez le importa
  // que el escalado ocurriera DESPUÉS del mensaje que lo motivó.
  const transcript: TranscriptLine[] = [];
  messages.forEach((m, i) => {
    if (m.text) {
      transcript.push({
        role: m.direction === "in" ? "cliente" : "agente",
        text: m.text,
      });
    }
    for (const a of acciones) {
      if (a.trasMensajes === i + 1) {
        transcript.push({ role: "sistema", text: a.texto });
      }
    }
  });

  return { conversationId: convId, transcript };
}

/** Lo que el cliente alcanzó a LEER del turno, sea cual sea la acción. */
function textoAlCliente(accion: AgentActionType | null): string | null {
  if (!accion) return null;
  switch (accion.action) {
    case "reply":
      return accion.text;
    case "update_lead":
    case "move_stage":
      return accion.reply ?? null;
    case "handoff":
    case "notify_order":
    case "book_appointment":
    case "reschedule_appointment":
    case "cancel_appointment":
      return accion.farewell ?? null;
    default:
      return null;
  }
}

async function upsertTestContact(
  organizationId: string,
  persona: Persona
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: persona.phone,
      name: persona.contactName,
      archivedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.phone],
    })
    .returning();
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, persona.phone)
      )
    )
    .limit(1);
  return rows[0]!.id;
}

async function failRun(
  runId: string,
  organizationId: string,
  error: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentTestRun)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  // Los dos verticales tienen el mismo número de guiones: para el total de una
  // corrida fallida da igual cuál sea.
  publishProgress(organizationId, runId, "failed", 0, personasPara("pedidos").length);
}

function publishProgress(
  organizationId: string,
  runId: string,
  status: string,
  done: number,
  total: number,
  score?: number | null
): void {
  publish(organizationId, {
    type: "lab.run",
    data: { runId, status, progress: { done, total }, score },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}
