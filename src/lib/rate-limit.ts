/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = number[]; // timestamps (ms) de los intentos

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  const cutoff = now - opts.windowMs;
  const bucket = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (bucket.length >= opts.max) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0 };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: opts.max - bucket.length };
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
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
