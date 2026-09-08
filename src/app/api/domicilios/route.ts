import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { crearZona, listarZonas } from "@/server/delivery/zonas-config";

export const dynamic = "force-dynamic";

/** Las zonas de domicilio de ESTA organización. El id sale de la sesión, nunca del cliente. */
export const GET = withAuth(async (session) => {
  const zonas = await listarZonas(session.organizationId);
  return Response.json({ zonas });
});

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(120),
    /** En centavos. 0 es válido: domicilio gratis a esa zona. */
    feeCents: z.number().int().min(0),
    /**
     * Ausente = queda INACTIVA (ver `crearZona`): una tarifa recién cargada
     * todavía no está revisada, y una zona activa se cotiza al cliente de
     * inmediato.
     */
    activa: z.boolean().optional(),
  })
  .strict();

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const zona = await crearZona(session.organizationId, body.data, `user:${session.userId}`);
  return Response.json({ zona }, { status: 201 });
});
