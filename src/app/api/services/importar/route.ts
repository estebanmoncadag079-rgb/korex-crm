import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { appointmentsEnabledFor, createService } from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

/**
 * Cargar el catálogo de servicios de golpe.
 *
 * **Por qué existe**: hasta el 13-ago-2026 un negocio de citas solo podía dar
 * de alta sus servicios de uno en uno. El salón tiene 46. Nadie termina eso: se
 * abandona el alta, o se teclea mal — ya pasó, con 12 precios equivocados que
 * no se descubrieron hasta que apareció el PDF oficial.
 *
 * Lo que llega aquí YA lo revisó una persona en pantalla: ni la foto de la
 * carta ni la lista pegada escriben nada por su cuenta. Esa regla no se relaja
 * nunca — un catálogo cargado sin revisar es dinero equivocado repetido en cada
 * conversación durante meses.
 *
 * La `durationMin` es obligatoria y no tiene valor por defecto a propósito: de
 * ella depende que la agenda no se solape. Un servicio de 3 horas cargado como
 * "30 minutos" no da un error en ninguna parte — simplemente hace que el salón
 * acepte tres clientas a la vez.
 */

const fila = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).nullish(),
  priceCents: z.number().int().min(0).max(100_000_000),
  durationMin: z.number().int().min(5).max(600),
});

const cuerpo = z.object({
  // 200 es de sobra para el catálogo más largo visto (46) y pone un techo a lo
  // que una sola petición puede escribir.
  servicios: z.array(fila).min(1).max(200),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const creados = [];
  const fallidos: string[] = [];
  for (const s of body.data.servicios) {
    const row = await createService(session.organizationId, {
      name: s.name,
      category: s.category ?? null,
      priceCents: s.priceCents,
      durationMin: s.durationMin,
    });
    if (row) creados.push(row);
    else fallidos.push(s.name);
  }

  // Se informa de los que fallaron en vez de deshacerlo todo: si 44 de 46
  // entraron, rehacer el trabajo entero es peor remedio que decir cuáles dos
  // faltan para añadirlos a mano.
  return Response.json({ creados, fallidos }, { status: 201 });
});
