import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Limitación de tasa por clave (IP) con ventana deslizante (FR-062).
 *
 * ⚠️ **Vive en la base, no en memoria** (8-ago-2026). El `Map` de `globalThis`
 * que había aquí contaba por proceso: al levantar réplicas, "10 intentos por
 * IP" se convertía en 10 × número de réplicas — el límite se aflojaba justo
 * cuando había más tráfico, y quien probara contraseñas a lo bruto solo tenía
 * que insistir hasta caer en otra instancia.
 */

export type RateLimitResult = { allowed: boolean; remaining: number };

/**
 * Cuenta un intento y dice si se permite.
 *
 * Dos concesiones deliberadas, ambas correctas para lo que protege (el login):
 *
 * - **Puede colarse un intento de más** si dos peticiones caen exactamente a la
 *   vez: ambas leen el mismo conteo antes de insertar. Bloquear la tabla para
 *   evitarlo costaría más de lo que vale afinar 10 intentos en 10 minutos.
 * - **Si la base falla, se permite el intento** en vez de rechazarlo. No abre
 *   ningún hueco: sin base tampoco hay con qué validar la contraseña, y
 *   rechazar convertiría un hipo de la base en un "nadie puede entrar".
 */
export async function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number }
): Promise<RateLimitResult> {
  try {
    const db = getDb();
    const filas = (await db.execute(sql`
      WITH caducados AS (
        DELETE FROM rate_limit_hit
         WHERE key = ${key}
           AND at < now() - make_interval(secs => ${opts.windowMs} / 1000.0)
      ), vigentes AS (
        SELECT count(*)::int AS n
          FROM rate_limit_hit
         WHERE key = ${key}
           AND at >= now() - make_interval(secs => ${opts.windowMs} / 1000.0)
      ), anotado AS (
        INSERT INTO rate_limit_hit (id, key, at)
        SELECT ${newId("rateLimitHit")}, ${key}, now()
          FROM vigentes WHERE vigentes.n < ${opts.max}
        RETURNING 1
      )
      SELECT (SELECT n FROM vigentes) AS previos,
             EXISTS (SELECT 1 FROM anotado) AS permitido
    `)) as unknown as Array<{ previos: number; permitido: boolean }>;

    const f = filas[0];
    if (!f) return { allowed: true, remaining: opts.max - 1 };
    const previos = Number(f.previos ?? 0);
    return f.permitido
      ? { allowed: true, remaining: Math.max(0, opts.max - previos - 1) }
      : { allowed: false, remaining: 0 };
  } catch (err) {
    console.error("[rate-limit] no se pudo consultar la base:", err);
    return { allowed: true, remaining: opts.max };
  }
}

/** Borra los intentos ya caducados de TODAS las claves. Lo llama el worker. */
export async function limpiarRateLimit(maxEdadMs = 24 * 3600_000): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    DELETE FROM rate_limit_hit
     WHERE at < now() - make_interval(secs => ${maxEdadMs} / 1000.0)
  `);
}

/** Solo para tests. */
export async function resetRateLimit(): Promise<void> {
  const db = getDb();
  await db.execute(sql`DELETE FROM rate_limit_hit`);
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

/**
 * IP real del cliente a partir de las cabeceras que pone el proxy (Traefik).
 *
 * `X-Forwarded-For` es una lista que cualquiera puede iniciar con lo que
 * quiera; el proxy solo AÑADE la IP real al final, nunca la garantiza al
 * principio. Tomar el primer valor deja rotar el header en cada intento y
 * el rate-limit nunca se dispara (verificado: bastaba con mandar un
 * `X-Forwarded-For` distinto en cada petición). `X-Real-Ip` (que sí pone el
 * proxy) y, si falta, el ÚLTIMO salto de XFF son los que de verdad reflejan
 * quién habló con el servidor.
 */
export function clientIpFrom(headers: {
  get(name: string): string | null | undefined;
}): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "local"
  );
}
