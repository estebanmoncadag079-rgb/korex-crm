import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Requisito } from "@/server/ai/generador/ficha";

export function serializeContact(c: typeof schema.contact.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
}

export async function getContactById(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/* ============================================================
 * Requisitos declarados por el negocio (19-ago-2026)
 * ============================================================
 *
 * El componente que faltaba en la auditoría de
 * docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md: algo que persista un dato
 * capturado en la conversación sin que el ejecutor de una acción de cierre
 * (`book_appointment`, `notify_order`) se vuelva también responsable de
 * guardar datos de contacto — esas dos cosas nunca deben compartir código
 * (Regla 11).
 *
 * `faltantes()` es lectura pura: no sabe de verticales, no depende de
 * `conversation_state`, solo mira `Requisito[]` (de `requisitosDe(ficha)`,
 * ya genérico) contra lo que YA hay en `contact`.
 *
 * `capturar()` es la única función que escribe. El guardarraíl (en
 * `pipeline.ts`) SOLO llama a `faltantes()` — nunca a `capturar()`: valida
 * e interrumpe, no almacena (Regla 10).
 */

/**
 * A qué columna de `contact` corresponde cada requisito, por su `id`
 * declarado. Deliberadamente una lista corta y explícita, no un mapeo por
 * `tipo`: dos requisitos del mismo tipo "texto" pueden significar cosas
 * distintas, y `id` es el identificador estable que ya usa `Requisito`
 * (`ficha.ts:34`).
 *
 * Alcance de hoy: solo "nombre". Ampliar esta lista es la vía para sumar
 * otros requisitos capturables — no tocar `faltantes`/`capturar`.
 */
const CAMPO_DE_REQUISITO: Record<string, "name"> = {
  nombre: "name",
};

export type ContactoParaRequisitos = {
  name: string;
  phone: string | null;
  waUserId: string | null;
};

/**
 * ¿Este contacto ya tiene un nombre REAL, o solo el relleno automático?
 *
 * `contact.name` es `NOT NULL` en el esquema, y cuando no hay nombre de
 * perfil de WhatsApp se rellena con el teléfono o el BSUID
 * (`ingest.ts:156`, `name: name?.trim() || phone || waUserId!`). Sin esta
 * comprobación, "existe `contact.name`" sería SIEMPRE verdadero y el
 * requisito "nombre" nunca se marcaría como faltante — el mismo problema
 * que se está corrigiendo, disfrazado.
 */
export function tieneNombreReal(c: ContactoParaRequisitos): boolean {
  return Boolean(c.name) && c.name !== c.phone && c.name !== c.waUserId;
}

/** ¿Este requisito concreto está satisfecho, mirando el contacto real? */
export function satisfecho(requisito: Requisito, contact: ContactoParaRequisitos): boolean {
  if (requisito.id === "nombre") return tieneNombreReal(contact);
  // El teléfono ya lo da WhatsApp en el 99% de los casos (03-WHATSAPP-Y-YCLOUD.md);
  // solo falta con nombre de usuario sin teléfono visible.
  if (requisito.id === "telefono") return Boolean(contact.phone || contact.waUserId);
  /*
   * Un requisito declarado que el sistema todavía no sabe LEER (email,
   * documento, o cualquier id fuera de CAMPO_DE_REQUISITO) no puede exigirse:
   * bloquear por algo que no se sabe comprobar sería peor que no declararlo.
   * Queda como deuda visible, no oculta — ver docs/korexia/102.
   */
  return true;
}

/**
 * Los requisitos OBLIGATORIOS de este negocio que este contacto todavía no
 * cumple. `[]` si no falta nada (incluido el caso "el negocio no declaró
 * ninguno" — `requisitosDe()` ya filtra eso antes de llegar aquí).
 */
export async function faltantes(input: {
  organizationId: string;
  contactId: string;
  requisitos: Requisito[];
}): Promise<Requisito[]> {
  const obligatorios = input.requisitos.filter((r) => r.obligatorio);
  if (obligatorios.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      name: schema.contact.name,
      phone: schema.contact.phone,
      waUserId: schema.contact.waUserId,
    })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        eq(schema.contact.id, input.contactId)
      )
    )
    .limit(1);
  const contact = rows[0];
  // Sin contacto no hay a quién exigirle nada — no es un caso de "falta el
  // dato", es un caso de "no hay dato que evaluar todavía".
  if (!contact) return [];

  return obligatorios.filter((r) => !satisfecho(r, contact));
}

/**
 * Persiste UN valor que el cliente acaba de dar para UN requisito
 * declarado. Nunca escribe algo que el negocio no declaró, y nunca
 * inventa una columna: si `requisitoId` no tiene destino conocido en
 * `CAMPO_DE_REQUISITO`, se rechaza explícitamente.
 */
export async function capturar(input: {
  organizationId: string;
  contactId: string;
  requisitos: Requisito[];
  requisitoId: string;
  valor: string;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const requisito = input.requisitos.find((r) => r.id === input.requisitoId);
  if (!requisito) {
    return { ok: false, motivo: `"${input.requisitoId}" no está declarado por este negocio` };
  }
  const valor = input.valor.trim();
  if (!valor) return { ok: false, motivo: "el valor llegó vacío" };

  const campo = CAMPO_DE_REQUISITO[requisito.id];
  if (!campo) {
    return {
      ok: false,
      motivo: `el requisito "${requisito.id}" todavía no tiene dónde guardarse`,
    };
  }

  const db = getDb();
  await db
    .update(schema.contact)
    .set({ [campo]: valor, updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        eq(schema.contact.id, input.contactId)
      )
    );
  return { ok: true };
}
