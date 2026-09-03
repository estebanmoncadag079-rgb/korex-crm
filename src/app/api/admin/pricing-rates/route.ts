import { z } from "zod";
import { parseBody, withPlatformAdmin } from "@/lib/api";
import { crearTarifa, listarTarifas } from "@/server/pricing/rates";

export const dynamic = "force-dynamic";

/**
 * Fase 10C — carga de tarifas REALES de WhatsApp. Sin esto, `pricing_rate`
 * quedaba sin ninguna forma de poblarse fuera de tocar la base a mano: el
 * costo de cada envío se anota siempre en 0 (fail-safe correcto, "nunca
 * inventar una tarifa"), pero alguien tiene que poder cargar la tarifa
 * real una vez Meta la publique (verificada contra el Business Manager,
 * nunca copiada de un agregador no oficial — ver `docs/korexia/153`).
 * Solo superadmin: es un dato que afecta a TODAS las organizaciones.
 */
export const GET = withPlatformAdmin(async () => {
  const rates = await listarTarifas();
  return Response.json({
    rates: rates.map((r) => ({
      id: r.id,
      country: r.country,
      currency: r.currency,
      category: r.category,
      provider: r.provider,
      unitCostUsd: r.unitCostUsd,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      source: r.source,
      sourceUrl: r.sourceUrl,
      notes: r.notes,
    })),
  });
});

const cuerpo = z.object({
  country: z.string().trim().min(1).max(10),
  currency: z.string().trim().length(3),
  category: z.enum(["marketing", "utility", "authentication", "authentication_international", "service"]),
  provider: z.enum(["meta", "ycloud"]),
  unitCostUsd: z.number().nonnegative(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable().optional(),
  source: z.string().trim().min(1).max(80),
  sourceUrl: z.string().url().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const POST = withPlatformAdmin(async (_session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const resultado = await crearTarifa({
    ...body.data,
    effectiveFrom: new Date(body.data.effectiveFrom),
    effectiveTo: body.data.effectiveTo ? new Date(body.data.effectiveTo) : null,
  });
  return Response.json(resultado, { status: 201 });
});
