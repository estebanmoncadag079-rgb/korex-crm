import { and, eq, or, sql } from "drizzle-orm";
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
  /** Fase 6 (imágenes de productos del catálogo) — `null` = sin vincular. */
  productId: string | null;
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
      productId: schema.mediaAsset.productId,
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
  /**
   * Fase 6 (imágenes de productos del catálogo) — cuando viene, "la misma
   * foto" (para decidir si esto reemplaza algo o crea una fila nueva)
   * significa PRIMERO "la que ya está vinculada a este producto" (más
   * preciso y duradero que el texto: sobrevive a que el negocio renombre el
   * producto), y solo si no existe ninguna, "la que ya tenía esta etiqueta"
   * — para poder reclamar/vincular un recurso que ya existía por el camino
   * viejo (script, onboarding) con el mismo nombre que el producto, sin
   * duplicar la fila ni violar el índice único de etiqueta.
   */
  productId?: string | null;
};

/**
 * `etiqueta_ocupada` solo puede salir del camino CON `productId` (la imagen de
 * un producto del catálogo): `POST /api/media` y `POST /api/admin/media` no lo
 * mandan nunca, así que su manejo actual —un 415 con `err.code`— sigue siendo
 * exacto para el único error que ellas pueden producir.
 */
export class MediaAssetError extends Error {
  code: "tipo_no_soportado" | "etiqueta_ocupada";
  constructor(code: "tipo_no_soportado" | "etiqueta_ocupada", message: string) {
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
  const productId = input.productId ?? null;
  const valores = {
    kind: input.kind,
    entrega: input.entrega ?? "archivo",
    mimeType: mime,
    datos: input.base64 ?? null,
    tamano,
    url: input.url ?? null,
    productId,
  };

  const candidatos = await db
    .select({
      id: schema.mediaAsset.id,
      etiqueta: schema.mediaAsset.etiqueta,
      kind: schema.mediaAsset.kind,
      productId: schema.mediaAsset.productId,
    })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, organizationId),
        productId
          ? or(eq(schema.mediaAsset.productId, productId), eq(schema.mediaAsset.etiqueta, etiqueta))
          : eq(schema.mediaAsset.etiqueta, etiqueta)
      )
    );
  // Con `productId`, el vínculo por producto gana sobre el de texto si por
  // algún motivo hubiera ambos (p.ej. alguien ya vinculó este producto a
  // OTRA etiqueta, y ahora también existe una fila con la etiqueta nueva).
  const porProducto = productId ? candidatos.find((c) => c.productId === productId) : undefined;
  /*
   * Reclamar por etiqueta solo vale sobre un recurso HUÉRFANO de tipo
   * `producto`. La etiqueta es texto que el negocio escribe a mano: no es
   * identidad suficiente para apropiarse de un recurso ajeno. Las dos formas
   * en que eso podía pasar, las dos silenciosas y sin vuelta atrás:
   *
   * - `kind` distinto: si el negocio tiene un producto llamado igual que su
   *   carta, subirle imagen al producto PISABA la carta — mismo id, `kind`
   *   cambiado a `producto`, el PDF sustituido por un JPG.
   * - ya vinculado a OTRO producto: `product` no tiene índice único sobre
   *   `(organization_id, name)`, así que dos productos pueden llamarse igual.
   *   Subirle imagen al segundo se llevaba la del primero, que se quedaba sin
   *   ninguna.
   *
   * Sin `productId` (el camino histórico de `POST /api/media`) no hay
   * restricción ninguna: se comporta exactamente igual que siempre.
   */
  const porEtiqueta = candidatos.find(
    (c) =>
      c.etiqueta === etiqueta &&
      (!productId || (c.kind === "producto" && c.productId === null))
  );
  const existente = porProducto ?? porEtiqueta;

  /*
   * El nombre está ocupado por un recurso que no se puede reclamar, y tampoco
   * se puede insertar uno nuevo: `media_org_etiqueta_uq` es UNIQUE sobre
   * `(organization_id, etiqueta)` y el INSERT reventaría con un error de base
   * crudo. Se corta antes, con un motivo que se puede explicar y arreglar.
   */
  if (!existente && productId) {
    const ocupado = candidatos.find((c) => c.etiqueta === etiqueta);
    if (ocupado) {
      throw new MediaAssetError(
        "etiqueta_ocupada",
        ocupado.productId
          ? `Ya tienes otro producto llamado «${etiqueta}» y esa imagen es suya. ` +
              "Cambia el nombre de uno de los dos para poder darle imagen propia a cada uno."
          : `Ya tienes un recurso llamado «${etiqueta}» que no es la imagen de un producto. ` +
              "Renómbralo o bórralo desde Recursos, o cambia el nombre del producto."
      );
    }
  }

  if (existente) {
    await db.update(schema.mediaAsset).set(valores).where(eq(schema.mediaAsset.id, existente.id));
    return { id: existente.id, etiqueta, reemplazada: true };
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

/**
 * Quién MÁS está usando este recurso, aparte de quien lo quiere borrar.
 *
 * Existe porque `media_asset` es compartido: la misma fila puede ser la
 * imagen de un producto del catálogo Y el header de una plantilla de
 * WhatsApp Y la imagen de una campaña. Destruirla desde un sitio se lleva
 * por delante a los otros dos, en silencio:
 *
 * - `campaign.mediaAssetId` es una FK real con `ON DELETE SET NULL`
 *   (`schema.ts`): la base no se rompe, la campaña simplemente se queda sin
 *   imagen sin que nadie se entere.
 * - `template.components.header` de tipo `IMAGE` guarda el `mediaAssetId`
 *   como JSONB, SIN FK — nadie lo protege. `resolverAssetDeHeaderImagen`
 *   (`server/whatsapp/templates.ts:511`) lo resuelve contra `media_asset` en
 *   CADA envío y en cada aprobación, y devuelve *"El asset de header no
 *   existe en esta organización"*: una plantilla ya aprobada deja de poder
 *   enviarse.
 * - `campaign.templateSnapshot.components.header` congela ese mismo id al
 *   pasar la campaña a `ready`, con el mismo problema.
 *
 * Todo `scoped` por organización: un recurso de otro cliente nunca cuenta
 * como referencia, ni siquiera pasando su id.
 */
export type ReferenciaAMediaAsset = {
  tipo: "campana" | "plantilla";
  id: string;
  nombre: string;
};

export async function referenciasAMediaAsset(
  organizationId: string,
  mediaAssetId: string
): Promise<ReferenciaAMediaAsset[]> {
  const db = getDb();
  const [campanas, plantillas] = await Promise.all([
    db
      .select({ id: schema.campaign.id, nombre: schema.campaign.name })
      .from(schema.campaign)
      .where(
        and(
          eq(schema.campaign.organizationId, organizationId),
          or(
            eq(schema.campaign.mediaAssetId, mediaAssetId),
            // `->` sobre una columna NULL da NULL, y `NULL = 'x'` no se
            // cumple: una campaña sin snapshot nunca cuenta como referencia.
            sql`${schema.campaign.templateSnapshot} -> 'components' -> 'header' ->> 'mediaAssetId' = ${mediaAssetId}`
          )
        )
      ),
    db
      .select({ id: schema.template.id, nombre: schema.template.name })
      .from(schema.template)
      .where(
        and(
          eq(schema.template.organizationId, organizationId),
          sql`${schema.template.components} -> 'header' ->> 'mediaAssetId' = ${mediaAssetId}`
        )
      ),
  ]);

  return [
    ...campanas.map((c) => ({ tipo: "campana" as const, id: c.id, nombre: c.nombre })),
    ...plantillas.map((p) => ({ tipo: "plantilla" as const, id: p.id, nombre: p.nombre })),
  ];
}

/**
 * Suelta un recurso de su producto SIN destruirlo — lo que hay que hacer
 * cuando alguien más lo está usando (ver `referenciasAMediaAsset`).
 *
 * Tres cambios, y los tres hacen falta. Con solo poner `product_id = NULL`
 * el recurso quedaría resucitable por el respaldo de texto y, peor, le
 * bloquearía al negocio volver a subir una imagen a ese producto:
 *
 * 1. `productId = null` — se acabó el vínculo con el producto.
 * 2. `kind = "otro"` — deja de ser "la foto de un producto". Es lo que hace
 *    que `resolverFoto` no lo devuelva por el respaldo de etiqueta cuando el
 *    agente pregunte otra vez por ese producto (ver `server/ai/fotos.ts`), y
 *    además es la verdad: ya no representa un artículo del catálogo, es un
 *    recurso suelto que una campaña o una plantilla usa.
 * 3. `etiqueta` renombrada — OBLIGATORIO, no cosmético:
 *    `media_org_etiqueta_uq` es UNIQUE sobre `(organization_id, etiqueta)`.
 *    Si la dejara con el nombre del producto, la próxima imagen que el
 *    negocio suba a ese producto chocaría contra este recurso: o revienta
 *    por el índice único, o lo reclama por etiqueta y PISA la imagen que la
 *    campaña está usando. Se le añade el id del recurso porque es lo único
 *    único por definición — un sufijo con la fecha colisionaría al
 *    desvincular dos veces el mismo día.
 */
export async function desvincularMediaAssetDeProducto(
  organizationId: string,
  id: string,
  etiquetaActual: string
): Promise<{ etiqueta: string }> {
  const db = getDb();
  const etiqueta = `${etiquetaActual} (sin producto · ${id})`;
  await db
    .update(schema.mediaAsset)
    .set({ productId: null, kind: "otro", etiqueta })
    .where(and(eq(schema.mediaAsset.id, id), eq(schema.mediaAsset.organizationId, organizationId)));
  return { etiqueta };
}
