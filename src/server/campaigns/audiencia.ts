import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { contactosElegiblesParaMarketing } from "@/server/contacts";
import { asignarPorPresupuesto, resolverCostosPorLote, type PricingCategory, type PricingProvider, type RateUsada } from "@/server/pricing/rates";

/**
 * Fase 10E — segmentación de audiencia. Espejo del tipo `campaign.audienceFilter`
 * (`schema.ts`, solo anotación de tipo ahí también) — la forma real y su
 * interpretación viven aquí.
 *
 * Todos los modos parten de `contactosElegiblesParaMarketing()` (archivado y
 * opt-out ya excluidos, Fase 3D) — nunca se reconstruye ese filtro: un modo
 * de segmentación acota QUIÉN de los ya elegibles, nunca reintroduce a
 * alguien que esa función ya excluyó.
 */
export type AudienceFilter =
  | { type: "pipeline_stage"; stageIds: string[] }
  | { type: "selected_contacts"; contactIds: string[] }
  | { type: "fixed_count"; limit: number; selectionStrategy: "oldest_first" }
  | { type: "budget"; budgetUsd: number }
  | null;

export type ResultadoAudiencia = {
  contactIds: string[];
  /** Solo en modo "budget": quiénes quedaron fuera por exceder el presupuesto, y cuánto se estimó gastar en total. */
  excluidosPorPresupuesto?: string[];
  totalEstimadoUsd?: number;
};

async function elegiblesOrdenadosPorAntiguedad(organizationId: string) {
  const rows = await contactosElegiblesParaMarketing(organizationId);
  return [...rows].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

/**
 * Resuelve QUÉ contactos exactos recibirán la campaña, según
 * `audienceType`/`audienceFilter`. Nunca confía en los `contactIds` que
 * llegan del frontend más allá de filtrarlos contra la lista de elegibles
 * DE ESTA organización — un id de otro tenant, o de un contacto con
 * opt-out/archivado, simplemente no aparece en el resultado (no es un
 * error, es "0 de esos calificaba").
 */
export async function resolverAudiencia(input: {
  organizationId: string;
  audienceType: string;
  audienceFilter: AudienceFilter;
  /** Solo se usa en modo "budget", para estimar el costo por contacto. */
  category?: PricingCategory;
  provider?: PricingProvider;
}): Promise<ResultadoAudiencia> {
  const base = await elegiblesOrdenadosPorAntiguedad(input.organizationId);

  if (input.audienceType === "pipeline_stage") {
    const filtro = input.audienceFilter;
    if (filtro?.type !== "pipeline_stage" || filtro.stageIds.length === 0) return { contactIds: [] };
    const db = getDb();
    const leads = await db
      .select({ contactId: schema.lead.contactId })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, input.organizationId, inArray(schema.lead.stageId, filtro.stageIds)));
    const idsEnEtapa = new Set(leads.map((l) => l.contactId));
    return { contactIds: base.filter((c) => idsEnEtapa.has(c.id)).map((c) => c.id) };
  }

  if (input.audienceType === "selected_contacts") {
    const filtro = input.audienceFilter;
    if (filtro?.type !== "selected_contacts" || filtro.contactIds.length === 0) return { contactIds: [] };
    const idsSet = new Set(filtro.contactIds);
    return { contactIds: base.filter((c) => idsSet.has(c.id)).map((c) => c.id) };
  }

  if (input.audienceType === "fixed_count") {
    const filtro = input.audienceFilter;
    if (filtro?.type !== "fixed_count" || filtro.limit <= 0) return { contactIds: [] };
    return { contactIds: base.slice(0, filtro.limit).map((c) => c.id) };
  }

  if (input.audienceType === "budget") {
    const filtro = input.audienceFilter;
    if (filtro?.type !== "budget" || filtro.budgetUsd <= 0) return { contactIds: [] };
    const costos = await resolverCostosPorLote(base, input.category ?? "marketing", input.provider ?? "meta");
    const candidatos = base.map((c) => ({ contactId: c.id, costUsd: costos.costoDe(c.phone) }));
    const { incluidos, excluidos, totalUsd } = asignarPorPresupuesto(candidatos, filtro.budgetUsd);
    return { contactIds: incluidos, excluidosPorPresupuesto: excluidos, totalEstimadoUsd: totalUsd };
  }

  // "todos_los_contactos" — comportamiento histórico, sin cambios.
  return { contactIds: base.map((c) => c.id) };
}

export type EstimacionCampana = {
  elegiblesTotal: number;
  seleccionados: number;
  costoEstimadoUsd: number;
  moneda: "USD";
  categoria: PricingCategory;
  /** Fase 10J — una fila por país REAL presente en la audiencia seleccionada (nunca "default" fijo); ver `resolverCostosPorLote`. */
  ratesUsadas: RateUsada[];
};

/**
 * Fase 10F — cuenta + costo estimado ANTES de iniciar, para los tres modos
 * (todos/cantidad/presupuesto) y también para pipeline_stage/selected_contacts.
 * Nunca envía nada — solo lectura. `campaign.estimatedRecipients`/
 * `estimatedCostUsd`/`rateSnapshot` se congelan con este resultado al pasar
 * a `ready` (ver `motor.ts`).
 */
export async function estimarCampana(input: {
  organizationId: string;
  audienceType: string;
  audienceFilter: AudienceFilter;
  category: PricingCategory;
  provider: PricingProvider;
}): Promise<EstimacionCampana> {
  const [base, resultado] = await Promise.all([
    elegiblesOrdenadosPorAntiguedad(input.organizationId),
    resolverAudiencia(input),
  ]);

  // Fase 10J — corrige el hallazgo CRITICAL: antes se estimaba con
  // `phone: null` (país "default" fijo) para todos los modos salvo
  // "budget". Ahora TODOS los modos usan el país REAL de cada
  // seleccionado, agrupado por país único (`resolverCostosPorLote`) — la
  // estimación mostrada al superadmin ya no puede quedar desconectada del
  // costo real que cobrará el envío.
  const seleccionadosSet = new Set(resultado.contactIds);
  const seleccionados = base.filter((c) => seleccionadosSet.has(c.id));
  const costos = await resolverCostosPorLote(seleccionados, input.category, input.provider);
  const costoEstimadoUsd = seleccionados.reduce((acc, c) => acc + costos.costoDe(c.phone), 0);

  return {
    elegiblesTotal: base.length,
    seleccionados: resultado.contactIds.length,
    costoEstimadoUsd,
    moneda: "USD",
    categoria: input.category,
    ratesUsadas: costos.ratesUsadas,
  };
}
