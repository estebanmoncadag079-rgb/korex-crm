import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";

/**
 * Fase 9P, sección 8 — extraída de `POST/GET/DELETE /api/media` (sin
 * cambiar su comportamiento: es un refactor puro de "inline en la route" a
 * "función reutilizable") para que `/api/admin/media` (superadmin,
 * cross-org) pueda reutilizar exactamente la misma lógica de validación y
 * persistencia en vez de duplicarla — mismo criterio ya aplicado en toda
 * esta iniciativa ("preferir extender antes que crear storage nuevo").
 */

/**
 * 8 MB ya en base64 (unos 6 MB de archivo). Ver el comentario histórico en
 * `api/media/route.ts` — el techo existe para no engordar el respaldo cada
 * 6 h con un archivo sin comprimir.
 */
export const MAX_BASE64 = 8_000_000;

/** Fotos (vista previa de producto) y documentos (catálogo en PDF) — el mismo mecanismo de envío decide por `mimeType`. */
export const TIPOS_MEDIA_ASSET = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type MediaAssetSummary = {
  id: string;
  etiqueta: string;
  kind: "producto" | "carta" | "otro";
  mimeType: string | null;
  entrega: "archivo" | "enlace" | "ambos";
  url: string | null;
  tamano: number | null;
  createdAt: string;
};

export async function listMediaAssets(organizationId: string): Promise<MediaAssetSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.mediaAsset.id,
      etiqueta: schema.mediaAsset.etiqueta,
      kind: schema.mediaAsset.kind,
      mimeType: schema.mediaAsset.mimeType,
      entrega: schema.mediaAsset.entrega,
      url: schema.mediaAsset.url,
      tamano: schema.mediaAsset.tamano,
      createdAt: schema.mediaAsset.createdAt,
    })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.organizationId, organizationId));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export type GuardarMediaAssetInput = {
  etiqueta: string;
  kind: "producto" | "carta" | "otro";
  entrega?: "archivo" | "enlace" | "ambos";
  base64?: string;
  mimeType?: string;
  url?: string;
};

export class MediaAssetError extends Error {
  code: "tipo_no_soportado";
  constructor(code: "tipo_no_soportado", message: string) {
    super(message);
    this.name = "MediaAssetError";
    this.code = code;
  }
}

/** Sube o reemplaza (misma etiqueta = reemplaza, idéntico al comportamiento histórico de `POST /api/media`). */
export async function guardarMediaAsset(
  organizationId: string,
  input: GuardarMediaAssetInput
): Promise<{ id: string; etiqueta: string; reemplazada: boolean }> {
  const mime = input.base64
    ? (input.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "")
    : null;
  if (mime !== null && !TIPOS_MEDIA_ASSET.includes(mime)) {
    throw new MediaAssetError("tipo_no_soportado", "El archivo debe ser JPG, PNG, WEBP o PDF.");
  }

  const db = getDb();
  const etiqueta = input.etiqueta.trim();
  const tamano = input.base64 ? Math.floor((input.base64.length * 3) / 4) : null;
  const valores = {
    kind: input.kind,
    entrega: input.entrega ?? "archivo",
    mimeType: mime,
    datos: input.base64 ?? null,
    tamano,
    url: input.url ?? null,
  };

  const existente = await db
    .select({ id: schema.mediaAsset.id })
    .from(schema.mediaAsset)
    .where(and(eq(schema.mediaAsset.organizationId, organizationId), eq(schema.mediaAsset.etiqueta, etiqueta)))
    .limit(1);

  if (existente[0]) {
    await db.update(schema.mediaAsset).set(valores).where(eq(schema.mediaAsset.id, existente[0].id));
    return { id: existente[0].id, etiqueta, reemplazada: true };
  }

  const id = newId("mediaAsset");
  await db.insert(schema.mediaAsset).values({ id, organizationId, etiqueta, ...valores });
  return { id, etiqueta, reemplazada: false };
}

export async function eliminarMediaAsset(organizationId: string, id: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.mediaAsset)
    .where(and(eq(schema.mediaAsset.id, id), eq(schema.mediaAsset.organizationId, organizationId)));
}
