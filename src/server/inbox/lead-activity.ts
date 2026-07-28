import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en la primera etapa del pipeline; si lo tiene, se actualiza su
 * última actividad.
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
    .where(eq(schema.lead.contactId, contactId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({ lastActivityAt: at, updatedAt: new Date() })
      .where(eq(schema.lead.id, existing[0].id));
    return;
  }

  const firstStage = await db
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
  if (!firstStage[0]) return; // pipeline sin etapas abiertas: no hay dónde crear

  const maxPos = await db
    .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.stageId, firstStage[0].id)
      )
    );

  await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId: firstStage[0].id,
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
