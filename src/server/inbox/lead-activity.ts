import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en el pipeline; si lo tiene, se actualiza su última actividad.
 *
 * En qué etapa nace depende de si la conversación ya estaba empezada:
 *
 * - Lo normal es que escriba primero el cliente → nace en la PRIMERA etapa
 *   ("Nuevo"), y sale de ahí en cuanto el negocio conteste.
 * - Pero el negocio también inicia conversaciones (retomar a un cliente,
 *   responder algo visto en otro sitio). Ahí los mensajes salen ANTES de que
 *   exista el lead: no hay ninguna tarjeta que mover, y cuando el cliente por
 *   fin contesta, el lead nacía en "Nuevo" y se quedaba ahí para siempre,
 *   aunque hubiera una conversación de veinte mensajes. Pasó de verdad
 *   (573005619176, 30-jul-2026: dos mensajes del negocio a las 16:40:13 y el
 *   lead creado a las 16:40:43).
 *
 * Por eso, si el contacto YA tiene mensajes salientes, el lead nace
 * directamente en la segunda etapa: la conversación ya está en marcha y el
 * tablero debe decir la verdad desde el primer momento.
 */
export async function onLeadActivity(
  organizationId: string,
  contactId: string,
  at: Date
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({ lastActivityAt: at, updatedAt: new Date() })
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, existing[0].id)));
    return;
  }

  const arranque = arranqueDelEmbudo(await etapasDe(organizationId));
  if (!arranque) {
    // Sin dos etapas abiertas no hay avance posible: basta la primera que haya.
    const unica = await primeraEtapaAbierta(organizationId);
    if (!unica) return; // pipeline sin etapas abiertas: no hay dónde crear
    await insertarLead(organizationId, contactId, unica, at);
    return;
  }

  const destino = (await yaLeEscribimos(contactId))
    ? arranque.hacia
    : arranque.desde;
  await insertarLead(organizationId, contactId, destino.id, at);
}

/** ¿El negocio ya le había escrito a este contacto? */
async function yaLeEscribimos(contactId: string): Promise<boolean> {
  const filas = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.message.conversationId)
    )
    .where(
      and(
        eq(schema.conversation.contactId, contactId),
        eq(schema.message.direction, "out")
      )
    )
    .limit(1);
  return filas.length > 0;
}

async function primeraEtapaAbierta(
  organizationId: string
): Promise<string | null> {
  const filas = await getDb()
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      and(
        eq(schema.pipelineStage.organizationId, organizationId),
        eq(schema.pipelineStage.kind, "open")
      )
    )
    .orderBy(asc(schema.pipelineStage.position))
    .limit(1);
  return filas[0]?.id ?? null;
}

async function insertarLead(
  organizationId: string,
  contactId: string,
  stageId: string,
  at: Date
): Promise<void> {
  const db = getDb();
  const maxPos = await db
    .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.stageId, stageId)
      )
    );

  await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId,
      position: (maxPos[0]?.max ?? -1) + 1,
      lastActivityAt: at,
    })
    .onConflictDoNothing({ target: [schema.lead.contactId] });
}

/**
 * El embudo se mueve solo (US2): nadie debería arrastrar tarjetas para que el
 * tablero diga la verdad. Las dos funciones de abajo cubren los saltos que el
 * servidor puede afirmar con certeza; los intermedios los decide el agente con
 * `move_stage`, que sí valida contra las etapas reales de la organización.
 *
 * La decisión de A DÓNDE mover va en funciones puras: el cliente puede
 * renombrar, reordenar y agregar etapas desde el tablero, así que nada aquí
 * depende de los nombres sembrados — solo de `kind` y del orden.
 */

export type EtapaEmbudo = {
  id: string;
  position: number;
  kind: "open" | "won" | "lost";
};

/**
 * Las dos primeras etapas abiertas. De la primera sale el lead en cuanto el
 * negocio contesta. Null si el embudo no tiene al menos dos: con una sola
 * columna abierta no hay ningún avance que hacer.
 */
export function arranqueDelEmbudo<T extends EtapaEmbudo>(
  stages: T[]
): { desde: T; hacia: T } | null {
  const abiertas = stages
    .filter((s) => s.kind === "open")
    .sort((a, b) => a.position - b.position);
  const [desde, hacia] = abiertas;
  return desde && hacia ? { desde, hacia } : null;
}

/** Etapa de cierre del embudo. Null si el cliente se quedó sin ancla `won`. */
export function cierreDelEmbudo<T extends EtapaEmbudo>(stages: T[]): T | null {
  return (
    stages
      .filter((s) => s.kind === "won")
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

/**
 * Etapa de enfriamiento: la ancla `lost`, sembrada como "Perdido" y renombrada
 * a "Por recuperar" — el nombre lo pone cada cliente desde el tablero y aquí no
 * se mira nunca, solo el `kind`.
 */
export function enfriamientoDelEmbudo<T extends EtapaEmbudo>(
  stages: T[]
): T | null {
  return (
    stages
      .filter((s) => s.kind === "lost")
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

/** Todas las etapas de la organización, para decidir el destino en memoria. */
async function etapasDe(organizationId: string): Promise<EtapaEmbudo[]> {
  const db = getDb();
  return db
    .select({
      id: schema.pipelineStage.id,
      position: schema.pipelineStage.position,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
}

/**
 * El negocio contestó (agente, persona desde el CRM o eco del celular): el lead
 * deja de ser "nuevo" y pasa a la siguiente etapa abierta.
 *
 * Solo avanza DESDE la primera etapa — el filtro va en el WHERE, así que quien
 * ya está más adelante no retrocede y un lead cerrado no se reabre por un
 * mensaje suelto. Sin lectura previa del lead: una sola sentencia, sin carreras.
 */
export async function onLeadReplied(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  const db = getDb();

  const arranque = arranqueDelEmbudo(await etapasDe(organizationId));
  if (!arranque) return false;
  const { desde: primera, hacia: segunda } = arranque;

  const movidos = await db
    .update(schema.lead)
    .set({ stageId: segunda.id, updatedAt: new Date() })
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.contactId, contactId),
        eq(schema.lead.stageId, primera.id)
      )
    )
    .returning({ id: schema.lead.id });
  return movidos.length > 0;
}

/**
 * `onLeadReplied` sin dejar que un fallo ahí tumbe el flujo que lo llama
 * (enviar un mensaje, registrar un eco) — el negocio ya contestó, eso no
 * puede perderse por un error moviendo una tarjeta del embudo. Estaba
 * copiado en `inbox/send.ts` e `inbox/ingest.ts`.
 */
export async function avanzarLeadSilencioso(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  try {
    return await onLeadReplied(organizationId, contactId);
  } catch (err) {
    console.error("[embudo] no se pudo avanzar el lead:", err);
    return false;
  }
}

/**
 * ¿Este mensaje entrante es un comprobante de pago?
 *
 * Se exige que sea una IMAGEN: la marca `[COMPROBANTE]` la escribe el propio
 * sistema al leer la foto (`ai/transcribir.ts`), así que un cliente que teclee
 * esa palabra a mano no mueve su tarjeta.
 */
export function esComprobanteDePago(
  texto: string | null | undefined,
  tipo: string
): boolean {
  if (tipo !== "image") return false;
  return (texto ?? "").includes("[COMPROBANTE]");
}

/**
 * Cierra el lead cuando llega un comprobante de pago (9-ago-2026).
 *
 * Hasta hoy el embudo solo se cerraba si el AGENTE emitía un pedido confirmado.
 * En los negocios donde el equipo atiende a mano —Lis contesta desde el WhatsApp
 * del propio negocio, sin entrar al CRM— el agente no corre nunca, así que la
 * venta se cobraba y se entregaba con la tarjeta parada en "En conversación".
 * Medido el 9-ago: **15 de 51 leads en columnas abiertas tenían comprobante**;
 * el tablero decía 16 clientes cuando había 31.
 *
 * El comprobante es la única señal de venta que llega SOLA, sin depender de que
 * nadie recuerde pulsar nada. No prueba que el pago sea válido —eso lo revisa
 * el equipo— pero sí que la conversación dejó de ser una consulta.
 */
export async function cerrarLeadPorComprobante(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  try {
    return await onLeadWon(organizationId, contactId);
  } catch (err) {
    console.error("[embudo] no se pudo cerrar el lead por comprobante:", err);
    return false;
  }
}

/**
 * Pedido confirmado: el lead pasa a la etapa de cierre (`won`).
 *
 * Es el único salto que pisa cualquier etapa anterior — un pedido cerrado manda
 * sobre lo que dijera el embudo — pero no toca un lead que ya estaba ganado.
 */
export async function onLeadWon(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  const db = getDb();

  const cierre = cierreDelEmbudo(await etapasDe(organizationId));
  if (!cierre) return false; // embudo sin etapa de cierre

  const movidos = await db
    .update(schema.lead)
    .set({
      stageId: cierre.id,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    })
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.contactId, contactId),
        ne(schema.lead.stageId, cierre.id)
      )
    )
    .returning({ id: schema.lead.id });
  return movidos.length > 0;
}

/**
 * Días sin respuesta del cliente tras los que su tarjeta se da por enfriada.
 *
 * Dos, y es a propósito: en comida y en peluquería se compra por antojo o por
 * necesidad inmediata, así que a las 48 h de silencio ya hay que ir a buscar a
 * esa persona. Medido el 9-ago-2026 sobre 68 tarjetas en columnas abiertas: con
 * 15 días no se habría movido ninguna y la regla no habría servido de nada; con
 * 2 días se mueven 49.
 */
export const DIAS_PARA_ENFRIAR = 2;

/**
 * El silencio también es información: las tarjetas frías bajan a la etapa de
 * enfriamiento para poder ir a recuperarlas.
 *
 * Antes no existía ningún camino automático hacia esa columna — el agente solo
 * la movía si el cliente ANUNCIABA que se iba ("ya compré en otro lado"), que
 * casi nadie hace, y en los negocios atendidos a mano el agente ni corre. Por
 * eso marcaba 0 mientras "En conversación" acumulaba vivos y muertos juntos.
 *
 * Se cuenta desde el último mensaje ENTRANTE, no desde la última actividad: si
 * contara la actividad general, bastaría con que el negocio escribiera para
 * recalentar la tarjeta aunque el cliente nunca contestara — justo al revés de
 * lo que se busca. Un lead que jamás escribió no se enfría: el subconsulta da
 * NULL y la comparación lo deja fuera.
 *
 * Las conversaciones del Laboratorio quedan excluidas: son pruebas, no clientes.
 */
export async function enfriarLeadsInactivos(
  organizationId: string,
  dias = DIAS_PARA_ENFRIAR
): Promise<number> {
  const db = getDb();

  const stages = await etapasDe(organizationId);
  const enfriamiento = enfriamientoDelEmbudo(stages);
  if (!enfriamiento) return 0; // embudo sin ancla de enfriamiento

  const abiertas = stages.filter((s) => s.kind === "open").map((s) => s.id);
  if (abiertas.length === 0) return 0;

  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const movidos = await db
    .update(schema.lead)
    .set({ stageId: enfriamiento.id, updatedAt: new Date() })
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        inArray(schema.lead.stageId, abiertas),
        /*
         * La fecha va como texto ISO con cast explícito: dentro de un `sql`
         * crudo el driver no sabe de qué tipo es el parámetro y un `Date` lo
         * hace reventar al enlazarlo ("Received an instance of Date"). Se
         * compara en UTC a los dos lados, que es como se guardan los timestamps.
         */
        sql`(
          SELECT max(c.last_inbound_at)
            FROM ${schema.conversation} c
           WHERE c.contact_id = ${schema.lead.contactId}
             AND c.is_test = false
        ) < ${corte.toISOString()}::timestamp`
      )
    )
    .returning({ id: schema.lead.id });

  return movidos.length;
}

/**
 * El cliente enfriado volvió a escribir: su tarjeta regresa a la conversación.
 *
 * Sin esto, la regla de 2 días sería una trampa: alguien que pregunta el lunes,
 * se enfría el miércoles y vuelve el jueves a pedir se quedaría en "Por
 * recuperar" mientras compra. Cuanto más corto el umbral, más falta hace.
 *
 * Solo revive desde la etapa de enfriamiento —el filtro va en el WHERE—, así
 * que **un lead ganado que escribe de nuevo sigue siendo cliente**: esa era la
 * razón original de que un lead cerrado no se reabriera, y se respeta.
 */
export async function reactivarLeadPorMensaje(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  const db = getDb();

  const stages = await etapasDe(organizationId);
  const enfriamiento = enfriamientoDelEmbudo(stages);
  const arranque = arranqueDelEmbudo(stages);
  if (!enfriamiento || !arranque) return false;

  const movidos = await db
    .update(schema.lead)
    .set({ stageId: arranque.hacia.id, updatedAt: new Date() })
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.contactId, contactId),
        eq(schema.lead.stageId, enfriamiento.id)
      )
    )
    .returning({ id: schema.lead.id });

  return movidos.length > 0;
}

/**
 * Enfría las tarjetas de todos los clientes, uno a uno.
 *
 * Cada organización va en su propio `try`: un embudo mal formado (sin ancla de
 * enfriamiento, por ejemplo) no puede dejar sin revisar a los demás negocios.
 */
export async function enfriarLeadsDeTodasLasOrganizaciones(): Promise<number> {
  const db = getDb();
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization);

  let total = 0;
  for (const org of orgs) {
    try {
      total += await enfriarLeadsInactivos(org.id);
    } catch (err) {
      console.error(`[embudo] no se pudo enfriar los leads de ${org.id}:`, err);
    }
  }
  return total;
}

/**
 * `reactivarLeadPorMensaje` sin que un fallo tumbe la ingesta: que llegue el
 * mensaje del cliente importa más que dónde quede su tarjeta.
 */
export async function reactivarLeadSilencioso(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  try {
    return await reactivarLeadPorMensaje(organizationId, contactId);
  } catch (err) {
    console.error("[embudo] no se pudo reactivar el lead:", err);
    return false;
  }
}
