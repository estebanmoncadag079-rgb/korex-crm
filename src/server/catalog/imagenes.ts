/**
 * La imagen de UN producto del catálogo, vista y editada desde el CRM.
 *
 * Fase 6 (imágenes de productos del catálogo, `0043_imagen_del_producto`) —
 * capa fina sobre `server/media/assets.ts`: reutiliza toda su validación
 * (tipo de archivo, tamaño) y persistencia, sin duplicarla. Lo único que
 * agrega es lo que ya hace `server/catalog/grupos.ts` para todo lo demás
 * del catálogo: confirmar que el producto es de ESTA organización antes de
 * tocar nada, y usar su nombre real como `etiqueta` — así el recurso queda
 * resoluble por `product_id` (Prioridad 1, `fotos.ts`) Y por el nombre del
 * producto (Prioridad 2, respaldo histórico), sin que nadie tenga que
 * escribir la etiqueta a mano.
 *
 * Todo va `scoped()` por organización (Constitución III): ningún producto
 * de otro cliente se lee ni se escribe desde aquí, ni siquiera pasando su
 * id — la FK compuesta de `media_asset.productId` lo refuerza además a
 * nivel de base (ver `0043_imagen_del_producto.sql`).
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  MediaAssetError,
  type ReferenciaAMediaAsset,
  desvincularMediaAssetDeProducto,
  eliminarMediaAsset,
  guardarMediaAsset,
  referenciasAMediaAsset,
} from "@/server/media/assets";
import type { Actor } from "@/server/registro-de-cambios";

export type ImagenDeProducto = {
  id: string;
  mimeType: string | null;
  tamano: number | null;
  createdAt: string;
};

/** La imagen vinculada a este producto, o `null` si no tiene ninguna. */
export async function obtenerImagenDeProducto(
  organizationId: string,
  productoId: string
): Promise<ImagenDeProducto | null> {
  const db = getDb();
  const [fila] = await db
    .select({
      id: schema.mediaAsset.id,
      mimeType: schema.mediaAsset.mimeType,
      tamano: schema.mediaAsset.tamano,
      createdAt: schema.mediaAsset.createdAt,
    })
    .from(schema.mediaAsset)
    .where(
      and(eq(schema.mediaAsset.organizationId, organizationId), eq(schema.mediaAsset.productId, productoId))
    );
  return fila ? { ...fila, createdAt: fila.createdAt.toISOString() } : null;
}

export type GuardarImagenResultado =
  | { ok: true; id: string }
  | { ok: false; motivo: "producto_no_encontrado" | "tipo_no_soportado" }
  | { ok: false; motivo: "etiqueta_ocupada"; mensaje: string };

/**
 * Sube o reemplaza la imagen de un producto. `productoId` debe existir en
 * ESTA organización — si no, `producto_no_encontrado` (mismo 404 silencioso
 * que el resto del catálogo: no distingue "no existe" de "es de otro
 * cliente", para no confirmar lo segundo).
 */
export async function guardarImagenDeProducto(
  organizationId: string,
  productoId: string,
  datos: { base64: string; mimeType: string },
  actor: Actor
): Promise<GuardarImagenResultado> {
  const db = getDb();
  const donde = and(
    scoped(schema.product.organizationId, organizationId),
    eq(schema.product.id, productoId)
  )!;
  const [producto] = await db.select({ nombre: schema.product.name }).from(schema.product).where(donde);
  if (!producto) return { ok: false, motivo: "producto_no_encontrado" };

  try {
    const resultado = await guardarMediaAsset(organizationId, {
      etiqueta: producto.nombre,
      kind: "producto",
      entrega: "archivo",
      base64: datos.base64,
      mimeType: datos.mimeType,
      productId: productoId,
    });
    console.log(
      `[cambio] tabla=media_asset registro=${resultado.id} campo=product_id valor_nuevo=${productoId} ` +
        `proceso=crm:catalogo actor=${actor} timestamp=${new Date().toISOString()}`
    );
    return { ok: true, id: resultado.id };
  } catch (err) {
    if (err instanceof MediaAssetError) {
      // `etiqueta_ocupada` lleva su propio mensaje: dice QUÉ recurso estorba y
      // cómo desatascarlo. Antes esto no existía porque el código, en vez de
      // avisar, se apropiaba del recurso ajeno y lo sobrescribía.
      if (err.code === "etiqueta_ocupada") {
        return { ok: false, motivo: "etiqueta_ocupada", mensaje: err.message };
      }
      return { ok: false, motivo: "tipo_no_soportado" };
    }
    throw err;
  }
}

export type EliminarImagenResultado =
  | { accion: "sin_imagen" }
  | { accion: "eliminada" }
  | { accion: "desvinculada"; referencias: ReferenciaAMediaAsset[] };

/**
 * Quita la imagen de este producto.
 *
 * «Quitar la imagen del producto» significa **romper el vínculo**, no
 * necesariamente destruir el archivo: `media_asset` es un recurso compartido
 * y la misma fila puede ser, a la vez, el header de una plantilla de WhatsApp
 * aprobada o la imagen de una campaña (ver `referenciasAMediaAsset`). Borrarla
 * desde el catálogo dejaba esa plantilla sin poder enviarse, en silencio y sin
 * forma de recuperarla — el archivo vive en la base, no hay copia en otro
 * sitio de donde sacarlo.
 *
 * Así que:
 *
 * - **Nadie más la usa** → se borra de verdad. Es lo que el negocio espera al
 *   pulsar "Quitar", y es el caso normal: una foto de producto que solo era
 *   eso. No se acumula basura.
 * - **Alguien más la usa** → se desvincula y se conserva
 *   (`desvincularMediaAssetDeProducto`). El producto se queda sin imagen —
 *   que es lo que se pidió— y la campaña o la plantilla siguen funcionando.
 *   El resultado dice cuáles son, para poder decírselo a quien lo pulsó en
 *   vez de mentirle con un "eliminada".
 *
 * En los dos casos, después de esto el producto NO tiene imagen: el recurso
 * conservado deja de ser resoluble como foto de ese producto, ni por
 * `product_id` (se pone a NULL) ni por su nombre (`resolverFoto` no acepta
 * recursos que no sean `kind: "producto"` como respaldo de un producto real).
 */
export async function eliminarImagenDeProducto(
  organizationId: string,
  productoId: string
): Promise<EliminarImagenResultado> {
  const db = getDb();
  const [fila] = await db
    .select({ id: schema.mediaAsset.id, etiqueta: schema.mediaAsset.etiqueta })
    .from(schema.mediaAsset)
    .where(
      and(eq(schema.mediaAsset.organizationId, organizationId), eq(schema.mediaAsset.productId, productoId))
    );
  if (!fila) return { accion: "sin_imagen" };

  const referencias = await referenciasAMediaAsset(organizationId, fila.id);
  if (referencias.length > 0) {
    await desvincularMediaAssetDeProducto(organizationId, fila.id, fila.etiqueta);
    return { accion: "desvinculada", referencias };
  }

  await eliminarMediaAsset(organizationId, fila.id);
  return { accion: "eliminada" };
}
