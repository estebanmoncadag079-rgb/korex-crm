import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { crearProducto, listarProductos } from "@/server/catalog/productos";

export const dynamic = "force-dynamic";

/** Los productos de ESTA organización. El id sale de la sesión, nunca del cliente. */
export const GET = withAuth(async (session) => {
  const productos = await listarProductos(session.organizationId);
  return Response.json({ productos });
});

const cuerpo = z
  .object({
    nombre: z.string().min(1).max(200),
    categoria: z.string().max(100).nullable().optional(),
    /** En centavos. Ausente = el negocio no lo sabe aún; el agente lo pedirá. */
    precioCents: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const producto = await crearProducto(
    session.organizationId,
    body.data,
    `user:${session.userId}`
  );
  return Response.json({ producto }, { status: 201 });
});
