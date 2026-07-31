import { and, eq, gte, sql } from "drizzle-orm";
import type { AiUsage } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Contabilidad de lo que consume cada cliente.
 *
 * La agencia cobra una mensualidad fija, así que su margen depende de un dato
 * que hasta ahora no existía: cuánto cuesta atender a CADA negocio. Aquí se
 * anota cada gasto en el momento en que ocurre.
 *
 * Anotar nunca puede tumbar una conversación: si falla el registro se avisa por
 * consola y se sigue. Perder una línea de contabilidad es molesto; dejar a un
 * cliente sin respuesta por no poder anotarla, inaceptable.
 */

/** Lo que costó una llamada al modelo. Silencioso si no hubo consumo. */
export async function registrarUsoIa(
  organizationId: string,
  usage: AiUsage | undefined,
  ref?: string
): Promise<void> {
  if (!usage || (usage.costUsd === 0 && usage.tokensIn === 0)) return;
  try {
    await getDb()
      .insert(schema.usageEvent)
      .values({
        id: newId("usage"),
        organizationId,
        kind: "ia",
        detail: usage.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costUsd: usage.costUsd.toFixed(10),
        ref: ref ?? null,
      });
  } catch (err) {
    console.warn("[uso] no se pudo anotar el consumo de IA:", err);
  }
}

/**
 * Un mensaje saliente de WhatsApp.
 *
 * Hoy casi todos cuestan 0 (las respuestas dentro de la ventana de 24 h son
 * gratis), pero se anotan igual: contar los mensajes de ahora es lo que
 * permitirá proyectar la factura desde el 1-oct-2026, cuando Meta empiece a
 * cobrarlos todos. Sin este registro, en octubre habría que adivinar.
 */
export async function registrarUsoWhatsapp(input: {
  organizationId: string;
  tipo: string;
  costUsd?: number;
  ref?: string | null;
}): Promise<void> {
  try {
    await getDb()
      .insert(schema.usageEvent)
      .values({
        id: newId("usage"),
        organizationId: input.organizationId,
        kind: "whatsapp",
        detail: input.tipo,
        costUsd: (input.costUsd ?? 0).toFixed(10),
        ref: input.ref ?? null,
      });
  } catch (err) {
    console.warn("[uso] no se pudo anotar el mensaje enviado:", err);
  }
}

export type ResumenUso = {
  organizationId: string;
  llamadasIa: number;
  tokensIn: number;
  tokensOut: number;
  costoIaUsd: number;
  mensajes: number;
  costoWhatsappUsd: number;
  totalUsd: number;
};

/**
 * Consumo por cliente desde una fecha. Una sola consulta agrupada: son datos
 * de cabecera para un panel, no vale hacer una consulta por cliente.
 */
export async function resumenUsoDesde(desde: Date): Promise<ResumenUso[]> {
  const filas = await getDb()
    .select({
      organizationId: schema.usageEvent.organizationId,
      llamadasIa: sql<number>`count(*) filter (where ${schema.usageEvent.kind} = 'ia')`,
      tokensIn: sql<number>`coalesce(sum(${schema.usageEvent.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${schema.usageEvent.tokensOut}), 0)`,
      costoIa: sql<string>`coalesce(sum(${schema.usageEvent.costUsd}) filter (where ${schema.usageEvent.kind} = 'ia'), 0)`,
      mensajes: sql<number>`count(*) filter (where ${schema.usageEvent.kind} = 'whatsapp')`,
      costoWhatsapp: sql<string>`coalesce(sum(${schema.usageEvent.costUsd}) filter (where ${schema.usageEvent.kind} = 'whatsapp'), 0)`,
    })
    .from(schema.usageEvent)
    .where(gte(schema.usageEvent.createdAt, desde))
    .groupBy(schema.usageEvent.organizationId);

  return filas.map((f) => {
    const costoIaUsd = Number(f.costoIa);
    const costoWhatsappUsd = Number(f.costoWhatsapp);
    return {
      organizationId: f.organizationId,
      llamadasIa: Number(f.llamadasIa),
      tokensIn: Number(f.tokensIn),
      tokensOut: Number(f.tokensOut),
      costoIaUsd,
      mensajes: Number(f.mensajes),
      costoWhatsappUsd,
      totalUsd: costoIaUsd + costoWhatsappUsd,
    };
  });
}

/** El consumo de UN cliente desde una fecha (para su propia vista). */
export async function resumenUsoDeCliente(
  organizationId: string,
  desde: Date
): Promise<ResumenUso> {
  const filas = await getDb()
    .select({
      llamadasIa: sql<number>`count(*) filter (where ${schema.usageEvent.kind} = 'ia')`,
      tokensIn: sql<number>`coalesce(sum(${schema.usageEvent.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${schema.usageEvent.tokensOut}), 0)`,
      costoIa: sql<string>`coalesce(sum(${schema.usageEvent.costUsd}) filter (where ${schema.usageEvent.kind} = 'ia'), 0)`,
      mensajes: sql<number>`count(*) filter (where ${schema.usageEvent.kind} = 'whatsapp')`,
      costoWhatsapp: sql<string>`coalesce(sum(${schema.usageEvent.costUsd}) filter (where ${schema.usageEvent.kind} = 'whatsapp'), 0)`,
    })
    .from(schema.usageEvent)
    .where(
      and(
        eq(schema.usageEvent.organizationId, organizationId),
        gte(schema.usageEvent.createdAt, desde)
      )
    );
  const f = filas[0];
  const costoIaUsd = Number(f?.costoIa ?? 0);
  const costoWhatsappUsd = Number(f?.costoWhatsapp ?? 0);
  return {
    organizationId,
    llamadasIa: Number(f?.llamadasIa ?? 0),
    tokensIn: Number(f?.tokensIn ?? 0),
    tokensOut: Number(f?.tokensOut ?? 0),
    costoIaUsd,
    mensajes: Number(f?.mensajes ?? 0),
    costoWhatsappUsd,
    totalUsd: costoIaUsd + costoWhatsappUsd,
  };
}

/** Primer día del mes en curso, que es como se factura. */
export function inicioDelMes(hoy = new Date()): Date {
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
}
