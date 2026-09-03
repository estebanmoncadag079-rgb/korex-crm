import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { registrarUsoWhatsapp } from "@/server/usage";

/**
 * Fase 10C — tarifa REAL de WhatsApp, versionada por país/categoría/
 * proveedor, leída de `pricing_rate` (nunca de constantes TypeScript). Si no
 * hay ninguna tarifa configurada para una combinación dada, el costo se
 * queda en 0 y `pricingRateId` en `null` — nunca se inventa un número
 * ("NO inventes datos ni tarifas", Fase 10A/10B-10I): es responsabilidad
 * explícita de un superadmin cargar la tarifa real (verificada contra el
 * Business Manager de Meta / la documentación de YCloud) antes de que el
 * costo aparezca en los reportes.
 */

export type PricingCategory =
  | "marketing"
  | "utility"
  | "authentication"
  | "authentication_international"
  | "service";

export type PricingProvider = "meta" | "ycloud";

export type PricingRateRow = typeof schema.pricingRate.$inferSelect;

/**
 * Prefijos de código de país (E.164, sin "+") → ISO 3166-1 alpha-2. Es un
 * estándar público (no una tarifa, no un dato que "se pueda inventar mal")
 * — cubre los mercados reales de Korex.IA hoy (Colombia) más un conjunto
 * razonable de vecinos; cualquier prefijo no listado cae en `"default"`,
 * que es exactamente el comportamiento correcto cuando no se puede
 * identificar el país con certeza.
 */
const PREFIJOS_PAIS: Array<{ prefijo: string; iso: string }> = [
  { prefijo: "57", iso: "CO" },
  { prefijo: "1", iso: "US" },
  { prefijo: "52", iso: "MX" },
  { prefijo: "54", iso: "AR" },
  { prefijo: "56", iso: "CL" },
  { prefijo: "51", iso: "PE" },
  { prefijo: "34", iso: "ES" },
  { prefijo: "34", iso: "ES" },
  { prefijo: "58", iso: "VE" },
  { prefijo: "593", iso: "EC" },
  { prefijo: "507", iso: "PA" },
];

/** Ordenados por longitud de prefijo descendente para no confundir "1" (US) con "593" (EC), etc. */
const PREFIJOS_ORDENADOS = [...PREFIJOS_PAIS].sort((a, b) => b.prefijo.length - a.prefijo.length);

/** Deriva el país (ISO alpha-2) de un teléfono E.164 sin "+". `"default"` si no se reconoce el prefijo. */
export function paisDeTelefono(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "default";
  for (const { prefijo, iso } of PREFIJOS_ORDENADOS) {
    if (digits.startsWith(prefijo)) return iso;
  }
  return "default";
}

/**
 * Busca la tarifa vigente en `at` para country+category+provider. Si no hay
 * ninguna para ese país exacto, cae a `country = "default"` — nunca inventa
 * un valor intermedio. `null` si tampoco hay una tarifa por defecto
 * configurada: el llamante debe tratar eso como "costo desconocido, no
 * asumir 0 con falsa certeza" a nivel de reporte (aunque a nivel de
 * registro contable el evento igual se anota con costo 0, ver `usage.ts`).
 */
export async function resolverTarifa(input: {
  country: string;
  category: PricingCategory;
  provider: PricingProvider;
  at?: Date;
}): Promise<PricingRateRow | null> {
  const at = input.at ?? new Date();
  const db = getDb();

  async function buscar(country: string): Promise<PricingRateRow | null> {
    const rows = await db
      .select()
      .from(schema.pricingRate)
      .where(
        and(
          eq(schema.pricingRate.country, country),
          eq(schema.pricingRate.category, input.category),
          eq(schema.pricingRate.provider, input.provider),
          lte(schema.pricingRate.effectiveFrom, at),
          or(isNull(schema.pricingRate.effectiveTo), gte(schema.pricingRate.effectiveTo, at))
        )
      )
      .orderBy(desc(schema.pricingRate.effectiveFrom))
      .limit(1);
    return rows[0] ?? null;
  }

  return (await buscar(input.country)) ?? (await buscar("default"));
}

/** "UTILITY"/"MARKETING" (categoría de `template`) → categoría de tarifa de Meta. Cualquier otro valor cae en "utility" — el más conservador: nunca sobreestima como "marketing" sin certeza. Centralizado (antes duplicado en `templates.ts` y `campaigns/worker.ts`). */
export function categoriaDeTarifaDesdeTemplate(category: string | null | undefined): PricingCategory {
  return (category ?? "").toUpperCase() === "MARKETING" ? "marketing" : "utility";
}

export type CostoWhatsapp = {
  costUsd: number;
  korexPriceUsd: number | null;
  marginUsd: number | null;
  pricingRateId: string | null;
  country: string;
  category: PricingCategory;
};

/**
 * Resuelve el costo REAL de un envío — nunca lanza, nunca inventa: sin
 * tarifa configurada, `costUsd = 0` y `pricingRateId = null` (visible en el
 * registro como "sin tarifa", no como "gratis con certeza"). `margenTantoPorUno`
 * es opcional (0-0.99); sin él, `korexPriceUsd`/`marginUsd` quedan `null` —
 * el precio al cliente es una decisión de negocio que no se asume aquí.
 */
export async function calcularCostoWhatsapp(input: {
  provider: PricingProvider;
  category: PricingCategory;
  phone?: string | null;
  /** Fase 10J — si se pasa, tiene prioridad sobre derivar el país de `phone` (evita recalcular cuando el llamante ya agrupó por país, ver `resolverCostosPorLote`). */
  country?: string;
  margenTantoPorUno?: number;
  at?: Date;
}): Promise<CostoWhatsapp> {
  const country = input.country ?? paisDeTelefono(input.phone);
  const tarifa = await resolverTarifa({ country, category: input.category, provider: input.provider, at: input.at });
  if (!tarifa) {
    return { costUsd: 0, korexPriceUsd: null, marginUsd: null, pricingRateId: null, country, category: input.category };
  }
  const costUsd = Number(tarifa.unitCostUsd);
  if (input.margenTantoPorUno === undefined) {
    return { costUsd, korexPriceUsd: null, marginUsd: null, pricingRateId: tarifa.id, country, category: input.category };
  }
  const margen = Math.min(Math.max(input.margenTantoPorUno, 0), 0.99);
  const korexPriceUsd = costUsd / (1 - margen);
  return {
    costUsd,
    korexPriceUsd,
    marginUsd: korexPriceUsd - costUsd,
    pricingRateId: tarifa.id,
    country,
    category: input.category,
  };
}

export type RateUsada = { pricingRateId: string; category: PricingCategory; country: string; unitCostUsd: string };

export type CostosPorLote = {
  /** Costo del país real de ESTE contacto — nunca "default" fijo. */
  costoDe: (phone: string | null | undefined) => number;
  /** Las tarifas realmente usadas (una por país distinto en el lote), para congelar en `campaign.rateSnapshot`. */
  ratesUsadas: RateUsada[];
};

/**
 * Fase 10J (autoauditoría) — corrige el hallazgo CRITICAL: la estimación
 * de costo antes de aprobar una campaña calculaba con `phone: null` (→
 * `country: "default"` siempre), nunca con el país real de cada
 * destinatario. Si el superadmin solo había cargado la tarifa de
 * Colombia (`country: "CO"`, el mercado real de Korex.IA) y no una fila
 * redundante `"default"`, la estimación mostraba `$0` mientras el envío
 * real — que sí resuelve el teléfono real de cada contacto — cobraba un
 * costo distinto de cero. El superadmin aprobaba un número desconectado
 * del costo real.
 *
 * En vez de resolver la tarifa contacto por contacto (N consultas, lento a
 * escala), agrupa por país ÚNICO en el lote — normalmente 1-2 países
 * distintos incluso con miles de contactos — y resuelve cada uno una sola
 * vez. Corrige el bug Y el problema de rendimiento ya señalado en la
 * documentación de esta fase a la vez.
 */
export async function resolverCostosPorLote(
  contactos: Array<{ phone: string | null }>,
  category: PricingCategory,
  provider: PricingProvider
): Promise<CostosPorLote> {
  const paisesUnicos = [...new Set(contactos.map((c) => paisDeTelefono(c.phone)))];
  const porPais = new Map<string, CostoWhatsapp>();
  for (const country of paisesUnicos) {
    porPais.set(country, await calcularCostoWhatsapp({ provider, category, country }));
  }
  const ratesUsadas: RateUsada[] = [];
  for (const c of porPais.values()) {
    if (c.pricingRateId) {
      ratesUsadas.push({ pricingRateId: c.pricingRateId, category, country: c.country, unitCostUsd: c.costUsd.toFixed(10) });
    }
  }
  return {
    costoDe: (phone) => porPais.get(paisDeTelefono(phone))?.costUsd ?? 0,
    ratesUsadas,
  };
}

/**
 * Calcula el costo REAL y lo registra en `usage_event`, todo en un solo
 * fail-safe: un problema resolviendo la tarifa (base caída, dato mal
 * formado) nunca puede tumbar un envío de WhatsApp que ya salió — es
 * exactamente el mismo criterio que ya usa `registrarUsoWhatsapp()` por su
 * cuenta, extendido aquí para cubrir también el cálculo de costo que ahora
 * lo precede. Único punto que los call sites de envío (`send.ts`,
 * `templates.ts`, `campaigns/worker.ts`) deben llamar — evita duplicar el
 * try/catch en cada uno.
 */
export async function registrarEnvioWhatsappConCosto(input: {
  organizationId: string;
  tipo: string;
  ref: string;
  provider: "ycloud" | "graph";
  category: PricingCategory;
  phone: string | null | undefined;
  campaignId?: string | null;
  recipientId?: string | null;
}): Promise<void> {
  try {
    const costo = await calcularCostoWhatsapp({
      provider: input.provider === "ycloud" ? "ycloud" : "meta",
      category: input.category,
      phone: input.phone,
    });
    await registrarUsoWhatsapp({
      organizationId: input.organizationId,
      tipo: input.tipo,
      ref: input.ref,
      provider: input.provider,
      category: input.category,
      country: costo.country,
      costUsd: costo.costUsd,
      pricingRateId: costo.pricingRateId,
      campaignId: input.campaignId,
      recipientId: input.recipientId,
    });
  } catch (err) {
    console.warn("[pricing] no se pudo calcular/registrar el costo del envío:", err);
  }
}

/** Carga una tarifa nueva — nunca sobreescribe una vigente: quien llama debe cerrar la anterior (`effectiveTo`) explícitamente si corresponde. Solo superadmin (gate en la capa de API). */
export async function crearTarifa(input: {
  country: string;
  currency: string;
  category: PricingCategory;
  provider: PricingProvider;
  unitCostUsd: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  source: string;
  sourceUrl?: string | null;
  notes?: string | null;
}): Promise<{ id: string }> {
  const db = getDb();
  const id = newId("pricingRate");
  await db.insert(schema.pricingRate).values({
    id,
    country: input.country,
    currency: input.currency,
    category: input.category,
    provider: input.provider,
    unitCostUsd: input.unitCostUsd.toFixed(10),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    notes: input.notes ?? null,
  });
  return { id };
}

/** Cierra la vigencia de una tarifa (`effectiveTo = hasta`), sin borrarla — el historial de costos ya calculados sigue siendo reconstruible. */
export async function cerrarVigenciaTarifa(id: string, hasta: Date): Promise<void> {
  const db = getDb();
  await db.update(schema.pricingRate).set({ effectiveTo: hasta, updatedAt: new Date() }).where(eq(schema.pricingRate.id, id));
}

export async function listarTarifas(): Promise<PricingRateRow[]> {
  const db = getDb();
  return db.select().from(schema.pricingRate).orderBy(desc(schema.pricingRate.effectiveFrom));
}

/**
 * Fase 10F, modo presupuesto — acumula candidatos hasta no superar el
 * presupuesto, sin arrastre de error de coma flotante: la suma se hace en
 * unidades ENTERAS de 10⁻¹⁰ USD (mismo precision que la columna `numeric
 * (14,10)`), usando `BigInt`, y solo se convierte a `number` al final para
 * el resultado. El orden de los candidatos lo decide el llamante
 * (`selectionStrategy`) — esta función nunca reordena.
 */
export function asignarPorPresupuesto(
  candidatos: Array<{ contactId: string; costUsd: number }>,
  budgetUsd: number
): { incluidos: string[]; excluidos: string[]; totalUsd: number } {
  const ESCALA = 10_000_000_000n; // 10^10 — mismo precision que numeric(14,10)
  const presupuesto = BigInt(Math.round(budgetUsd * Number(ESCALA)));
  let acumulado = 0n;
  const incluidos: string[] = [];
  const excluidos: string[] = [];
  for (const c of candidatos) {
    const costo = BigInt(Math.round(c.costUsd * Number(ESCALA)));
    if (acumulado + costo <= presupuesto) {
      acumulado += costo;
      incluidos.push(c.contactId);
    } else {
      excluidos.push(c.contactId);
    }
  }
  return { incluidos, excluidos, totalUsd: Number(acumulado) / Number(ESCALA) };
}
