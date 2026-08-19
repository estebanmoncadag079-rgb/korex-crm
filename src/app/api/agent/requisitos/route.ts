import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { leerFichaAplanada } from "@/server/ai/generador/leer-ficha";
import { aplicarFicha } from "@/server/ai/generador/aplicar";
import { REQUISITOS_DISPONIBLES, type FichaDelNegocio } from "@/server/ai/generador/ficha";

export const dynamic = "force-dynamic";

/**
 * Qué debe recoger el agente antes de cerrar (nombre, hoy). "Ajustar mi
 * agente" → esta pantalla — checkboxes, nada más.
 *
 * Es SOLO la interfaz para editar `ficha.cierre.requisitos`: el catálogo de
 * opciones es fijo (`REQUISITOS_DISPONIBLES`) y el servidor pone `tipo` y
 * `etiqueta`; el cliente únicamente decide qué marcar. La lógica —qué se
 * exige, cuándo, el guardarraíl que lo hace cumplir— sigue entera en
 * `requisitosDe()` y `server/contacts.ts`
 * (docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md).
 *
 * `cierre` vive en la sección `flujo` de la ficha (`leer-ficha.ts:42`), que
 * el cuestionario del cliente NUNCA escribe (`puedeEscribir: ["negocio"]`
 * por defecto en `POST /api/onboarding`) — así que esta es la única puerta
 * para este dato, sin riesgo de que un reenvío del cuestionario lo pise.
 */

const IDS_VALIDOS = new Set(REQUISITOS_DISPONIBLES.map((r) => r.id));

const cuerpo = z.object({
  obligatorios: z
    .array(z.string())
    .refine((ids) => ids.every((id) => IDS_VALIDOS.has(id)), {
      message: "hay un id de requisito que no existe en el catálogo",
    }),
});

async function fichaDe(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select({ ficha: schema.agentProfile.ficha })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return leerFichaAplanada(rows[0]?.ficha);
}

export const GET = withAuth(async (session) => {
  const ficha = await fichaDe(session.organizationId);
  const actuales = new Set(
    (ficha?.cierre?.requisitos ?? []).filter((r) => r.obligatorio).map((r) => r.id)
  );
  return Response.json({
    disponibles: REQUISITOS_DISPONIBLES.map((r) => ({ id: r.id, etiqueta: r.etiqueta })),
    obligatorios: [...actuales],
    sinFicha: !ficha,
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

  const requisitos = REQUISITOS_DISPONIBLES.filter((r) =>
    body.data.obligatorios.includes(r.id)
  ).map((r) => ({ ...r, obligatorio: true }));

  // Sección `flujo`, no `negocio`: nunca choca con lo que el cliente responde
  // en su cuestionario (leer-ficha.ts:42, aplicar.ts "NADIE sobrescribe el
  // objeto entero").
  //
  // `...fichaActual.cierre` conserva `pagoAntesDeLaCita`: son dos pantallas
  // distintas escribiendo dentro de la MISMA sección (`flujo.cierre`), y sin
  // el spread esta pantalla borraría lo que guardó la otra
  // (docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md).
  await aplicarFicha(
    session.organizationId,
    { ...fichaActual, cierre: { ...fichaActual.cierre, requisitos } } as FichaDelNegocio,
    { puedeEscribir: ["flujo"], actor: `user:${session.userId}` }
  );

  return Response.json({ ok: true, obligatorios: requisitos.map((r) => r.id) });
});
