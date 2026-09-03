/**
 * Reglas puras sobre el body de una plantilla — sin DB, sin credenciales,
 * sin ningún cliente HTTP, sin ningún import.
 *
 * Compartido entre el dominio local de Korex (`templates.ts`) y el
 * adaptador de YCloud (`ycloud-templates.ts`). Existe como archivo aparte
 * porque antes `ycloud-templates.ts` importaba `countVariables` directo de
 * `templates.ts`, y en ESM eso arrastraba TODO el árbol de dependencias de
 * ese módulo (`@/lib/db`, `@/lib/meta/client`, `@/lib/ycloud/client` de
 * envío, `@/server/inbox/send`, `@/server/inbox/ingest`,
 * `@/server/events/bus`, `@/server/whatsapp/credentials`) — hallazgo de
 * acoplamiento de la auditoría Fase 9E, corregido aquí en 9F.
 */

export const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

/** Cuenta variables {{n}} en el body (sin validar su acotamiento). */
export function countVariables(body: string): number {
  const matches = [...body.matchAll(VARIABLE_REGEX)];
  return matches.length;
}

/** Valida el acotamiento v1: como máximo una variable, y debe ser {{1}}. Devuelve el mensaje de error, o null si es válido. */
export function validateBodyVariables(body: string): string | null {
  const matches = [...body.matchAll(VARIABLE_REGEX)];
  if (matches.length > 1) {
    return "v1 admite una sola variable {{1}} en el cuerpo";
  }
  if (matches.length === 1 && matches[0]![1] !== "1") {
    return "La variable debe ser {{1}}";
  }
  return null;
}

/**
 * Fase 9P — header/footer opcionales de una plantilla. `IMAGE` guarda solo
 * la REFERENCIA (`mediaAssetId`), nunca una URL — resolverla (y validar que
 * el asset pertenezca a la organización, tenga el mime/tamaño correctos, y
 * tenga una URL pública real) es responsabilidad de la capa que sí toca DB
 * (`templates.ts`), no de este módulo puro. `NONE` = sin header,
 * comportamiento histórico. `TEXT` queda preparado (documentado en la
 * auditoría 9O) pero sin UI todavía.
 *
 * Fase 10D — `IMAGE_URL` es DISTINTO de `IMAGE`: existe para plantillas
 * SINCRONIZADAS desde YCloud (creadas fuera de Korex, ver
 * `sync-ycloud-templates.ts`), donde no hay ningún `media_asset` local que
 * referenciar — la imagen vive del lado de Meta/YCloud, identificada solo
 * por la URL de ejemplo que la propia plantilla ya trae aprobada. Decisión
 * de arquitectura (documentada aquí, no solo en el commit): reusar esa URL
 * en cada envío real es correcto (Meta exige una URL de imagen en el
 * componente HEADER de cada mensaje, no necesariamente la misma que en el
 * ejemplo de aprobación) y evita inventar un `media_asset` sintético sin
 * archivo real detrás. Nunca se crea desde la UI de Korex — solo la
 * sincronización la produce.
 */
export type HeaderComponent =
  | { type: "NONE" }
  | { type: "TEXT"; text: string }
  | { type: "IMAGE"; mediaAssetId: string }
  | { type: "IMAGE_URL"; url: string };

export type TemplateComponents = {
  header: HeaderComponent;
  footer: { text: string } | null;
};

/** Mismo límite que YCloud/Meta documentan para HEADER TEXT y FOOTER (Fase 9O, WebFetch contra docs.ycloud.com). */
const MAX_HEADER_TEXT = 60;
const MAX_FOOTER_TEXT = 60;

/**
 * Validación pura de `components` — sin DB, sin red. `null`/`undefined` es
 * válido (sin componentes especiales, comportamiento histórico). Para
 * `IMAGE`, solo confirma que venga un `mediaAssetId` no vacío: la
 * existencia real del asset, su ownership por organización, y sus
 * validaciones de mime/tamaño/URL pública viven en `templates.ts` (Fase
 * 9P, sección 3 — "No acceder a DB desde este módulo").
 */
export function validateComponents(
  components: TemplateComponents | null | undefined
): string | null {
  if (!components) return null;

  const { header, footer } = components;
  if (header.type === "TEXT") {
    if (!header.text?.trim()) {
      return "El texto del header no puede estar vacío";
    }
    if (header.text.length > MAX_HEADER_TEXT) {
      return `El texto del header no puede superar ${MAX_HEADER_TEXT} caracteres`;
    }
  } else if (header.type === "IMAGE") {
    if (!header.mediaAssetId?.trim()) {
      return "El header de imagen requiere seleccionar un asset";
    }
  } else if (header.type === "IMAGE_URL") {
    if (!header.url?.trim()) {
      return "El header de imagen sincronizada requiere una URL";
    }
  } else if (header.type !== "NONE") {
    return `Tipo de header desconocido: "${(header as { type: string }).type}"`;
  }

  if (footer) {
    if (!footer.text?.trim()) {
      return "El texto del footer no puede estar vacío";
    }
    if (footer.text.length > MAX_FOOTER_TEXT) {
      return `El footer no puede superar ${MAX_FOOTER_TEXT} caracteres`;
    }
  }

  return null;
}
