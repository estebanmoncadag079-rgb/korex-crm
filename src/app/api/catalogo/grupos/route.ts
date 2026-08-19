import { withAuth } from "@/lib/api";
import { listarGruposDeOpciones } from "@/server/catalog/grupos";

export const dynamic = "force-dynamic";

/**
 * Los grupos de opciones del catálogo de ESTA organización.
 *
 * El `organizationId` sale de la sesión y nunca del cliente: no hay forma de
 * pedir los grupos de otro negocio desde aquí.
 */
export const GET = withAuth(async (session) => {
  const grupos = await listarGruposDeOpciones(session.organizationId);
  return Response.json({ grupos });
});
