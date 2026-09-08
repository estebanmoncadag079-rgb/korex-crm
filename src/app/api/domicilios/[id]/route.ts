import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { actualizarZona, archivarZona } from "@/server/delivery/zonas-config";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(120).optional(),
    feeCents: z.number().int().min(0).optional(),
    activa: z.boolean().optional(),
  })
  .strict();

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const zona = await actualizarZona(
    session.organizationId,
    id,
    body.data,
    `user:${session.userId}`
  );
  // Mismo 404 para "no existe" y "es de otro cliente": nunca se confirma que
  // un id ajeno exista (mismo criterio que el catálogo).
  if (!zona) return apiError(404, "not_found", "Zona no encontrada");
  return Response.json({ zona });
});

/** Archiva la zona — nunca se borra de verdad (ver `archivarZona`). */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await archivarZona(session.organizationId, id, `user:${session.userId}`);
  if (!ok) return apiError(404, "not_found", "Zona no encontrada");
  return Response.json({ archivada: true });
});
