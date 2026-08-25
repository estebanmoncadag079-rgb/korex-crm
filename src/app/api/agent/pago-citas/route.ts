import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { leerFichaAplanada } from "@/server/ai/generador/leer-ficha";
import { aplicarFicha } from "@/server/ai/generador/aplicar";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

export const dynamic = "force-dynamic";

/**
 * ¿Este negocio de citas cobra por adelantado al confirmar? "Ajustar mi
 * agente" → esta pantalla, un único interruptor.
 *
 * Es SOLO la interfaz para editar `ficha.cierre.pagoAntesDeLaCita`
 * (docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md): la lógica —qué le dice el
 * prompt al modelo según este dato— vive en `prompts.ts`. Aquí solo se lee
 * y se escribe el booleano.
 *
 * `cierre` vive en la sección `flujo` (leer-ficha.ts:42). Esta sigue siendo
 * la ÚNICA puerta para `pagoAntesDeLaCita` — a diferencia de `requisitos`,
 * que desde el 25-ago-2026 también se edita como el último paso del
 * cuestionario de alta (`POST /api/onboarding`). Ese paso preserva
 * `pagoAntesDeLaCita` al guardar, mismo motivo por el que esta pantalla
 * preserva `requisitos` más abajo: los dos campos comparten la sección y
 * `fusionarFicha` la fusiona entera, no campo a campo.
 */

async function fichaDe(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select({ ficha: schema.agentProfile.ficha })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return leerFichaAplanada(rows[0]?.ficha);
}

const cuerpo = z.object({ antes: z.boolean() });

export const GET = withAuth(async (session) => {
  const ficha = await fichaDe(session.organizationId);
  return Response.json({
    sinFicha: !ficha,
    // Solo aplica a citas: en pedidos el pago lo maneja CIERRE, de otra forma.
    aplica: ficha?.vertical === "citas",
    antes: ficha?.cierre?.pagoAntesDeLaCita === true,
  });
});

export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const fichaActual = await fichaDe(session.organizationId);
  if (!fichaActual) {
    return apiError(
      409,
      "sin_ficha",
      "Este cliente no tiene ficha (su prompt está escrito a mano): no se puede editar desde aquí."
    );
  }
  if (fichaActual.vertical !== "citas") {
    return apiError(409, "no_aplica", "Este ajuste solo aplica a negocios de citas.");
  }

  // Igual que en el paso de requisitos de `POST /api/onboarding`: el spread
  // de `cierre` conserva `requisitos`, que vive en la MISMA sección y no
  // debe perderse al guardar este interruptor.
  await aplicarFicha(
    session.organizationId,
    {
      ...fichaActual,
      cierre: { ...fichaActual.cierre, requisitos: fichaActual.cierre?.requisitos ?? [], pagoAntesDeLaCita: body.data.antes },
    } as FichaDelNegocio,
    { puedeEscribir: ["flujo"], actor: `user:${session.userId}` }
  );

  return Response.json({ ok: true, antes: body.data.antes });
});
