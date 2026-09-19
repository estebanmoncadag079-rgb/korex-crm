import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { buscarProductos } from "@/server/catalog/buscar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * Las fotos que el agente puede mandar, y cómo elegir la que le piden.
 *
 * Nace de una petición del dueño con dos ejemplos que lo explican mejor que
 * cualquier justificación: *"¿te imaginas el menú de Lashes Valen con más de
 * 30 productos? sería super aburrido leer todo eso"* y *"si La Churra quiere
 * enviar una foto de cómo se ven sus churros"*.
 *
 * La idea NO es que el agente empiece a mandar fotos y catálogos: es que sea
 * **preciso** con lo que el cliente pide. La foto del Volumen Ruso cuando
 * preguntan por el Volumen Ruso.
 */

export type FotoDisponible = {
  id: string;
  etiqueta: string;
  kind: "producto" | "carta" | "otro";
  /**
   * Decide cómo se entrega el ARCHIVO: `image/*` como foto, `application/pdf`
   * como documento. Nulo en un recurso que solo es enlace.
   */
  mimeType: string | null;
  /** Archivo, enlace o ambos. Lo declara el negocio al cargar el recurso. */
  entrega: "archivo" | "enlace" | "ambos";
  /** El enlace externo, cuando `entrega` es `enlace` o `ambos`. */
  url: string | null;
};

/**
 * Fase 4 (imágenes de productos del catálogo) — con la relación real del
 * 0043_imagen_del_producto, un recurso vinculado a un producto trae su id.
 * `null` = recurso sin producto (`carta`/`otro`), o un `producto` todavía
 * sin vincular — en los dos casos, `resolverFoto` cae a `etiqueta`.
 */
export type FotoConProducto = FotoDisponible & { productId: string | null };

/** Lo que el negocio tiene cargado, para listárselo al agente en su prompt. */
export async function fotosDeLaOrganizacion(
  organizationId: string
): Promise<FotoConProducto[]> {
  const db = getDb();
  return db
    .select({
      id: schema.mediaAsset.id,
      etiqueta: schema.mediaAsset.etiqueta,
      kind: schema.mediaAsset.kind,
      mimeType: schema.mediaAsset.mimeType,
      entrega: schema.mediaAsset.entrega,
      url: schema.mediaAsset.url,
      productId: schema.mediaAsset.productId,
    })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.organizationId, organizationId));
}

/**
 * Qué se puede entregar de verdad de este recurso, mirando lo que TIENE y no
 * lo que dice que es.
 *
 * Existe por la misma razón que los guardarraíles: un recurso declarado
 * `enlace` sin `url`, o `archivo` sin `datos`, es una promesa que el sistema
 * no puede cumplir — exactamente el defecto que ya tenía `send_image` al
 * aceptar una acción sin etiqueta. Aquí se comprueba el hecho, no la
 * intención, y quien llama decide qué hacer con un recurso vacío.
 */
export function comoSeEntrega(foto: {
  entrega: "archivo" | "enlace" | "ambos";
  url: string | null;
  mimeType: string | null;
}): { archivo: boolean; enlace: boolean } {
  const quiereArchivo = foto.entrega === "archivo" || foto.entrega === "ambos";
  const quiereEnlace = foto.entrega === "enlace" || foto.entrega === "ambos";
  return {
    // Sin `mimeType` no se sabe si mandarlo como foto o como documento, así
    // que no hay archivo que entregar aunque la columna diga que sí.
    archivo: quiereArchivo && Boolean(foto.mimeType),
    enlace: quiereEnlace && Boolean(foto.url),
  };
}

/** Sin tildes, sin mayúsculas y sin dobles espacios. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca la foto que pide el agente, tolerando cómo la escriba.
 *
 * Tres pasadas, de más estricta a menos: exacta → sin tildes ni mayúsculas →
 * una contiene a la otra. La tolerancia hace falta porque el modelo escribe
 * "volumen ruso" donde el negocio guardó "Volumen Ruso", y **fallar ahí
 * significaría no mandar una foto que sí existe**.
 *
 * Lo que NO hace es adivinar: si nada encaja devuelve `null` y quien llama
 * responde con texto. Mandar la foto equivocada es peor que no mandar ninguna.
 */
export function elegirFoto<T extends { etiqueta: string }>(
  fotos: T[],
  pedida: string
): T | null {
  const p = normalizar(pedida);
  if (!p) return null;

  const exacta = fotos.find((f) => f.etiqueta === pedida.trim());
  if (exacta) return exacta;

  const normal = fotos.find((f) => normalizar(f.etiqueta) === p);
  if (normal) return normal;

  const contiene = fotos.filter((f) => {
    const e = normalizar(f.etiqueta);
    return e.includes(p) || p.includes(e);
  });
  // Si dos fotos encajan igual de bien, no se elige por sorteo: mejor texto.
  return contiene.length === 1 ? contiene[0]! : null;
}

/**
 * Fase 4 (imágenes de productos del catálogo) — la resolución real, en dos
 * prioridades:
 *
 * 1. **`product_id`**: si `etiqueta` resuelve a UN producto real e
 *    inequívoco del catálogo (mismo buscador que ya usa
 *    `consultar_producto`, `buscarProductos`), y ese producto tiene una
 *    imagen vinculada, es esa — sin importar si el texto de su `etiqueta`
 *    coincide. Ambiguo (`multiple_matches`) o `not_found` nunca intenta
 *    adivinar por producto: cae directo a la 2.
 * 2. **`etiqueta`** (`elegirFoto`): el comportamiento histórico, para
 *    recursos sin producto (`carta`/`otro`) o un `producto` todavía sin
 *    vincular.
 *
 *    Con UNA restricción, y solo cuando la 1 ya identificó el producto de
 *    forma inequívoca y ese producto resultó no tener imagen: entonces el
 *    respaldo se limita a recursos `kind === "producto"`. Si el agente
 *    pregunta por un artículo REAL del catálogo, lo único que puede
 *    contestarle legítimamente es la foto de un producto — la carta del
 *    negocio o una foto del local nunca son "la foto de ese artículo".
 *
 *    Esto es lo que impide que una imagen recién quitada de un producto
 *    reaparezca por la puerta de atrás: al desvincularla se la demota a
 *    `otro` (`desvincularMediaAssetDeProducto`), y renombrarla no bastaba —
 *    la tercera pasada de `elegirFoto` es "una contiene a la otra", así que
 *    «Amor y Amistad (sin producto · med_x)» seguiría encajando con «Amor y
 *    Amistad».
 *
 *    No hay regresión: las fotos que sube el onboarding y las del catálogo
 *    son siempre `kind: "producto"`. Y cuando `buscarProductos` NO identifica
 *    nada (`not_found`, `multiple_matches`) o no hay catálogo, el respaldo
 *    sigue siendo el histórico completo, sin filtrar — "muéstrame la carta"
 *    y "una foto del local" funcionan igual que siempre.
 *
 * Pura a propósito, mismo criterio que `elegirFoto`: se prueba con fixtures
 * en memoria, sin mocks de Postgres. `catalogo` ausente o vacío (negocio en
 * `catalog_source='prompt'`, o vertical de citas) se comporta EXACTAMENTE
 * como antes de esta fase.
 */
export function resolverFoto(
  fotos: FotoConProducto[],
  etiqueta: string,
  catalogo?: ProductoDelCatalogo[]
): FotoConProducto | null {
  if (catalogo && catalogo.length > 0) {
    const resultado = buscarProductos(catalogo, etiqueta);
    if (resultado.status === "found") {
      const porProducto = fotos.find((f) => f.productId === resultado.producto.id);
      if (porProducto) return porProducto;
      return elegirFoto(
        fotos.filter((f) => f.kind === "producto"),
        etiqueta
      );
    }
  }
  return elegirFoto(fotos, etiqueta);
}

/**
 * El archivo por id, para servirlo o enviarlo. Incluye `mimeType`: es lo que
 * decide si se manda como imagen o como documento — quien pide "el catálogo"
 * no dice de qué tipo es, y el archivo mismo ya lo sabe.
 *
 * `catalogo`, si se pasa, habilita la Prioridad 1 de `resolverFoto` — el
 * único llamador de hoy (`pipeline.ts`, `case "send_image"`) ya tiene
 * `productosDelPedido` cargado en memoria para este turno, así que esto no
 * agrega ninguna consulta nueva a la base.
 */
export async function fotoPorEtiqueta(
  organizationId: string,
  etiqueta: string,
  catalogo?: ProductoDelCatalogo[]
): Promise<FotoConProducto | null> {
  const fotos = await fotosDeLaOrganizacion(organizationId);
  return resolverFoto(fotos, etiqueta, catalogo);
}

/**
 * La URL pública de una foto, o `null` si no se puede construir.
 *
 * `null` cuando falta `PUBLIC_MEDIA_BASE_URL` o no es https: Meta descarga la
 * imagen desde sus servidores y rechaza cualquier otra cosa. Devolver `null`
 * en vez de lanzar deja que el agente siga con texto — una foto que no sale no
 * puede costar una conversación.
 */
export function urlPublicaDeFoto(id: string): string | null {
  const base = getEnv().PUBLIC_MEDIA_BASE_URL;
  if (!base) return null;
  if (!/^https:\/\//i.test(base)) return null;
  return `${base.replace(/\/$/, "")}/api/media/${id}`;
}
