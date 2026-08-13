import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";

export const dynamic = "force-dynamic";

/**
 * Las fotos que el negocio deja listas para que el agente las envíe.
 *
 * `GET` lista · `POST` sube o reemplaza · `DELETE` borra.
 *
 * La organización sale SIEMPRE de la sesión, nunca del cuerpo: un cliente solo
 * puede tocar sus propias fotos aunque manipule la petición.
 */

/**
 * 4 MB ya en base64 (unos 3 MB de foto). Sobra para una foto de producto y pone
 * un techo al peso de la base, que es donde viven: sin límite, unas cuantas
 * fotos de móvil sin comprimir engordarían el respaldo de cada 6 h.
 */
const MAX_BASE64 = 4_000_000;

const TIPOS = ["image/jpeg", "image/png", "image/webp"];

const cuerpo = z.object({
  /** Cómo la nombra el negocio: es lo que el agente compara. */
  etiqueta: z.string().min(1).max(80),
  kind: z.enum(["producto", "carta", "otro"]),
  base64: z.string().min(1).max(MAX_BASE64),
  mimeType: z.string().min(1),
});

export const GET = withAuth(async (session) => {
  const db = getDb();
  const fotos = await db
    .select({
      id: schema.mediaAsset.id,
      etiqueta: schema.mediaAsset.etiqueta,
      kind: schema.mediaAsset.kind,
      tamano: schema.mediaAsset.tamano,
      createdAt: schema.mediaAsset.createdAt,
    })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.organizationId, session.organizationId));
  return Response.json({ fotos });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const mime = body.data.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!TIPOS.includes(mime)) {
    return apiError(
      415,
      "tipo_no_soportado",
      "La foto debe ser JPG, PNG o WEBP."
    );
  }

  const db = getDb();
  const etiqueta = body.data.etiqueta.trim();
  const tamano = Math.floor((body.data.base64.length * 3) / 4);

  // Subir otra foto con la misma etiqueta REEMPLAZA: si el negocio cambia la
  // foto de un producto, no debe quedar la vieja compitiendo con la nueva —
  // el agente no sabría cuál mandar.
  const existente = await db
    .select({ id: schema.mediaAsset.id })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, session.organizationId),
        eq(schema.mediaAsset.etiqueta, etiqueta)
      )
    )
    .limit(1);

  if (existente[0]) {
    await db
      .update(schema.mediaAsset)
      .set({
        kind: body.data.kind,
        mimeType: mime,
        datos: body.data.base64,
        tamano,
      })
      .where(eq(schema.mediaAsset.id, existente[0].id));
    return Response.json({ id: existente[0].id, etiqueta, reemplazada: true });
  }

  const id = newId("mediaAsset");
  await db.insert(schema.mediaAsset).values({
    id,
    organizationId: session.organizationId,
    kind: body.data.kind,
    etiqueta,
    mimeType: mime,
    datos: body.data.base64,
    tamano,
  });
  return Response.json({ id, etiqueta, reemplazada: false });
});

export const DELETE = withAuth(async (session, req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return apiError(400, "falta_id", "Falta el id de la foto");

  const db = getDb();
  // El `and` con la organización no es decorativo: sin él, un id ajeno
  // borraría la foto de otro negocio.
  await db
    .delete(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.id, id),
        eq(schema.mediaAsset.organizationId, session.organizationId)
      )
    );
  return Response.json({ borrada: true });
});
