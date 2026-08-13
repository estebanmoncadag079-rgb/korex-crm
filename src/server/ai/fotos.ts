import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

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
};

/** Lo que el negocio tiene cargado, para listárselo al agente en su prompt. */
export async function fotosDeLaOrganizacion(
  organizationId: string
): Promise<FotoDisponible[]> {
  const db = getDb();
  return db
    .select({
      id: schema.mediaAsset.id,
      etiqueta: schema.mediaAsset.etiqueta,
      kind: schema.mediaAsset.kind,
    })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.organizationId, organizationId));
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

/** La foto completa (con sus bytes) por id, para servirla o enviarla. */
export async function fotoPorEtiqueta(
  organizationId: string,
  etiqueta: string
): Promise<{ id: string; etiqueta: string } | null> {
  const fotos = await fotosDeLaOrganizacion(organizationId);
  return elegirFoto(fotos, etiqueta);
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
