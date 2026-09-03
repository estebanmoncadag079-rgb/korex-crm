import { z } from "zod";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  /**
   * Dominios públicos adicionales desde los que se sirve la app (separados por
   * coma). Better Auth rechaza el login si el Origin del navegador no está
   * entre los de confianza: con la app detrás de un proxy, APP_BASE_URL suele
   * ser la URL interna y el usuario entra por el dominio.
   */
  APP_TRUSTED_ORIGINS: z.string().optional(),
  /**
   * URL pública desde la que se sirven las fotos que el agente envía.
   *
   * Existe aparte de `APP_BASE_URL` por un motivo concreto: en producción
   * aquella apunta a la dirección INTERNA (`http://2.25.159.117:3987`), que le
   * sirve a la app pero no a Meta — al enviar una imagen por WhatsApp no se
   * manda el archivo, se manda una URL que **Meta descarga desde sus
   * servidores**, y solo acepta `https` público.
   *
   * Se dejó como variable nueva en vez de corregir `APP_BASE_URL` para no
   * tocar de paso el login: Better Auth la usa como `baseURL`, y un cambio ahí
   * se paga con todos los clientes fuera de su cuenta.
   *
   * Si no se configura, el agente **no manda fotos y responde con texto**.
   * Nunca rompe una conversación por esto.
   *
   * Valor esperado en producción: `https://crm.korexia.online`
   */
  PUBLIC_MEDIA_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  OPENROUTER_API_TOKEN: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_MODEL: z.string().optional(),
  /*
   * Aquí vivía OPENROUTER_FALLBACK_MODEL, el modelo de rescate. Se eliminó el
   * 13-ago-2026: cuando el modelo no logra resolver una conversación, el
   * rescate es una PERSONA, no otro modelo. Dejarla puesta en el servicio ya no
   * hace nada — el código del respaldo no existe (ver `lib/ai/index.ts`).
   */
  ALLOW_SIGNUP: z.string().optional(),
  /** WhatsApp de la agencia para pedir asesoría desde el login (E.164 sin '+'). */
  SUPPORT_WHATSAPP: z.string().optional(),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6000),
  /**
   * Si este proceso vacía la cola de turnos del agente (`agent_job`).
   * Encendido por defecto: con varias réplicas, todas pueden hacerlo a la vez
   * sin pisarse. Se apaga con `0` para dejar una instancia que solo sirva el
   * panel — útil para aislar un problema sin dejar de atender WhatsApp.
   */
  AGENT_WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v?.toLowerCase() !== "false"),
  /**
   * Corridas del Laboratorio que puede lanzar un CLIENTE al mes. Cada una
   * simula seis conversaciones completas y las califica con IA — la paga la
   * agencia, que por eso no tiene cupo.
   */
  LAB_RUNS_PER_MONTH: z.coerce.number().int().min(0).default(5),
  WA_MOCK_ENABLED: z.string().optional(),
  /**
   * Fase 10B — si este proceso vacía la cola de envíos de campañas
   * (`campaign_send_job`). Apagado por defecto a propósito, a diferencia de
   * `AGENT_WORKER_ENABLED`: un envío masivo real solo debe arrancar cuando
   * alguien lo enciende explícitamente, nunca "porque el proceso arrancó".
   */
  CAMPAIGN_WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "1" || v?.toLowerCase() === "true"),
  /** Cuántos envíos de campaña puede tener EN VUELO este proceso a la vez (todas las organizaciones juntas). Valor operativo inicial, sin dato real de producción todavía — ajustable sin desplegar código. */
  CAMPAIGN_WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  /** Cada cuánto se sondea la cola de campañas. */
  CAMPAIGN_WORKER_POLL_MS: z.coerce.number().int().min(200).default(2_000),
  /** Cuántos envíos de campaña puede hacer UNA organización dentro de la ventana de abajo. Valor operativo inicial — el límite REAL de YCloud/Meta puede ser mayor o menor; esto es el techo de seguridad de Korex, no el del proveedor. */
  CAMPAIGN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  CAMPAIGN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  // --- YCloud (proveedor oficial de WhatsApp Business API) ---
  YCLOUD_API_KEY: z.string().optional(),
  YCLOUD_BASE_URL: z.string().url().default("https://api.ycloud.com"),
  YCLOUD_WEBHOOK_SECRET: z.string().optional(),
  // Modo observación: enruta los mensajes de este WABA a esta organización, SIN agente.
  YCLOUD_OBSERVE_WABA: z.string().optional(),
  YCLOUD_OBSERVE_ORG: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Los strings vacíos cuentan como ausentes: los compose/paneles suelen
  // inyectar VAR="" para opcionales y eso debe activar los defaults.
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** true si el entorno de pruebas interno (mocks) está habilitado y NO es producción. */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/** true si hay proveedor de IA configurado (token presente y no vacío). */
export function isAiConfigured(): boolean {
  const token = process.env.OPENROUTER_API_TOKEN;
  return typeof token === "string" && token.trim().length > 0;
}
