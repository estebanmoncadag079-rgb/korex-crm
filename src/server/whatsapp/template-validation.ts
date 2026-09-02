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
