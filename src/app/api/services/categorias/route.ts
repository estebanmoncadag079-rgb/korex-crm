import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  appointmentsEnabledFor,
  renombrarCategoria,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

/**
 * Renombrar o eliminar una categoría del catálogo, en lote.
 *
 * No hay `GET`: las categorías **no son una entidad**, son el valor que
 * comparten varios servicios, y la pantalla las deduce de los servicios que ya
 * carga. Tampoco hay `POST`: una categoría nace cuando un servicio la usa
 * (`POST /api/services` o `PATCH /api/services/[id]`), no antes — una categoría
 * vacía no se podría ni mostrar.
 *
 * `hasta: null` la elimina: los servicios que la tenían se quedan sin
 * categoría. **Nunca borra un servicio.**
 *
 * La organización sale SIEMPRE de la sesión, y `renombrarCategoria` la aplica
 * en el `where`: un negocio no puede tocar las categorías de otro aunque
 * manipule la petición.
 */
const cuerpo = z.object({
  desde: z.string().trim().min(1).max(60),
  hasta: z.string().trim().min(1).max(60).nullable(),
});

export const PATCH = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const { desde, hasta } = body.data;
  if (hasta !== null && hasta.toLowerCase() === desde.toLowerCase()) {
    return apiError(400, "sin_cambio", "El nombre nuevo es el mismo.");
  }

  const cambiados = await renombrarCategoria(session.organizationId, desde, hasta);
  return Response.json({ cambiados });
});
