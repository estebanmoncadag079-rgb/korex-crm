var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// scripts/probar-estado.ts
import { readFileSync } from "node:fs";
import { eq as eq6, inArray } from "drizzle-orm";

// src/lib/db/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// src/lib/env.ts
import { z } from "zod";
var envSchema = z.object({
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
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)"
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
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6e3),
  /**
   * Si este proceso vacía la cola de turnos del agente (`agent_job`).
   * Encendido por defecto: con varias réplicas, todas pueden hacerlo a la vez
   * sin pisarse. Se apaga con `0` para dejar una instancia que solo sirva el
   * panel — útil para aislar un problema sin dejar de atender WhatsApp.
   */
  AGENT_WORKER_ENABLED: z.string().optional().transform((v) => v !== "0" && v?.toLowerCase() !== "false"),
  /**
   * Corridas del Laboratorio que puede lanzar un CLIENTE al mes. Cada una
   * simula seis conversaciones completas y las califica con IA — la paga la
   * agencia, que por eso no tiene cupo.
   */
  LAB_RUNS_PER_MONTH: z.coerce.number().int().min(0).default(5),
  WA_MOCK_ENABLED: z.string().optional(),
  // --- YCloud (proveedor oficial de WhatsApp Business API) ---
  YCLOUD_API_KEY: z.string().optional(),
  YCLOUD_BASE_URL: z.string().url().default("https://api.ycloud.com"),
  YCLOUD_WEBHOOK_SECRET: z.string().optional(),
  // Modo observación: enruta los mensajes de este WABA a esta organización, SIN agente.
  YCLOUD_OBSERVE_WABA: z.string().optional(),
  YCLOUD_OBSERVE_ORG: z.string().optional(),
  NODE_ENV: z.string().default("development")
});
var BUILD_PLACEHOLDERS = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token"
};
var cached = null;
function getEnv() {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const source = isBuild ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) } : stripEmpty(process.env);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(
      `Variables de entorno inv\xE1lidas o faltantes:
  ${missing}
Revisa .env.example para la gu\xEDa de cada variable.`
    );
  }
  cached = parsed.data;
  return cached;
}
function stripEmpty(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== void 0 && v !== "") out[k] = v;
  }
  return out;
}

// src/lib/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  account: () => account,
  agentJob: () => agentJob,
  agentProfile: () => agentProfile,
  agentTestCase: () => agentTestCase,
  agentTestRun: () => agentTestRun,
  appointment: () => appointment,
  contact: () => contact,
  conversation: () => conversation,
  conversationState: () => conversationState,
  invitation: () => invitation,
  kbEntry: () => kbEntry,
  lead: () => lead,
  learningProposal: () => learningProposal,
  mediaAsset: () => mediaAsset,
  member: () => member,
  message: () => message,
  metaCredentials: () => metaCredentials,
  offeredSlot: () => offeredSlot,
  organization: () => organization,
  pipelineStage: () => pipelineStage,
  product: () => product,
  productOption: () => productOption,
  productOptionGroup: () => productOptionGroup,
  rateLimitHit: () => rateLimitHit,
  service: () => service,
  session: () => session,
  staffMember: () => staffMember,
  staffService: () => staffService,
  template: () => template,
  usageEvent: () => usageEvent,
  user: () => user,
  verification: () => verification,
  webhookEvent: () => webhookEvent
});
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
var user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Rol de PLATAFORMA (por encima de las organizaciones): la agencia que
  // hospeda la instancia. NULL = usuario normal, acotado a sus membresías.
  platformRole: text("platform_role", { enum: ["superadmin"] }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});
var session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id")
});
var account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});
var verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});
var organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata")
});
var member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" })
});
var contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Nulo cuando el contacto solo tiene nombre de usuario de WhatsApp (ver
     * `waUserId`) — verificado en vivo el 2/3-ago-2026: WhatsApp lanzó
     * "nombres de usuario" en 2026 para que la gente oculte su número a los
     * negocios; en ese caso el webhook NUNCA manda `from`, solo un
     * identificador. La app debe seguir funcionando con uno de los dos, no
     * necesariamente ambos.
     */
    phone: text("phone"),
    /**
     * Business-Scoped User ID (formato "CO.xxxx…"): el identificador estable
     * que da WhatsApp cuando el cliente usa nombre de usuario en vez de
     * exponer su teléfono. Se puede seguir usando para RESPONDERLE (va en el
     * `to` del envío, igual que un teléfono) — no es una vía muerta.
     */
    waUserId: text("wa_user_id"),
    name: text("name").notNull(),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    // NULL no choca consigo mismo en un índice único de Postgres: varios
    // contactos sin teléfono (o sin wa_user_id) conviven sin problema.
    uniqueIndex("contact_org_phone_uq").on(t.organizationId, t.phone),
    uniqueIndex("contact_org_wa_user_id_uq").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name)
  ]
);
var pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] }).notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);
var lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id").notNull().references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position)
  ]
);
var conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // "operador": una persona escribió en la bandeja y tomó la conversación.
      enum: ["cliente", "modelo", "error", "ventana", "operador"]
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    /**
     * Hasta qué mensaje del cliente llegó el último turno del agente.
     *
     * Sin esta marca no hay forma de distinguir un mensaje que el agente ya
     * respondió de uno que se le coló mientras respondía: los dos quedan en
     * la base ANTES de la respuesta. El segundo caso es real y frecuente —
     * con `AGENT_COALESCE_MS=3000`, a un cliente le basta escribir su segunda
     * frase 4 s después para caer justo en el turno en marcha (Tatis, Lis
     * Pastelería, 5-ago-2026: preguntó por el domicilio y eligió "1" del
     * menú; le contestaron solo lo del domicilio).
     */
    lastTurnInboundAt: timestamp("last_turn_inbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq").on(t.organizationId, t.contactId).where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt)
  ]
);
var message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"]
    }).notNull().default("pending"),
    error: text("error"),
    /**
     * Adjunto recibido (comprobantes de pago, fotos). Se guarda la REFERENCIA,
     * no el archivo: `media_url` es el enlace del proveedor, que se descarga
     * con la API key desde el servidor (nunca se expone al navegador).
     */
    mediaUrl: text("media_url"),
    mediaId: text("media_id"),
    mimeType: text("mime_type"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    waTimestamp: timestamp("wa_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    )
  ]
);
var metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    // Con Meta directo es el token de acceso; con YCloud, la API key de la
    // cuenta del cliente. Vacío = el cliente va por la cuenta de la agencia
    // (la del entorno).
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    // Secreto del webhook de la cuenta YCloud del cliente: sin él no se puede
    // verificar la firma de SUS eventos. Nulo mientras use la cuenta de la
    // agencia.
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    status: text("status", { enum: ["connected", "reconnect_required"] }).notNull().default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
    // YCloud no manda phone_number_id: el webhook enruta por el número del
    // negocio (`to`). Guardado normalizado (solo dígitos) y único por instancia
    // para que el mensaje de un cliente jamás caiga en la bandeja de otro.
    uniqueIndex("meta_credentials_display_phone_uq").on(t.displayPhoneNumber)
  ]
);
var agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    /**
     * Horario de atención, para que el agente sepa si el negocio está abierto
     * AHORA. Se calcula en el servidor y se le da resuelto: pedirle que compare
     * la hora contra un horario en prosa no es fiable — llegó a decirle a un
     * cliente que estaba abierto a medianoche. Nulo = sin horario configurado,
     * y entonces no se le dice nada.
     */
    hoursOpen: text("hours_open"),
    // "12:30"
    hoursClose: text("hours_close"),
    // "20:30"
    /** Días que abre, 1 = lunes … 7 = domingo. Ej: "1,2,3,4,5,6,7". */
    hoursDays: text("hours_days"),
    /**
     * Horario propio del domingo, cuando es distinto al del resto de la
     * semana (patrón real: entre semana un horario, domingo reducido). Si
     * ambos están definidos, el domingo SIEMPRE usa este rango — sin
     * necesidad de que el 7 esté en `hoursDays` — en vez del genérico.
     * NULL = domingo se rige por `hoursOpen`/`hoursClose`/`hoursDays` como
     * cualquier otro día (comportamiento de siempre, sin cambios).
     */
    hoursOpenSunday: text("hours_open_sunday"),
    hoursCloseSunday: text("hours_close_sunday"),
    /**
     * Números (E.164 sin '+', separados por coma) a los que se avisa por
     * WhatsApp cuando el agente cierra un pedido. La Cloud API no escribe a
     * grupos: son mensajes 1:1 a cada persona del equipo.
     */
    notifyPhones: text("notify_phones"),
    /**
     * Plantilla aprobada con un parámetro para el aviso de pedido. Sin ella el
     * aviso va como texto libre y Meta lo rechaza si el destinatario no
     * escribió al negocio en las últimas 24 h.
     */
    notifyTemplate: text("notify_template"),
    notifyTemplateLang: text("notify_template_lang"),
    /**
     * Vertical de citas (peluquería, estética, spa…), decidido al dar de alta
     * al cliente en /admin. Apagado = el cliente sigue el flujo de pedidos de
     * siempre (La Churra, Lis). No son excluyentes por diseño: un negocio
     * podría, en teoría, necesitar ambos — pero hoy ningún cliente lo pide.
     */
    appointmentsEnabled: boolean("appointments_enabled").notNull().default(false),
    /**
     * De dónde sale el catálogo de un negocio de PEDIDOS: `'prompt'` (el texto
     * de siempre, dentro de `instructions`) o `'tabla'` (las filas de
     * `product`, renderizadas frescas en cada turno).
     *
     * Es el interruptor de la Fase 1 y **el rollback**: si el catálogo
     * estructurado sale mal, se vuelve a `'prompt'` con un UPDATE de una fila,
     * sin desplegar y sin perder datos — porque el texto original no se borra
     * al migrar. Por defecto `'prompt'`: apagado hasta que su catálogo esté
     * revisado, igual que `appointments_enabled` nace en false.
     *
     * En el vertical de citas no aplica: ahí el catálogo ya vive en `service`.
     */
    catalogSource: text("catalog_source").notNull().default("prompt"),
    /**
     * FASE 2. `'prompt'` = el estado del pedido lo sostiene el modelo dentro de
     * la conversación, como hasta hoy. `'backend'` = lo mantiene el servidor en
     * `conversation_state`, validado y con el total recalculado.
     *
     * Nace en `'prompt'` y se enciende cliente por cliente. Volver atrás es un
     * UPDATE de esta columna, sin desplegar: es el mismo patrón de
     * `catalog_source`, que ya funcionó en la Fase 1.
     */
    stateSource: text("state_source").notNull().default("prompt"),
    /**
     * La ficha del negocio con la que se generó este prompt (JSON).
     *
     * Sin ella, una lección nueva en `conducta.ts` solo llegaba a los clientes
     * dados de alta **después**: el prompt queda materializado en `instructions`
     * y la ficha se perdía al terminar el alta, así que rehacerlo obligaba a
     * escribirla entera otra vez a mano. Guardándola, `regenerar-flota` vuelve a
     * ensamblar el prompt de todos con la conducta al día — que es lo que hace
     * que un arreglo valga para los diez clientes y no solo para el siguiente.
     *
     * Nulo en los prompts escritos a mano que aún no se han migrado.
     */
    ficha: text("ficha"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);
var kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    /**
     * Quién puso esta entrada. **Cada origen solo puede modificar o borrar las
     * suyas.**
     *
     * El conocimiento crece de tres sitios legítimos —el cliente en su
     * pantalla, el operador desde el laboratorio y el agente al aprender de una
     * conversación— y hasta ahora los tres escribían sobre el mismo montón. Así
     * se perdió la corrección de salud del salón: el cuestionario repuso una
     * versión vieja encima de algo que una persona había arreglado a mano.
     *
     * `cliente` por defecto: es lo que hay hoy en las 33 entradas existentes y
     * lo más restrictivo para el resto.
     */
    origen: text("origen", { enum: ["cliente", "operador", "agente"] }).notNull().default("cliente"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);
var product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Libre, no un enum: cada negocio arma sus propias categorías. */
    category: text("category"),
    /**
     * NULLABLE a propósito, al revés que `service.priceCents`.
     *
     * "No lo escribió" NO es "vale 0": si la carta del negocio no trae el
     * precio, el agente tiene que pedirlo, no regalarlo. Es la lección de
     * `docs/korexia/58-EL-CATALOGO-VIVE-EN-SERVICIOS.md`.
     */
    priceCents: integer("price_cents"),
    description: text("description"),
    /** "Hoy no hay fresa": su sitio es este, no una entrada del conocimiento. */
    available: boolean("available").notNull().default(true),
    /** Conserva el orden en que el negocio presenta su carta. */
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    index("product_org_idx").on(t.organizationId),
    // Habilita las FK compuestas de los hijos: sin esto, un grupo de opciones
    // podría colgar de un producto de OTRA organización.
    uniqueIndex("product_org_id_uq").on(t.organizationId, t.id)
  ]
);
var productOptionGroup = pgTable(
  "product_option_group",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    /** >=1 lo vuelve obligatorio: "tienes que elegir una salsa". */
    minSelect: integer("min_select").notNull().default(0),
    /** "elige hasta 2 toppings". */
    maxSelect: integer("max_select").notNull().default(1),
    /**
     * ¿Puede el cliente elegir la misma opción dos veces?
     *
     * Lo declara el negocio, y **por defecto NO**: repetir es la excepción. Un
     * Mega Box lleva cinco salsas de cuatro sabores y necesita repetir; un
     * salón con "esmaltado: tradicional + tradicional" no significa nada.
     *
     * Hasta el 17-ago-2026 esto era una regla del núcleo —primero prohibida,
     * luego universal—, decidida las dos veces por lo que necesitaba UN
     * negocio.
     */
    permiteRepeticion: boolean("permite_repeticion").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [
    index("product_option_group_org_idx").on(t.organizationId),
    uniqueIndex("product_option_group_org_id_uq").on(t.organizationId, t.id),
    // Aislamiento estructural, no por disciplina: el motor impide cruzar
    // organizaciones. Ya hubo una fuga entre clientes por un WHERE sin
    // organization_id (docs/korexia/10-SEGURIDAD.md).
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [product.organizationId, product.id],
      name: "product_option_group_product_fk"
    }).onDelete("cascade")
  ]
);
var productOption = pgTable(
  "product_option",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull(),
    name: text("name").notNull(),
    /**
     * Un solo mecanismo para dos cosas: una salsa incluida va a 0, un "queso
     * extra" a +2.000, y un tamaño mayor a +8.000 sobre el precio base.
     */
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    available: boolean("available").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [
    index("product_option_org_idx").on(t.organizationId),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [productOptionGroup.organizationId, productOptionGroup.id],
      name: "product_option_group_fk"
    }).onDelete("cascade")
  ]
);
var service = pgTable(
  "service",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Libre, no un enum: cada negocio arma sus propias categorías. */
    category: text("category"),
    priceCents: integer("price_cents").notNull().default(0),
    durationMin: integer("duration_min").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [index("service_org_idx").on(t.organizationId)]
);
var staffMember = pgTable(
  "staff_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("staff_org_idx").on(t.organizationId)]
);
var staffService = pgTable(
  "staff_service",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    staffId: text("staff_id").notNull().references(() => staffMember.id, { onDelete: "cascade" }),
    serviceId: text("service_id").notNull().references(() => service.id, { onDelete: "cascade" })
  },
  (t) => [uniqueIndex("staff_service_uq").on(t.staffId, t.serviceId)]
);
var appointment = pgTable(
  "appointment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    serviceId: text("service_id").notNull().references(() => service.id),
    staffId: text("staff_id").notNull().references(() => staffMember.id),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    status: text("status", {
      enum: [
        "pendiente",
        "confirmada",
        "reagendada",
        "cancelada",
        "completada",
        "no_show"
      ]
    }).notNull().default("pendiente"),
    /**
     * Recordatorio manual: lo dispara el personal administrativo con un botón
     * en /appointments, cuando ellos decidan — no hay ningún proceso
     * automático que revise citas próximas. Null = nunca se envió.
     */
    remindedAt: timestamp("reminded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    // Chequeo de solapamiento: todas las citas de UNA especialista, ese día.
    index("appointment_org_staff_starts_idx").on(
      t.organizationId,
      t.staffId,
      t.startsAt
    ),
    index("appointment_org_contact_idx").on(t.organizationId, t.contactId)
  ]
);
var offeredSlot = pgTable(
  "offered_slot",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    serviceId: text("service_id").notNull().references(() => service.id, { onDelete: "cascade" }),
    /** Fecha en formato DD/MM/AAAA, tal como la maneja el motor de citas. */
    fecha: text("fecha").notNull(),
    /** Hora "HH:MM" en hora de Bogotá, igual que `disponibilidadReal`. */
    hora: text("hora").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("offered_slot_conversation_idx").on(t.conversationId)]
);
var template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"]
    }).notNull().default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    )
  ]
);
var agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at")
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq").on(t.organizationId).where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt)
  ]
);
var agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null"
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"]
    }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);
var usageEvent = pgTable(
  "usage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    /** `ia` = una llamada al modelo · `whatsapp` = un mensaje saliente. */
    kind: text("kind", { enum: ["ia", "whatsapp"] }).notNull(),
    /** El modelo usado, o el tipo de mensaje (`text`, `template`). */
    detail: text("detail"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 10 }).notNull().default("0"),
    /** De dónde salió: el wamid del mensaje o de qué proceso viene. */
    ref: text("ref"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [index("usage_org_fecha_idx").on(t.organizationId, t.createdAt)]
);
var learningProposal = pgTable(
  "learning_proposal",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    /** Por qué se propone: la frase del chat que lo motivó. */
    evidence: text("evidence"),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    /** La entrada de conocimiento que se creó al aprobarla. */
    kbEntryId: text("kb_entry_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at")
  },
  (t) => [index("learning_org_status_idx").on(t.organizationId, t.status)]
);
var webhookEvent = pgTable(
  "webhook_event",
  {
    id: text("id").primaryKey(),
    /** "agencia" (webhook único) o el organizationId de la puerta propia del cliente. */
    source: text("source").notNull(),
    /** Cuerpo exacto tal como llegó — sobrevive aunque no sea JSON válido. */
    rawBody: text("raw_body").notNull(),
    /** `rawBody` parseado, cuando es JSON válido. NULL si el parseo falló. */
    payload: jsonb("payload"),
    headers: jsonb("headers").notNull(),
    signature: text("signature"),
    /**
     * A qué organización terminó perteneciendo, una vez resuelto (por
     * número/wabaId). NULL si no se pudo resolver — eso también es una
     * señal útil (número desconocido, cliente mal configurado).
     */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null"
    }),
    status: text("status", { enum: ["recibido", "procesado", "fallido"] }).notNull().default("recibido"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at")
  },
  (t) => [
    index("webhook_event_status_idx").on(t.status),
    index("webhook_event_org_idx").on(t.organizationId)
  ]
);
var agentJob = pgTable(
  "agent_job",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pendiente", "corriendo", "fallido"] }).notNull().default("pendiente"),
    /** Cuándo toca ejecutarlo. Lo empuja cada mensaje nuevo: es el debounce. */
    runAt: timestamp("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    /**
     * Quién lo tomó y cuándo. Si el proceso muere, `rescatarHuerfanos` los
     * devuelve a la cola por este campo: es lo que impide que un reinicio
     * deje a un cliente sin respuesta.
     */
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [
    /**
     * Como mucho UN trabajo pendiente por conversación — es la coalescencia
     * que antes hacía `clearTimeout`. Parcial a propósito: mientras uno está
     * `corriendo`, se admite crear el siguiente `pendiente` (equivale al
     * `pending: true` del código viejo), y así los mensajes que llegan a
     * mitad de turno se atienden juntos en el turno siguiente.
     */
    uniqueIndex("agent_job_conv_pendiente_uq").on(t.conversationId).where(sql`status = 'pendiente'`),
    index("agent_job_listos_idx").on(t.status, t.runAt),
    index("agent_job_org_idx").on(t.organizationId)
  ]
);
var rateLimitHit = pgTable(
  "rate_limit_hit",
  {
    id: text("id").primaryKey(),
    /** Clave del cubo: `${ruta}:${ip}`. */
    key: text("key").notNull(),
    at: timestamp("at").notNull().defaultNow()
  },
  (t) => [index("rate_limit_key_at_idx").on(t.key, t.at)]
);
var mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Para qué sirve la foto:
     * `producto` — se manda cuando preguntan por ese artículo concreto.
     * `carta`    — el menú completo, para quien pide "el menú".
     * `otro`     — el local, el equipo, lo que el negocio quiera.
     */
    kind: text("kind", { enum: ["producto", "carta", "otro"] }).notNull(),
    /**
     * Con qué se relaciona, en palabras del negocio ("Volumen Ruso").
     * Es lo que el agente compara para decidir qué foto mandar, así que se
     * guarda tal como el cliente nombra sus productos.
     */
    etiqueta: text("etiqueta").notNull(),
    mimeType: text("mime_type").notNull(),
    /** La imagen en base64, sin el prefijo `data:`. */
    datos: text("datos").notNull(),
    /** Bytes reales del archivo, para poder medir sin descodificar. */
    tamano: integer("tamano").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => [
    index("media_org_idx").on(t.organizationId),
    // Un negocio no debe tener dos fotos para lo mismo: subir otra reemplaza.
    uniqueIndex("media_org_etiqueta_uq").on(t.organizationId, t.etiqueta)
  ]
);
var conversationState = pgTable("conversation_state", {
  conversationId: text("conversation_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  estado: jsonb("estado").notNull(),
  /** Para poder cambiar la forma del JSON sin adivinar cuál es cuál. */
  schemaVersion: integer("schema_version").notNull().default(1),
  /** Dónde se quedó. Existe para que "dónde se cae la gente" sea un GROUP BY. */
  paso: text("paso"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

// src/lib/db/index.ts
var globalForDb = globalThis;
function createClient() {
  const env = getEnv();
  return postgres(env.DATABASE_URL, {
    max: 10,
    onnotice: () => {
    }
  });
}
function getSql() {
  if (!globalForDb.__voceroSql) globalForDb.__voceroSql = createClient();
  return globalForDb.__voceroSql;
}
var cachedDb = null;
function getDb() {
  if (!cachedDb) cachedDb = drizzle(getSql(), { schema: schema_exports });
  return cachedDb;
}

// src/lib/db/ids.ts
import { customAlphabet } from "nanoid";
var alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
var nano = customAlphabet(alphabet, 20);
var prefixes = {
  organization: "org",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  usage: "use",
  mediaAsset: "med",
  learning: "lrn",
  service: "svc",
  staffMember: "stf",
  staffService: "ss",
  appointment: "apt",
  offeredSlot: "ofs",
  webhookEvent: "whev",
  agentJob: "job",
  rateLimitHit: "rl",
  product: "prod",
  productOptionGroup: "pog",
  productOption: "popt"
};
function newId(kind) {
  return `${prefixes[kind]}_${nano()}`;
}

// src/server/ai/generador/comparar-fila.ts
function iguales(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === void 0 || b === void 0) return false;
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
function compararFila(antes, despues, declarados) {
  const campos = /* @__PURE__ */ new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const cambiosDeclarados = [];
  const noDeclarados = [];
  for (const campo of campos) {
    if (iguales(antes[campo], despues[campo])) continue;
    const dif = { campo, de: antes[campo], a: despues[campo] };
    if (declarados.includes(campo)) cambiosDeclarados.push(dif);
    else noDeclarados.push(dif);
  }
  const declaradosSinCambio = declarados.filter(
    (c) => !cambiosDeclarados.some((d) => d.campo === c)
  );
  return {
    ok: noDeclarados.length === 0,
    declarados: cambiosDeclarados,
    noDeclarados,
    declaradosSinCambio
  };
}
function explicar(c) {
  const recorta = (v) => {
    const s = v === null || v === void 0 ? String(v) : String(v);
    return s.length > 70 ? `${s.slice(0, 70)}\u2026` : s;
  };
  const lineas = [];
  for (const d of c.declarados) {
    lineas.push(`  \u2705 ${d.campo}: ${recorta(d.de)} \u2192 ${recorta(d.a)}`);
  }
  for (const d of c.noDeclarados) {
    lineas.push(`  \u{1F534} ${d.campo} CAMBI\xD3 SIN DECLARARSE: ${recorta(d.de)} \u2192 ${recorta(d.a)}`);
  }
  for (const campo of c.declaradosSinCambio) {
    lineas.push(`  \u26A0\uFE0F  ${campo}: se declar\xF3 pero no cambi\xF3`);
  }
  return lineas.join("\n") || "  (la fila no cambi\xF3 en absoluto)";
}

// src/server/orders/estado.ts
import { eq } from "drizzle-orm";

// src/server/orders/normalizar.ts
function llave(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
}
function unidadesQueMenciona(texto) {
  const m = texto.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
var MAX_ITEMS = 40;
function resolverItem(propuesto, catalogo, porNombre, opcionesConocidas, correcciones, dudas, unidadesPorProducto) {
  let producto;
  const crudo = propuesto.ofrecible?.trim() ?? "";
  if (crudo) {
    producto = porNombre.get(llave(crudo));
    if (!producto) {
      for (const [k, p] of porNombre) {
        if (llave(crudo).includes(k)) {
          producto = p;
          correcciones.push({
            campo: "producto",
            de: crudo,
            a: p.nombre,
            regla: "el nombre de la presentaci\xF3n ven\xEDa dentro de una frase"
          });
          break;
        }
      }
    } else if (crudo !== producto.nombre) {
      correcciones.push({
        campo: "producto",
        de: crudo,
        a: producto.nombre,
        regla: "mismo producto escrito distinto (may\xFAsculas, tildes o plural)"
      });
    }
    if (!producto) {
      const comoOpcion = opcionesConocidas.get(llave(crudo));
      if (comoOpcion) {
        correcciones.push({
          campo: "producto",
          de: crudo,
          a: `${comoOpcion.grupo.toLowerCase()}: ${crudo}`,
          regla: "es una opci\xF3n, no una presentaci\xF3n"
        });
        if (!propuesto.opciones.some((o) => llave(o.opcion) === llave(crudo))) {
          propuesto = {
            ...propuesto,
            opciones: [...propuesto.opciones, { grupo: comoOpcion.grupo, opcion: crudo }]
          };
        }
        dudas.push({
          campo: "producto",
          porque: `"${crudo}" es ${comoOpcion.grupo.toLowerCase()}, y no dice qu\xE9 presentaci\xF3n quiere`,
          preguntar: "\xBFCu\xE1l presentaci\xF3n desea?"
        });
      }
    }
    if (!producto && dudas.length === 0) {
      const n = unidadesQueMenciona(crudo) ?? propuesto.cantidad;
      const porUnidades = n === null ? void 0 : buscarPorUnidades(n, catalogo, unidadesPorProducto);
      if (porUnidades) {
        producto = porUnidades;
        correcciones.push({
          campo: "producto",
          de: crudo,
          a: porUnidades.nombre,
          regla: `${n} unidades es la presentaci\xF3n ${porUnidades.nombre}`
        });
        if (unidadesQueMenciona(crudo) === null && propuesto.cantidad === n) {
          dudas.push({
            campo: "cantidad",
            porque: `dijo ${n} y una ${porUnidades.nombre} trae justo ${n}: puede ser una sola presentaci\xF3n`,
            preguntar: `\xBFDesea ${n} ${porUnidades.nombre} o una sola?`
          });
          correcciones.push({
            campo: "cantidad",
            de: String(propuesto.cantidad),
            a: "1",
            regla: "n\xFAmero de unidades tomado como n\xFAmero de presentaciones"
          });
          propuesto = { ...propuesto, cantidad: 1 };
        }
      } else {
        dudas.push({
          campo: "producto",
          porque: n === null ? `"${crudo}" no es ninguna presentaci\xF3n de la carta` : `"${crudo}" habla de ${n} unidades, y la carta no dice cu\xE1ntas trae cada presentaci\xF3n`,
          preguntar: "\xBFCu\xE1l presentaci\xF3n desea?"
        });
      }
    }
  } else {
    dudas.push({
      campo: "producto",
      porque: "todav\xEDa no ha elegido presentaci\xF3n",
      preguntar: "\xBFCu\xE1l presentaci\xF3n desea?"
    });
  }
  let cantidad = propuesto.cantidad ?? 1;
  if (producto) {
    const unidades = unidadesDe(producto, unidadesPorProducto);
    if (propuesto.cantidad !== null && unidades !== null && propuesto.cantidad === unidades) {
      dudas.push({
        campo: "cantidad",
        porque: `pidi\xF3 ${propuesto.cantidad} y una ${producto.nombre} trae justo ${unidades}: puede ser una sola presentaci\xF3n`,
        preguntar: `\xBFDesea ${propuesto.cantidad} ${producto.nombre} o una sola?`
      });
      cantidad = 1;
      correcciones.push({
        campo: "cantidad",
        de: String(propuesto.cantidad),
        a: "1",
        regla: "n\xFAmero de unidades tomado como n\xFAmero de presentaciones"
      });
    }
    if (propuesto.cantidad === null) {
      correcciones.push({
        campo: "cantidad",
        de: "null",
        a: "1",
        regla: "una presentaci\xF3n sin n\xFAmero es una"
      });
    }
  }
  if (cantidad < 1) cantidad = 1;
  const seleccion = [];
  if (producto) {
    for (const propuesta of propuesto.opciones) {
      const cruda = propuesta.opcion?.trim();
      if (!cruda) continue;
      const candidatos = producto.grupos.filter((g2) => propuesta.grupo ? llave(g2.nombre).startsWith(llave(propuesta.grupo)) : true).flatMap(
        (g2) => g2.opciones.filter((o2) => llave(o2.nombre) === llave(cruda)).map((o2) => ({ g: g2, o: o2 }))
      );
      if (candidatos.length === 0) {
        const todas = producto.grupos.flatMap((g2) => g2.opciones.map((o2) => o2.nombre));
        dudas.push({
          campo: propuesta.grupo ?? "opciones",
          porque: `"${cruda}" no est\xE1 entre las opciones de ${producto.nombre}`,
          preguntar: todas.length ? `\xBFCu\xE1l desea? Hay: ${[...new Set(todas)].join(", ")}` : `\xBFQu\xE9 desea de ${producto.nombre}?`
        });
        continue;
      }
      if (candidatos.length > 1) {
        dudas.push({
          campo: propuesta.grupo ?? "opciones",
          porque: `"${cruda}" est\xE1 en ${candidatos.length} grupos de ${producto.nombre} y no se dijo cu\xE1l`,
          preguntar: `\xBF"${cruda}" como ${candidatos.map((c) => c.g.nombre.toLowerCase()).join(" o como ")}?`
        });
        continue;
      }
      const { g, o } = candidatos[0];
      if (o.nombre !== cruda) {
        correcciones.push({
          campo: g.nombre.toLowerCase(),
          de: cruda,
          a: o.nombre,
          regla: "nombre de opci\xF3n normalizado"
        });
      }
      const yaEstaba = seleccion.some((sel) => sel.opcionId === o.id);
      if (yaEstaba && !g.permiteRepeticion) {
        dudas.push({
          campo: g.nombre.toLowerCase(),
          porque: `${o.nombre} ya estaba elegida y ${g.nombre.toLowerCase()} no admite repetir`,
          preguntar: `${o.nombre} ya est\xE1 en tu ${g.nombre.toLowerCase()}. \xBFQuer\xEDas otra distinta?`
        });
        continue;
      }
      seleccion.push({
        grupoId: g.id,
        grupoNombre: g.nombre,
        opcionId: o.id,
        nombre: o.nombre,
        precioDeltaCents: o.precioExtraCents
      });
    }
    for (const g of producto.grupos) {
      if (g.opciones.length === 0) continue;
      const elegidas = seleccion.filter((s) => s.grupoId === g.id).length;
      const etiqueta = g.nombre.toLowerCase();
      if (elegidas < g.minimo) {
        const faltan = g.minimo - elegidas;
        dudas.push({
          campo: etiqueta,
          porque: `${producto.nombre} lleva ${g.minimo} de ${etiqueta} y hay ${elegidas}`,
          preguntar: `\xBFCu\xE1l${faltan > 1 ? "es" : ""} ${etiqueta} desea?`
        });
      }
      if (g.maximo > 0 && elegidas > g.maximo) {
        dudas.push({
          campo: etiqueta,
          porque: `${producto.nombre} lleva ${g.maximo} de ${etiqueta} y pidi\xF3 ${elegidas}`,
          preguntar: `Una ${producto.nombre} lleva ${g.maximo} de ${etiqueta}. \xBFCu\xE1les deja?`
        });
      }
    }
  } else {
    for (const propuesta of propuesto.opciones) {
      const cruda = propuesta.opcion?.trim();
      if (cruda && opcionesConocidas.has(llave(cruda))) {
        seleccion.push({
          grupoId: "",
          grupoNombre: propuesta.grupo ?? "",
          opcionId: "",
          nombre: cruda,
          precioDeltaCents: 0
        });
      }
    }
  }
  let totalCents = null;
  if (producto && dudas.length === 0) {
    if (producto.precioCents === null) {
      dudas.push({
        campo: "total",
        porque: `${producto.nombre} no tiene precio cargado`,
        preguntar: "el equipo confirma el precio"
      });
    } else {
      const extras = seleccion.reduce((suma, s) => suma + s.precioDeltaCents, 0);
      totalCents = (producto.precioCents + extras) * cantidad;
    }
  }
  return {
    ofrecibleId: producto?.id ?? null,
    ofrecible: producto?.nombre ?? null,
    cantidad,
    seleccion,
    totalCents
  };
}
function faltaDelItem(item, catalogo) {
  const falta = [];
  const ofrecible = catalogo.find((p) => p.id === item.ofrecibleId);
  if (!ofrecible) return ["presentaci\xF3n"];
  for (const g of ofrecible.grupos) {
    if (g.opciones.length === 0 || g.minimo < 1) continue;
    const elegidas = item.seleccion.filter((s) => s.grupoId === g.id).length;
    if (elegidas < g.minimo) falta.push(g.nombre.toLowerCase());
  }
  return falta;
}
function normalizarPedido(propuesto, catalogo, unidadesPorProducto, requisitos = []) {
  const correcciones = [];
  const dudas = [];
  const porNombre = new Map(catalogo.map((p) => [llave(p.nombre), p]));
  const opcionesConocidas = /* @__PURE__ */ new Map();
  for (const p of catalogo) {
    for (const g of p.grupos) {
      for (const o of g.opciones) {
        opcionesConocidas.set(llave(o.nombre), { grupo: g.nombre, producto: p.nombre });
      }
    }
  }
  const propuestos = propuesto.items ?? [];
  const items = propuestos.slice(0, MAX_ITEMS).map(
    (item) => resolverItem(item, catalogo, porNombre, opcionesConocidas, correcciones, dudas, unidadesPorProducto)
  );
  if (propuestos.length > MAX_ITEMS) {
    dudas.push({
      campo: "items",
      porque: `el pedido trae ${propuestos.length} elementos y el m\xE1ximo es ${MAX_ITEMS}`,
      preguntar: `Solo puedo tomar ${MAX_ITEMS} cosas en un mismo pedido. \xBFLo dividimos en dos?`
    });
  }
  if (items.length === 0) {
    items.push(
      resolverItem(
        { ofrecible: null, cantidad: null, opciones: [] },
        catalogo,
        porNombre,
        opcionesConocidas,
        correcciones,
        dudas,
        unidadesPorProducto
      )
    );
  }
  const totalCents = items.some((i) => i.totalCents === null) ? null : items.reduce((suma, i) => suma + (i.totalCents ?? 0), 0);
  const faltaParaCerrar = [];
  for (const item of items) {
    for (const f of faltaDelItem(item, catalogo)) {
      faltaParaCerrar.push(items.length > 1 && item.ofrecible ? `${f} de ${item.ofrecible}` : f);
    }
  }
  for (const r of requisitos) {
    if (!r.obligatorio) continue;
    if (!propuesto.datos?.[r.id]?.trim()) faltaParaCerrar.push(r.etiqueta);
  }
  return {
    faltaParaCerrar,
    estado: { items, totalCents },
    correcciones,
    dudas,
    reconstruible: dudas.length === 0 && totalCents !== null
  };
}
function unidadesDe(producto, unidades) {
  if (!unidades) return null;
  const encontrado = Object.entries(unidades).find(([k]) => llave(k) === llave(producto.nombre));
  return encontrado ? encontrado[1] : null;
}
function buscarPorUnidades(n, catalogo, unidades) {
  if (!unidades) return void 0;
  return catalogo.find((p) => unidadesDe(p, unidades) === n);
}

// src/server/registro-de-cambios.ts
import { createHash, createHmac } from "node:crypto";
var SECRETOS = [
  "accessToken",
  "token",
  "apiKey",
  "password",
  "secret",
  "phoneNumberId",
  "wabaId"
];
var PERSONALES = [
  "notifyphones",
  "telefono",
  "direccion",
  "phone",
  "address"
];
var PARECE_IDENTIFICADOR = /\d{7,}/;
var CLASIFICACION = {
  agent_profile: {
    id: "tecnico",
    organizationId: "tecnico",
    enabled: "tecnico",
    appointmentsEnabled: "tecnico",
    catalogSource: "tecnico",
    stateSource: "tecnico",
    createdAt: "tecnico",
    updatedAt: "tecnico",
    // `name` aquí es el nombre del ASISTENTE, no el de una persona.
    name: "negocio",
    tone: "negocio",
    instructions: "negocio",
    escalationRules: "negocio",
    greeting: "negocio",
    hoursOpen: "negocio",
    hoursClose: "negocio",
    hoursDays: "negocio",
    hoursOpenSunday: "negocio",
    hoursCloseSunday: "negocio",
    notifyTemplate: "negocio",
    notifyTemplateLang: "negocio",
    ficha: "negocio",
    // Teléfonos de personas del equipo.
    notifyPhones: "personal"
  },
  organization: {
    id: "tecnico",
    slug: "tecnico",
    createdAt: "tecnico",
    // Razón social del negocio, no el nombre de su dueña.
    name: "negocio",
    logo: "negocio",
    metadata: "negocio"
  },
  conversation_state: {
    conversationId: "tecnico",
    organizationId: "tecnico",
    schemaVersion: "tecnico",
    createdAt: "tecnico",
    updatedAt: "tecnico",
    /*
     * v4 (17-ago): las claves llevan la POSICIÓN del ítem —`items.0.nombre`,
     * `items.1.seleccion`— porque un pedido lleva varios, y se clasifican **por
     * prefijo**, igual que `datos`: `clasificar` hereda del primer tramo.
     *
     * Así un pedido de cinco cosas no obliga a escribir veinticinco líneas
     * aquí, y el ítem nº 6 no sale `<sin clasificar>` el día que alguien pida
     * uno más. Nada de esto es personal: es qué se pidió, no quién lo pidió.
     */
    items: "negocio",
    /*
     * v2 (17-ago): una sola clave para todo lo elegido. Antes había una por
     * grupo —`salsas`, `recubierto`, `adiciones`—, así que **la clasificación
     * de un negocio concreto vivía en el módulo de registro del núcleo**: el
     * día que un salón instrumentara `esmalte`, su valor habría salido como
     * `<sin clasificar>` sin que nadie supiera por qué.
     */
    seleccion: "negocio",
    totalCents: "negocio",
    paso: "negocio",
    confirmado: "negocio",
    /*
     * La columna JSONB entera lleva los datos de entrega dentro. Clasificarla
     * como personal cierra el resquicio de que un estado corto —menos de 120
     * caracteres— se volcara entero por no llegar al límite de longitud.
     */
    estado: "personal",
    /*
     * Los datos de cierre van por prefijo, no uno a uno: sus claves las declara
     * cada negocio (`datos.telefono`, `datos.mesa`…) y una lista escrita aquí
     * volvería a quedarse corta con el primer cliente que declare algo nuevo.
     *
     * TODO EL BLOQUE ES PERSONAL por definición: son datos que el cliente
     * cuenta sobre sí mismo.
     */
    datos: "personal"
  },
  /** No es una tabla: son los campos de `registrarMetricaDeEstado`. */
  metrica: {
    paso: "negocio",
    producto: "negocio",
    motivos: "negocio",
    detalle: "negocio"
  }
};
function clasificar(tabla, campo) {
  const directa = CLASIFICACION[tabla]?.[campo];
  if (directa) return directa;
  const bloque = campo.split(".")[0];
  return bloque && bloque !== campo ? CLASIFICACION[tabla]?.[bloque] ?? null : null;
}
var TABLAS_CLASIFICADAS = Object.keys(CLASIFICACION);
var LARGO_MAXIMO = 120;
function esSecreto(campo) {
  const c = campo.toLowerCase();
  return SECRETOS.some((s) => c.includes(s.toLowerCase()));
}
function esPersonal(campo) {
  return PERSONALES.includes(campo.toLowerCase());
}
var claveDeHuella;
var yaAviso = false;
function clave() {
  if (claveDeHuella !== void 0) return claveDeHuella;
  try {
    const bruta = process.env.ENCRYPTION_KEY;
    const buf = bruta ? Buffer.from(bruta, "base64") : null;
    claveDeHuella = buf && buf.length === 32 ? buf : null;
  } catch {
    claveDeHuella = null;
  }
  if (!claveDeHuella && !yaAviso) {
    yaAviso = true;
    console.warn(
      "[cambio] sin ENCRYPTION_KEY v\xE1lida: las huellas van sin clave y son reconstruibles por fuerza bruta. Solo deber\xEDa pasar fuera de producci\xF3n."
    );
  }
  return claveDeHuella;
}
function huellaDe(texto) {
  const k = clave();
  const digest = k ? createHmac("sha256", k).update(texto, "utf8").digest("hex") : createHash("sha256").update(texto, "utf8").digest("hex");
  return digest.slice(0, 12);
}
function paraLog(tabla, campo, valor) {
  const clase = clasificar(tabla, campo);
  if (clase === "secreto" || esSecreto(campo)) return "<oculto>";
  if (valor === null) return "null";
  if (valor === void 0) return "ausente";
  if (valor instanceof Date) return valor.toISOString();
  const texto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  if (clase === "personal" || esPersonal(campo) || typeof valor === "string" && PARECE_IDENTIFICADOR.test(texto)) {
    return `<personal \xB7 ${texto.length} caracteres \xB7 huella ${huellaDe(texto)}>`;
  }
  if (clase === null && typeof valor !== "number" && typeof valor !== "boolean") {
    return `<sin clasificar \xB7 ${texto.length} caracteres \xB7 huella ${huellaDe(texto)}>`;
  }
  if (texto.length <= LARGO_MAXIMO) {
    return texto.replace(/\s+/g, " ");
  }
  return `<${texto.length} caracteres \xB7 huella ${huellaDe(texto)}>`;
}

// src/server/orders/estado.ts
var SCHEMA_VERSION = 4;
function estadoVacio() {
  return {
    schema_version: SCHEMA_VERSION,
    items: [],
    datos: {},
    totalCents: null,
    paso: "sin pedido",
    confirmado: false
  };
}
function itemsDe(propuesta) {
  if (propuesta.items?.length) return propuesta.items;
  const suelto = propuesta.ofrecible ?? propuesta.producto;
  if (suelto || propuesta.opciones?.length || propuesta.cantidad != null) {
    return [
      {
        ofrecible: suelto ?? null,
        cantidad: propuesta.cantidad ?? null,
        opciones: propuesta.opciones ?? []
      }
    ];
  }
  return [];
}
function validarPropuesta(propuesta, catalogo, unidadesPorProducto, requisitos) {
  const rechazos = [];
  const items = itemsDe(propuesta);
  const r = normalizarPedido(
    { items, datos: propuesta.datos ?? {} },
    catalogo,
    unidadesPorProducto,
    requisitos ?? []
  );
  for (const item of items) {
    const cruda = item.cantidad;
    if (cruda !== null && cruda !== void 0 && (!Number.isInteger(cruda) || cruda < 1)) {
      rechazos.push(`cantidad inv\xE1lida: ${cruda}`);
    }
  }
  const confirmado = propuesta.confirmado === true;
  const estado = {
    schema_version: SCHEMA_VERSION,
    items: r.estado.items.map((i) => ({
      ofrecible: { id: i.ofrecibleId, nombre: i.ofrecible },
      cantidad: Number.isInteger(i.cantidad) && i.cantidad >= 1 ? i.cantidad : 1,
      seleccion: i.seleccion,
      totalCents: i.totalCents
    })),
    datos: propuesta.datos ?? {},
    totalCents: r.estado.totalCents,
    // `paso` llega como número cuando el prompt del negocio numera sus mensajes.
    paso: String(propuesta.paso ?? "sin pedido"),
    confirmado
  };
  if (confirmado) {
    if (estado.items.length === 0) rechazos.push("confirmado sin nada pedido");
    if (estado.items.some((i) => !i.ofrecible.id)) {
      rechazos.push("confirmado sin producto resuelto");
    }
    if (estado.totalCents === null) rechazos.push("confirmado sin total calculado");
    if (!requisitos) {
      rechazos.push("confirmado sin requisitos declarados en la ficha del negocio");
    }
    for (const r2 of requisitos ?? []) {
      if (r2.obligatorio && !estado.datos[r2.id]?.trim()) {
        rechazos.push(`confirmado sin ${r2.etiqueta}`);
      }
    }
  }
  for (const d of r.dudas) {
    if (d.porque.includes("no est\xE1 entre las opciones")) rechazos.push(d.porque);
  }
  return {
    ok: rechazos.length === 0,
    estado,
    rechazos,
    correcciones: r.correcciones.map((c) => `${c.campo}: \xAB${c.de}\xBB \u2192 \xAB${c.a}\xBB (${c.regla})`),
    dudas: r.dudas.map((d) => ({ campo: d.campo, preguntar: d.preguntar }))
  };
}
async function leerEstado(conversationId) {
  const db2 = getDb();
  const [fila] = await db2.select().from(conversationState).where(eq(conversationState.conversationId, conversationId));
  if (!fila) return null;
  const guardado = fila.estado;
  if (!guardado || typeof guardado !== "object" || guardado.schema_version > SCHEMA_VERSION) {
    return null;
  }
  return guardado;
}
async function guardarEstado(entrada) {
  const db2 = getDb();
  const anterior = await leerEstado(entrada.conversationId);
  await db2.insert(conversationState).values({
    conversationId: entrada.conversationId,
    organizationId: entrada.organizationId,
    estado: entrada.estado,
    schemaVersion: entrada.estado.schema_version,
    paso: entrada.estado.paso,
    updatedAt: /* @__PURE__ */ new Date()
  }).onConflictDoUpdate({
    target: conversationState.conversationId,
    set: {
      estado: entrada.estado,
      schemaVersion: entrada.estado.schema_version,
      paso: entrada.estado.paso,
      updatedAt: /* @__PURE__ */ new Date()
    }
  });
  registrarCambioDeEstado({
    conversationId: entrada.conversationId,
    antes: anterior,
    despues: entrada.estado,
    actor: entrada.actor,
    proceso: entrada.proceso
  });
}
async function borrarEstado(conversationId, opciones) {
  const db2 = getDb();
  const anterior = await leerEstado(conversationId);
  await db2.delete(conversationState).where(eq(conversationState.conversationId, conversationId));
  if (anterior) {
    registrarCambioDeEstado({
      conversationId,
      antes: anterior,
      despues: null,
      actor: opciones.actor,
      proceso: opciones.proceso
    });
  }
}
function aplanar(e) {
  if (!e) return {};
  return {
    // Una clave por ítem y campo, con su posición: así el registro de cambios
    // dice CUÁL cambió en vez de "el pedido es distinto".
    ...Object.fromEntries(
      e.items.flatMap((i, n) => [
        [`items.${n}.id`, i.ofrecible.id],
        [`items.${n}.nombre`, i.ofrecible.nombre],
        [`items.${n}.cantidad`, i.cantidad],
        [`items.${n}.seleccion`, i.seleccion.map((s) => `${s.grupoNombre}:${s.nombre}`).join(", ")],
        [`items.${n}.totalCents`, i.totalCents]
      ])
    ),
    // Una clave por dato recogido: `datos.telefono`, `datos.mesa`… Todas
    // personales, porque el bloque entero lo es.
    ...Object.fromEntries(Object.entries(e.datos).map(([id, v]) => [`datos.${id}`, v])),
    totalCents: e.totalCents,
    paso: e.paso,
    confirmado: e.confirmado
  };
}
function registrarCambioDeEstado(entrada) {
  try {
    const a = aplanar(entrada.antes);
    const b = aplanar(entrada.despues);
    const campos = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
    const timestamp2 = (/* @__PURE__ */ new Date()).toISOString();
    for (const campo of campos) {
      if (a[campo] === b[campo]) continue;
      console.log(
        `[cambio] tabla=conversation_state registro=${entrada.conversationId} campo=${campo} valor_anterior=${paraLog("conversation_state", campo, a[campo])} valor_nuevo=${paraLog("conversation_state", campo, b[campo])} proceso=${entrada.proceso} actor=${entrada.actor} timestamp=${timestamp2}`
      );
    }
  } catch (err) {
    console.warn(`[cambio] no se pudo registrar el estado: ${err.message}`);
  }
}

// src/server/orders/extraer.ts
function loQueFalta(estado, catalogo = [], requisitos = []) {
  const falta = [];
  const variosItems = estado.items.length > 1;
  if (estado.items.length === 0) falta.push("presentaci\xF3n");
  for (const item of estado.items) {
    if (!item.ofrecible.id) {
      falta.push("presentaci\xF3n");
      continue;
    }
    const ofrecible = catalogo.find((p) => p.id === item.ofrecible.id);
    for (const g of ofrecible?.grupos ?? []) {
      if (g.opciones.length === 0 || g.minimo < 1) continue;
      const elegidas = item.seleccion.filter((s) => s.grupoId === g.id).length;
      if (elegidas < g.minimo) {
        const nombre = g.nombre.toLowerCase();
        falta.push(variosItems ? `${nombre} de ${item.ofrecible.nombre}` : nombre);
      }
    }
  }
  for (const r of requisitos) {
    if (r.obligatorio && !estado.datos[r.id]?.trim()) falta.push(r.etiqueta);
  }
  return falta;
}
function comoTexto(estado, catalogo = [], requisitos = []) {
  const conAlgo = estado.items.filter((i) => i.ofrecible.id || i.seleccion.length > 0);
  if (conAlgo.length === 0) return "";
  const partes = [];
  for (const item of conAlgo) {
    const cabecera = item.ofrecible.nombre ? `${item.cantidad} \xD7 ${item.ofrecible.nombre}` : "(sin elegir todav\xEDa)";
    const porGrupo = /* @__PURE__ */ new Map();
    for (const s of item.seleccion) {
      const clave2 = s.grupoNombre || "opciones";
      porGrupo.set(clave2, [...porGrupo.get(clave2) ?? [], s.nombre]);
    }
    const opciones = [...porGrupo].map(([grupo, nombres]) => `${grupo.toLowerCase()}: ${nombres.join(", ")}`).join(" \xB7 ");
    partes.push(opciones ? `${cabecera} (${opciones})` : cabecera);
  }
  for (const r of requisitos) {
    const valor = estado.datos[r.id];
    if (!valor?.trim()) continue;
    const personal = r.tipo !== "texto";
    partes.push(personal ? `${r.etiqueta}: ya est\xE1` : `${r.etiqueta}: ${valor}`);
  }
  const falta = loQueFalta(estado, catalogo, requisitos);
  const total = estado.totalCents === null ? "" : `
TOTAL (lo calcul\xF3 el sistema, \xFAsalo tal cual): $${(estado.totalCents / 100).toLocaleString("es-CO")}`;
  return `PEDIDO EN CURSO \u2014 no vuelvas a preguntar nada de esto:
${partes.join(" \xB7 ")}` + total + (falta.length ? `
TE FALTA, en este orden: ${falta.join(", ")}` : "\nNo falta nada: ve al resumen.");
}

// src/server/catalog/queries.ts
import { asc, eq as eq3, isNull } from "drizzle-orm";

// src/lib/db/tenant.ts
import { and, eq as eq2 } from "drizzle-orm";
function scoped(organizationColumn, organizationId, ...conditions) {
  if (!organizationId) {
    throw new Error("scoped(): organizationId vac\xEDo \u2014 query sin tenant");
  }
  const base = eq2(organizationColumn, organizationId);
  const rest = conditions.filter((c) => c !== void 0);
  return rest.length > 0 ? and(base, ...rest) : base;
}

// src/server/catalog/queries.ts
async function catalogoDePedidos(organizationId) {
  const db2 = getDb();
  const productos = await db2.select({
    id: schema_exports.product.id,
    nombre: schema_exports.product.name,
    categoria: schema_exports.product.category,
    precioCents: schema_exports.product.priceCents,
    descripcion: schema_exports.product.description
  }).from(schema_exports.product).where(
    scoped(
      schema_exports.product.organizationId,
      organizationId,
      isNull(schema_exports.product.archivedAt),
      eq3(schema_exports.product.available, true)
    )
  ).orderBy(asc(schema_exports.product.position), asc(schema_exports.product.name));
  if (productos.length === 0) return [];
  const grupos = await db2.select({
    id: schema_exports.productOptionGroup.id,
    productId: schema_exports.productOptionGroup.productId,
    nombre: schema_exports.productOptionGroup.name,
    minimo: schema_exports.productOptionGroup.minSelect,
    maximo: schema_exports.productOptionGroup.maxSelect,
    permiteRepeticion: schema_exports.productOptionGroup.permiteRepeticion
  }).from(schema_exports.productOptionGroup).where(scoped(schema_exports.productOptionGroup.organizationId, organizationId)).orderBy(asc(schema_exports.productOptionGroup.position));
  const opciones = await db2.select({
    id: schema_exports.productOption.id,
    groupId: schema_exports.productOption.groupId,
    nombre: schema_exports.productOption.name,
    precioExtraCents: schema_exports.productOption.priceDeltaCents
  }).from(schema_exports.productOption).where(
    scoped(
      schema_exports.productOption.organizationId,
      organizationId,
      eq3(schema_exports.productOption.available, true)
    )
  ).orderBy(asc(schema_exports.productOption.position));
  const opcionesPorGrupo = /* @__PURE__ */ new Map();
  for (const o of opciones) {
    const arr = opcionesPorGrupo.get(o.groupId) ?? [];
    arr.push({
      id: o.id,
      nombre: o.nombre,
      precioExtraCents: o.precioExtraCents
    });
    opcionesPorGrupo.set(o.groupId, arr);
  }
  const gruposPorProducto = /* @__PURE__ */ new Map();
  for (const g of grupos) {
    const arr = gruposPorProducto.get(g.productId) ?? [];
    arr.push({
      id: g.id,
      nombre: g.nombre,
      minimo: g.minimo,
      maximo: g.maximo,
      permiteRepeticion: g.permiteRepeticion,
      opciones: opcionesPorGrupo.get(g.id) ?? []
    });
    gruposPorProducto.set(g.productId, arr);
  }
  return productos.map((p) => ({
    ...p,
    grupos: gruposPorProducto.get(p.id) ?? []
  }));
}
async function catalogoDe(organizationId, vertical) {
  if (vertical === "pedidos") return catalogoDePedidos(organizationId);
  const db2 = getDb();
  const servicios = await db2.select({
    id: schema_exports.service.id,
    nombre: schema_exports.service.name,
    categoria: schema_exports.service.category,
    precioCents: schema_exports.service.priceCents,
    duracionMin: schema_exports.service.durationMin
  }).from(schema_exports.service).where(scoped(schema_exports.service.organizationId, organizationId)).orderBy(asc(schema_exports.service.name));
  return servicios.map((s) => ({
    ...s,
    descripcion: null,
    grupos: []
  }));
}

// src/lib/hora.ts
function normalizarHora(texto) {
  const t = (texto ?? "").toLowerCase().replace(/[.\s]/g, "");
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let hora = Number(m[1]);
  const minuto = Number(m[2] ?? 0);
  const sufijo = m[3];
  if (minuto > 59) return null;
  if (sufijo) {
    if (hora < 1 || hora > 12) return null;
    if (sufijo === "am") hora = hora === 12 ? 0 : hora;
    else hora = hora === 12 ? 12 : hora + 12;
  } else if (hora > 23) {
    return null;
  }
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}
function horaAMinutos(texto) {
  const hhmm = normalizarHora(texto);
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

// src/server/appointments/logic.ts
function horaAMin(hhmm) {
  return horaAMinutos(hhmm);
}
function minAHora(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function calcularDisponibilidad(input) {
  if (!input.hours.open || !input.hours.close) return {};
  const open = horaAMin(input.hours.open);
  const close = horaAMin(input.hours.close);
  if (open === null || close === null) {
    console.warn(
      `[citas] horario ilegible (abre "${input.hours.open}", cierra "${input.hours.close}"): no se puede calcular disponibilidad`
    );
    return {};
  }
  const corte = input.esHoy ? Math.ceil((input.minutosAhoraSiEsHoy ?? 0) / 30) * 30 : 0;
  const mapa = {};
  for (const staffId of input.staffIds) {
    const citasStaff = input.citas.filter((c) => c.staffId === staffId);
    const candidatos = /* @__PURE__ */ new Set();
    for (let t = open; t + input.duracionMin <= close; t += 30) candidatos.add(t);
    for (const c of citasStaff) {
      if (c.endMin >= open && c.endMin + input.duracionMin <= close) {
        candidatos.add(c.endMin);
      }
    }
    for (const slotMin of [...candidatos].sort((a, b) => a - b)) {
      if (slotMin < open || slotMin + input.duracionMin > close) continue;
      if (input.esHoy && slotMin < corte) continue;
      const libre = !citasStaff.some(
        (c) => slotMin < c.endMin && slotMin + input.duracionMin > c.startMin
      );
      if (libre) {
        const hora = minAHora(slotMin);
        (mapa[hora] ??= []).push(staffId);
      }
    }
  }
  return mapa;
}

// src/server/ai/generador/ficha.ts
function faltantesDeLaFicha(ficha) {
  const faltan = [];
  if (!ficha.nombre?.trim()) faltan.push("el nombre del negocio");
  if (!ficha.queVende?.trim()) faltan.push("qu\xE9 vende o qu\xE9 servicio ofrece");
  if (!ficha.tono?.trim()) faltan.push("el tono con el que habla");
  if (!ficha.horario?.dias?.length) faltan.push("los d\xEDas que atiende");
  if (!ficha.horario?.abre || !ficha.horario?.cierra) {
    faltan.push("el horario");
  } else if (
    // Una hora que el servidor no sabe leer es peor que no tenerla: con las
    // citas encendidas, la agenda queda vacía de huecos y el agente rechaza
    // clientes creyendo que está llena. Pasó con "9 AM" el 13-ago-2026.
    !normalizarHora(ficha.horario.abre) || !normalizarHora(ficha.horario.cierra)
  ) {
    faltan.push(
      `el horario en un formato legible (lleg\xF3 "${ficha.horario.abre}" a "${ficha.horario.cierra}"; se espera "09:00", "9 AM" o similar)`
    );
  }
  if (ficha.vertical === "pedidos" && !ficha.catalogo?.trim()) {
    faltan.push("el cat\xE1logo con precios");
  }
  if (ficha.pago && !ficha.pago.formas?.trim()) {
    faltan.push("las formas de pago");
  }
  if (ficha.pago?.formas?.toLowerCase().includes("transferencia") && !ficha.pago?.datosDeCuenta?.trim()) {
    faltan.push("los datos de la cuenta para transferencias");
  }
  if (ficha.entrega?.haceDomicilios && !ficha.entrega?.quienPagaElDomicilio?.trim()) {
    faltan.push("qui\xE9n paga el domicilio y cu\xE1ndo");
  }
  return faltan;
}
function requisitosDe(ficha) {
  const declarados = ficha.cierre?.requisitos;
  if (!declarados) return void 0;
  return declarados.filter((r) => aplica(r, ficha));
}
function aplica(requisito, ficha) {
  if (!requisito.soloSi) return true;
  const valor = requisito.soloSi.split(".").reduce((obj, clave2) => obj?.[clave2], ficha);
  return Boolean(valor);
}

// src/server/ai/generador/leer-ficha.ts
var SECCIONES = {
  /** Lo que responde el cliente en su cuestionario. */
  negocio: [
    "nombre",
    "queVende",
    "ubicacion",
    "horario",
    "vertical",
    "catalogo",
    "duracionTipicaMin",
    "variantes",
    "entrega",
    "pago",
    "tono",
    "regalos",
    "preguntasFrecuentes"
  ],
  /** Lo que ajusta el operador: el orden y las palabras de la conversación. */
  flujo: ["reglasPropias", "saludoInicial", "cierre"],
  /**
   * Las reglas que se escriben **después de un incidente**: cuándo pasar a una
   * persona y qué no se puede prometer nunca (salud, por ejemplo).
   *
   * La primera versión del plan dio esta sección por vacía. La simulación
   * demostró que no lo está, y que darla por vacía habría borrado justo estas
   * reglas en la conversión.
   */
  politicas: ["escalarSiempre", "nuncaPrometer"]
};
function esPorSecciones(obj) {
  if (!obj || typeof obj !== "object") return false;
  const o = obj;
  return typeof o.schema_version === "number" && o.schema_version >= 2;
}
function aplanar2(v2) {
  return {
    ...v2.negocio ?? {},
    ...v2.flujo ?? {},
    ...v2.politicas ?? {}
  };
}
function aSecciones(ficha) {
  const f = ficha;
  const reparte = (campos) => {
    const out = {};
    for (const k of campos) if (f[k] !== void 0) out[k] = f[k];
    return out;
  };
  return {
    schema_version: 2,
    negocio: reparte(SECCIONES.negocio),
    flujo: reparte(SECCIONES.flujo),
    politicas: reparte(SECCIONES.politicas)
  };
}
function leerFichaAplanada(cruda) {
  if (!cruda?.trim()) return null;
  let obj;
  try {
    obj = JSON.parse(cruda);
  } catch {
    return null;
  }
  if (esPorSecciones(obj)) return aplanar2(obj);
  return obj;
}

// src/server/ai/generador/conducta.ts
var ESTILO = `# C\xF3mo escribes

**Habla lo menos posible.** Un mensaje = lo que necesitas decir + lo que
necesitas preguntar. Nunca mandes dos mensajes seguidos ni repitas lo que
acabas de decir.

Escribe como una persona por WhatsApp: frases cortas, sin p\xE1rrafos largos y sin
sonar a formulario. Var\xEDa los saludos y los agradecimientos entre mensajes.

**Lo que NUNCA var\xEDa**, en cambio, son los datos duros: precios, opciones, datos
de la cuenta y el formato del resumen. Esos van siempre iguales, copiados tal
cual, aunque el resto de la frase cambie.`;
var CIERRE = `# El cierre, en DOS momentos separados

Son dos mensajes distintos, en dos momentos distintos. Juntarlos es el error m\xE1s
caro que puedes cometer.

## MOMENTO 1 \u2014 El resumen (ANTES de que confirme)

\u{1F6D1} **El resumen es OBLIGATORIO y no te lo puedes saltar.** Nadie confirma algo
que no ha visto: si pasas del pedido al pago sin ense\xF1arlo, el cliente est\xE1
diciendo que s\xED a ciegas y t\xFA no tienes con qu\xE9 demostrarle despu\xE9s qu\xE9 pidi\xF3.

Muestra el resumen completo y pide confirmaci\xF3n. Debe llevar, en este orden:
lo que pidi\xF3 con cantidades y precios, las opciones elegidas, los datos de
entrega, la l\xEDnea de la entrega si aplica, y **el total con la cifra**.

\u{1F6D1} **AH\xCD TERMINA EL MENSAJE. PUNTO.** No escribas ni una l\xEDnea m\xE1s: ni
agradecimientos de despedida, ni "ya lo estamos preparando", ni los datos de
pago. El cliente **todav\xEDa no ha confirmado**. Todo eso es del MOMENTO 2, y
mandarlo ahora significa despedirte de alguien que no ha dicho que s\xED y dejarlo
sin saber c\xF3mo pagarte.

## MOMENTO 2 \u2014 Solo DESPU\xC9S de que confirme

Cuando el cliente diga que s\xED, usa la acci\xF3n **notify_order** \u2014 no \`reply\`.

Es lo que hace que el pedido EXISTA para el negocio: sin esa acci\xF3n, t\xFA te
despides tan contento y **en la cocina no se entera nadie**. El cliente espera
algo que nunca se est\xE1 preparando.

En \`summary\` va el pedido completo y ya formateado (nombre, celular, qu\xE9 pidi\xF3
con cantidades, opciones elegidas, direcci\xF3n o "recoge en el local", total y
forma de pago): ese texto le llega tal cual al equipo, as\xED que tiene que
entenderse solo. En \`farewell\` va lo que lee el cliente: celebra, dale los
datos de pago tal cual est\xE1n escritos, y desp\xEDdete.

**El pago va al final, nunca antes.** Si te preguntan por la forma de pago antes
de cerrar, di solo c\xF3mo se paga ("es por transferencia \u{1F60A}") y que en cuanto
confirme le pasas los datos.

# Lo que ya te dijeron NO se vuelve a preguntar

Antes de preguntar cualquier cosa, **relee lo que el cliente ya escribi\xF3**.
Suele mandar varios datos juntos en una sola frase: *"Andr\xE9s Ram\xEDrez
3155551234, domicilio a la Calle 5 #12-34"* trae el nombre, el celular, que es
domicilio Y la direcci\xF3n. Ah\xED no queda nada por preguntar.

Volver a pedir algo que acaban de darte es la forma m\xE1s r\xE1pida de que un cliente
piense que no lo est\xE1s leyendo \u2014 y de que abandone el pedido.`;
var CIERRE_CITAS = `# C\xF3mo se cierra una cita

## Antes de agendar: que no falte nada

Necesitas el servicio, el d\xEDa, la hora y el nombre de quien viene. Con eso
\u2014y no antes\u2014 agendas.

Repite en una l\xEDnea lo que vas a agendar y agenda. No hace falta un resumen
largo ni pedir una confirmaci\xF3n ceremoniosa: la clienta ya te dijo lo que
quiere, y hacerla confirmar dos veces solo alarga la conversaci\xF3n.

## Agendar es una ACCI\xD3N, no una frase

\u{1F6D1} **Nunca digas que alguien qued\xF3 agendada si no ejecutaste la acci\xF3n de
agendar.** Ese es el error m\xE1s caro de este negocio: la clienta se organiza el
d\xEDa, se presenta, y en la agenda no hay nada. No vuelve, y lo cuenta.

Lo mismo con la disponibilidad: **nunca la inventes**. No digas que un d\xEDa est\xE1
lleno, ni que una hora ya no est\xE1, ni ofrezcas un hueco, sin haberlo consultado
antes. Si no lo consultaste, no lo sabes \u2014 y negarle a alguien una hora que
estaba libre es regalarle una clienta al sal\xF3n de al lado.

## Despu\xE9s de agendar

Conf\xEDrmale en corto lo que qued\xF3: servicio, d\xEDa, hora y con qui\xE9n. Nada m\xE1s.
Si el negocio cobra algo por adelantado, es el momento de decirlo; si no, la
conversaci\xF3n termina ah\xED.`;
var NUNCA = `# Nunca

- **Nunca anuncies algo que no hiciste.** Si dices "quedaste agendada", tiene que
  haber una cita de verdad; si dices "aqu\xED est\xE1 el resumen", tiene que estar el
  resumen con su total. Anunciar sin hacer deja al cliente esperando algo que no
  existe.
- **Nunca inventes datos duros.** Precios, direcciones, tiempos exactos, datos de
  cuenta: si no est\xE1n en tu conocimiento, no te los imagines. Di que lo confirmas
  con el equipo y sigue.
- **Nunca digas cu\xE1l es "el m\xE1s pedido" o "el favorito"** si nadie te dio ese
  dato. Pero **"la m\xE1s pedida" es una forma de pedir consejo, no un dato**: lo
  que hace el cliente es delegar en ti, y devolverle la pregunta ("\xBFcu\xE1l te
  llama la atenci\xF3n?") lo deja donde estaba. Elige t\xFA UNA opci\xF3n concreta,
  n\xF3mbrala con su precio y di en una l\xEDnea por qu\xE9 le puede gustar \u2014"te
  recomiendo el de 12 oz: lleva 2 toppings a elecci\xF3n y rinde bastante"\u2014, y
  sigue con el pedido en el mismo mensaje. Sin quedarte esperando a que elija.
  Y ojo con el remate: recomendar bien y cerrar con *"es uno de los favoritos de
  nuestros clientes"* es exactamente lo que no puedes decir. Ni de refil\xF3n, ni
  "a todos les encanta", ni "es de los que m\xE1s salen".
- **Nunca dejes caer algo que el cliente ya hab\xEDa pedido.** Si nombra otra opci\xF3n,
  puede estar sumando en vez de cambiando: si no est\xE1 claro, preg\xFAntaselo en una
  l\xEDnea sin descartar nada.
- **Nunca confirmes un pago por tu cuenta.** Puedes pedir el comprobante; darlo
  por bueno es de una persona, siempre.
- **Nunca prometas lo que no puedes cumplir**, aunque el cliente insista.
- **Nunca respondas por la SALUD de alguien.** Alergias, reacciones, irritaci\xF3n,
  piel sensible, embarazo, ingredientes, materiales o contraindicaciones: eso lo
  contesta una PERSONA, siempre, aunque creas saberlo. Ni un "claro que no" para
  tranquilizar. Dilo con calidez y pasa la conversaci\xF3n.

# Si te llegan varias cosas de golpe

Atiende **todas** las que te haya escrito, aunque vengan en mensajes separados o
mientras estabas respondiendo. Que un cliente escriba dos veces seguidas no es
motivo para pasar a una persona: es lo normal en WhatsApp.`;
var FUERA_DE_HORARIO = `# Si te escriben con el negocio cerrado

Arriba te digo si el negocio est\xE1 ABIERTO o CERRADO ahora mismo. Ese dato ya
viene calculado: hazle caso y no intentes deducirlo por tu cuenta.

**Si est\xE1 ABIERTO**, atiende con normalidad. Est\xE1 PROHIBIDO decir que cerraron o
mencionar reagendar, aunque el cliente escriba de madrugada.

**Si est\xE1 CERRADO**, no rechaces el pedido ni contestes solo "estamos cerrados":
eso es perder una venta que ya estaba hecha. Tu primer mensaje avisa de que el
pedido queda para la pr\xF3xima apertura y sigue con lo que te pidi\xF3, en el mismo
mensaje. De ah\xED en adelante, t\xF3malo completo como cualquier otro.

**Ese aviso se AFIRMA, no se pregunta.** Di que le tomas el pedido ahora y que
se coordina al abrir ("te tomo el pedido ahora mismo y lo coordinamos apenas
abramos"), y sigue con la pregunta que tocaba. Nunca pidas permiso para
tom\xE1rselo \u2014nada de "\xBFte gustar\xEDa dejarlo programado?"\u2014: eso abre la puerta a un
"no" en una venta que ya estaba hecha, y el cliente que escribe fuera de hora es
justo el que m\xE1s f\xE1cil se va a otro lado.

En el resumen a\xF1ade la l\xEDnea de que la entrega queda reagendada, dilo tambi\xE9n en
el mensaje de cierre, y deja claro en el aviso al equipo que es un pedido
reagendado. El pago se lo pides igual.`;
var NO_ENCAJA = `# Cuando el mensaje no encaja en nada de lo que sabes

Te va a escribir gente que no viene a comprar: alguien que **ofrece** sus
servicios o productos al negocio, un proveedor, una propuesta de trabajo o de
publicidad, o una pregunta de un tema que sencillamente no es tuyo.

Todos esos son **personas escribi\xE9ndole al negocio**, y el negocio quiere
enterarse. No eres t\xFA quien decide si le interesan.

**Nunca los despaches.** Est\xE1n prohibidas las frases que cierran la puerta \u2014
"estamos enfocados en atender a nuestros clientes", "no estamos interesados",
"solo atendemos pedidos", "no es nuestro servicio" o cualquier variante.
Suenan amables, pero son un portazo, y no te toca a ti darlo.

Lo que haces, siempre, es esto:

1. Sal\xFAdalo con calidez y agrad\xE9cele que haya escrito, en una o dos l\xEDneas.
2. Dile con naturalidad que le pasas el mensaje a alguien del equipo para que lo
   vea bien \u2014 sin prometer cu\xE1ndo.
3. Usa la acci\xF3n **handoff** con el motivo y lo que te dijo.

No le pidas datos que no necesitas: quien viene a ofrecer algo no est\xE1 haciendo
un pedido, as\xED que nada de nombre, celular ni direcci\xF3n. Y nunca te inventes una
respuesta para salir del paso ni te quedes callado \u2014 "no s\xE9" no es un final, es
el momento de pasar la conversaci\xF3n, no de cerrarla.`;
function meta(vertical) {
  if (vertical === "citas") {
    return `# Tu meta: dejar la cita agendada

Lleva la conversaci\xF3n hasta agendar, hablando poco y sin trabarte.

## El orden en que preguntas

1. **Qu\xE9 servicio** quiere.
2. **Qu\xE9 d\xEDa y hora.** Ofrece solo huecos que existan de verdad.
3. **Con qui\xE9n**, si el negocio tiene varias personas y \xE9l tiene preferencia.
4. **Su nombre y su celular.**
5. **Confirmar la cita.**

**Pide solo lo que falte**: si ya te lo dijo, no lo vuelvas a preguntar. Y
agrupa \u2014 si ya eligi\xF3 servicio, preg\xFAntale el d\xEDa y la preferencia de persona
en el MISMO mensaje. Una pregunta por mensaje alarga la conversaci\xF3n y cansa.

Nunca inventes disponibilidad ni des por agendada una cita que no agendaste.`;
  }
  return `# Tu meta: cerrar el pedido

Lleva la conversaci\xF3n hasta el pedido cerrado, hablando poco y sin trabarte.

## El orden en que preguntas

1. **Qu\xE9 quiere y cu\xE1ntos.**
2. **Las opciones de ESE producto** (sabores, salsas, tama\xF1o, lo que lleve).
   Dile cu\xE1ntas puede elegir seg\xFAn lo que pidi\xF3.
3. **Si es para \xE9l o es un regalo** \u2014 solo si el negocio hace regalos.
4. **Su nombre y su celular.**
5. **C\xF3mo lo recibe**: domicilio o recoger. Si es domicilio, la direcci\xF3n
   completa; si recoge, NO le pidas direcci\xF3n.
6. **El resumen y su confirmaci\xF3n.**
7. **Los datos de pago**, solo cuando ya confirm\xF3.

**Pide solo lo que falte**: si ya te lo dijo, no lo vuelvas a preguntar. Y
agrupa lo que va junto \u2014 con el producto elegido, p\xEDdele las opciones y si es
regalo en el MISMO mensaje. Una pregunta por mensaje alarga el pedido y cansa.

**Si te preguntan cu\xE1nto es el total, dale el total.** Es la pregunta que te
hicieron: suma lo que ya tiene pedido y dale la cifra, aunque falten detalles
que no cambian el precio (el sabor, el topping, el color). Pedirle m\xE1s datos
antes de contestar lo deja sin lo \xFAnico que quer\xEDa saber \u2014 y es de las cosas que
m\xE1s r\xE1pido hacen que un cliente se vaya. Si de verdad falta algo que S\xCD cambia
el precio, dale el total de lo que hay y di qu\xE9 falta por sumar.

**Nunca saltes al resumen con algo sin decidir.** Un pedido con un hueco
("sabor por confirmar") llega a la cocina como algo que nadie puede preparar, y
alguien tendr\xE1 que llamar al cliente para terminar tu trabajo.

**Cuenta con cuidado.** "2 de este y uno de aquel" son cantidades exactas:
multiplica cada precio por su cantidad, suma, y repasa la cuenta antes de
mostrar el resumen.`;
}

// src/server/ai/generador/generar.ts
function bloques(...partes) {
  return partes.map((p) => p?.trim()).filter((p) => Boolean(p)).join("\n\n");
}
function vinetas(items) {
  const limpios = (items ?? []).map((i) => i.trim()).filter(Boolean);
  if (limpios.length === 0) return null;
  return limpios.map((i) => `- ${i}`).join("\n");
}
function queOfrece(ficha, vertical, opciones) {
  if (vertical === "citas") return null;
  if (opciones?.catalogoEnTabla) return null;
  if (!ficha.catalogo?.trim()) return null;
  return bloques(
    "## Lo que vendes",
    ficha.catalogo.trim(),
    ficha.variantes?.trim() ? `**Opciones que elige el cliente:**
${ficha.variantes.trim()}` : null
  );
}
function comoRecibe(ficha) {
  const { entrega } = ficha;
  const partes = [];
  if (entrega.haceDomicilios) {
    const detalle = [];
    if (entrega.como?.trim()) detalle.push(entrega.como.trim());
    if (entrega.restricciones?.trim()) detalle.push(entrega.restricciones.trim());
    partes.push(
      bloques(
        "**Domicilio.**",
        detalle.join(" ") || null,
        // El dato que más caro sale si se omite: el cliente cree que el total
        // lo incluye y acaba discutiendo con el repartidor. En NEGRITA y con el
        // hecho por delante, porque en cursiva WhatsApp lo pinta tenue y pasa
        // desapercibido — se aprendió con Lis el 12-ago-2026.
        entrega.quienPagaElDomicilio?.trim() ? `\u26A0\uFE0F Esta l\xEDnea va SIEMPRE en el resumen del pedido, en negrita y con el hecho primero \u2014 nunca la resumas con tus propias palabras ni la des solo de palabra en mitad de la charla:
"\u{1F6F5} *${entrega.quienPagaElDomicilio.trim()}*"` : null
      )
    );
  } else {
    partes.push("**No hay domicilios.** Si alguien lo pide, dilo con naturalidad y ofr\xE9cele recoger.");
  }
  if (entrega.recogerEnLocal?.trim()) {
    partes.push(
      `**Recoger en el local.** ${entrega.recogerEnLocal.trim()}
Si el cliente recoge, NO le pidas direcci\xF3n y no le prometas tiempos de entrega.`
    );
  }
  return bloques("## C\xF3mo lo recibe", ...partes);
}
function comoPagan(ficha, vertical) {
  const { pago } = ficha;
  const loQueSeDejaEnFirme = vertical === "citas" ? "la cita" : "el pedido";
  return bloques(
    "## C\xF3mo te pagan",
    `Formas de pago: ${pago.formas.trim()}`,
    pago.datosDeCuenta?.trim() ? `Datos para el pago (c\xF3pialos TAL CUAL, sin cambiar ni un d\xEDgito, y solo DESPU\xC9S de que confirme):
${pago.datosDeCuenta.trim()}` : null,
    pago.compruebaUnaPersona ? `P\xEDdele la foto del comprobante para dejar ${loQueSeDejaEnFirme} en firme. **T\xFA nunca das un pago por bueno**: lo revisa una persona del equipo.` : null
  );
}
function generarPerfil(ficha, opciones) {
  const vertical = opciones?.vertical ?? ficha.vertical;
  const faltan = faltantesDeLaFicha(ficha);
  if (faltan.length > 0) {
    throw new Error(
      `No se puede generar el prompt, falta en la ficha: ${faltan.join(", ")}.`
    );
  }
  const instructions = bloques(
    // `trim` en el nombre porque el del cuestionario suele venir con un espacio
    // al final, y ahí se convierte en "**Lashen Valen **": el asterisco queda
    // separado y WhatsApp deja de pintarlo en negrita.
    `Eres la voz de **${ficha.nombre.trim()}**${ficha.ubicacion?.trim() ? ` (${ficha.ubicacion.trim()})` : ""} en WhatsApp. ${ficha.queVende.trim()}`,
    ESTILO,
    `**El tono de este negocio:** ${ficha.tono.trim()}`,
    meta(vertical),
    vertical === "citas" ? "# Lo que ofreces y c\xF3mo te pagan" : "# Lo que ofreces y c\xF3mo se recibe",
    queOfrece(ficha, vertical, opciones),
    // En un salón no hay nada que entregar: el bloque de domicilios acababa
    // diciéndole "no hacemos domicilios, ofrécele recoger" a quien viene a que
    // le hagan las pestañas.
    vertical === "citas" ? null : comoRecibe(ficha),
    comoPagan(ficha, vertical),
    ficha.regalos?.trim() ? bloques(
      "## Regalos",
      ficha.regalos.trim(),
      "Si es un regalo, los datos de entrega son los de QUIEN RECIBE, no los de quien compra."
    ) : null,
    // Las reglas propias van ANTES del cierre y de las prohibiciones
    // universales: son del día a día de este negocio y el modelo las necesita
    // mientras atiende, no al final entre las advertencias.
    /*
     * La cabecera dice que MANDAN, y no es un adorno.
     *
     * 15-ago-2026: La Churra tenía escrito que su primer mensaje lleva las
     * cuatro presentaciones, y el agente seguía saludando y esperando. El orden
     * general (`## El orden en que preguntas`) cae en la línea 22 del prompt y
     * estas reglas en la 89: cuando dos instrucciones se contradicen, gana la
     * que el modelo leyó primero.
     *
     * Decir aquí quién manda **no impone ningún flujo** —cada negocio sigue
     * escribiendo el suyo—, solo resuelve el empate a favor de quien conoce su
     * negocio. Es la diferencia con subir el flujo de un cliente a la conducta
     * universal, que encasillaría a toda la flota en el orden de una churrería.
     */
    vinetas(ficha.reglasPropias) ? `## Reglas propias de este negocio

Estas reglas **mandan sobre todo lo anterior**. Si alguna contradice el orden de preguntas o la forma de escribir que te dije m\xE1s arriba, haz lo que dice esta secci\xF3n: son las de este negocio en concreto.

${vinetas(ficha.reglasPropias)}` : null,
    vertical === "citas" ? CIERRE_CITAS : CIERRE,
    // Solo en pedidos: una cita fuera de hora no se "reagenda sola", se pide
    // para un día que el propio catálogo de horarios ya limita.
    vertical === "citas" ? null : FUERA_DE_HORARIO,
    NUNCA,
    NO_ENCAJA,
    // Lo propio del negocio se añade al final del bloque universal, no lo
    // sustituye: son prohibiciones suyas que se suman a las de siempre.
    vinetas(ficha.nuncaPrometer) ? `## Adem\xE1s, en este negocio nunca:
${vinetas(ficha.nuncaPrometer)}` : null
  );
  const escalationRules = bloques(
    "Pasa la conversaci\xF3n a una persona del equipo en estos casos:",
    vinetas(ficha.escalarSiempre),
    "- Si el cliente pide hablar con alguien del equipo.\n- Si te pide algo que no sabes resolver y no est\xE1 en tu conocimiento.",
    "Cuando escales, dilo en UNA l\xEDnea y sin prometer tiempos ('te comunico con alguien del equipo \u{1F60A}'). No te quedes callado: un cliente esperando sin respuesta es lo peor que puede pasar."
  );
  const greeting = ficha.saludoInicial?.trim() || `\xA1Hola! \u{1F44B} Soy el asistente de ${ficha.nombre}. \xBFEn qu\xE9 te puedo ayudar?`;
  return { instructions, escalationRules, greeting };
}

// src/server/vertical.ts
function verticalDe(appointmentsEnabled) {
  return appointmentsEnabled ? "citas" : "pedidos";
}

// src/server/auth/provisioning.ts
import { and as and3, eq as eq5, ne } from "drizzle-orm";

// src/lib/auth/index.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization as organization2 } from "better-auth/plugins";

// src/lib/rate-limit.ts
import { sql as sql2 } from "drizzle-orm";
async function checkRateLimit(key, opts) {
  try {
    const db2 = getDb();
    const filas = await db2.execute(sql2`
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
    `);
    const f = filas[0];
    if (!f) return { allowed: true, remaining: opts.max - 1 };
    const previos = Number(f.previos ?? 0);
    return f.permitido ? { allowed: true, remaining: Math.max(0, opts.max - previos - 1) } : { allowed: false, remaining: 0 };
  } catch (err) {
    console.error("[rate-limit] no se pudo consultar la base:", err);
    return { allowed: true, remaining: opts.max };
  }
}
var AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1e3, max: 10 };
function clientIpFrom(headers) {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "local";
}

// src/server/auth/on-signup.ts
import { and as and2, asc as asc2, count, eq as eq4, sql as sql3 } from "drizzle-orm";
async function onUserCreated(userId, userName) {
  const db2 = getDb();
  await db2.transaction(async (tx) => {
    await tx.execute(sql3`select pg_advisory_xact_lock(874201)`);
    const [orgs] = await tx.select({ n: count() }).from(schema_exports.organization);
    if ((orgs?.n ?? 0) > 0) return;
    const orgId = newId("organization");
    await provisionOrganization(tx, {
      organizationId: orgId,
      name: userName ? `Negocio de ${userName}` : "Mi negocio",
      slug: "principal"
    });
    await tx.insert(schema_exports.member).values({
      id: newId("organization"),
      organizationId: orgId,
      userId,
      role: "owner"
    });
  });
}
async function resolveActiveOrganizationId(userId) {
  return (await resolveMembership(userId))?.organizationId ?? null;
}
async function resolveMembership(userId) {
  const db2 = getDb();
  const rows = await db2.select({
    organizationId: schema_exports.member.organizationId,
    role: schema_exports.member.role
  }).from(schema_exports.member).where(eq4(schema_exports.member.userId, userId)).orderBy(asc2(schema_exports.member.createdAt), asc2(schema_exports.member.id)).limit(1);
  return rows[0] ?? null;
}

// src/server/auth/registration.ts
import { count as count2 } from "drizzle-orm";
async function isPublicSignupAllowed() {
  if (process.env.ALLOW_SIGNUP === "true") return true;
  const db2 = getDb();
  const rows = await db2.select({ n: count2() }).from(schema_exports.organization);
  return (rows[0]?.n ?? 0) === 0;
}

// src/lib/auth/index.ts
var globalForSignup = globalThis;
function internalSignupContext() {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage();
  }
  return globalForSignup.__voceroInternalSignup;
}
function runInternalSignup(fn) {
  return internalSignupContext().run(true, fn);
}
function isInternalSignup() {
  return internalSignupContext().getStore() === true;
}
var RATE_LIMITED_PATHS = /* @__PURE__ */ new Set(["/sign-in/email", "/sign-up/email"]);
function trustedOrigins(baseUrl, extra) {
  const origins = /* @__PURE__ */ new Set([baseUrl.replace(/\/+$/, "")]);
  for (const raw of (extra ?? "").split(",")) {
    const value = raw.trim().replace(/\/+$/, "");
    if (value) origins.add(value);
  }
  return [...origins];
}
function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    trustedOrigins: trustedOrigins(env.APP_BASE_URL, env.APP_TRUSTED_ORIGINS),
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema_exports.user,
        session: schema_exports.session,
        account: schema_exports.account,
        verification: schema_exports.verification,
        organization: schema_exports.organization,
        member: schema_exports.member,
        invitation: schema_exports.invitation
      }
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8
    },
    plugins: [organization2({ creatorRole: "owner" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          const ip = ctx.headers ? clientIpFrom(ctx.headers) : "local";
          const result = await checkRateLimit(
            `${ctx.path}:${ip}`,
            AUTH_RATE_LIMIT
          );
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos"
            });
          }
        }
        if (ctx.path === "/sign-up/email") {
          if (!isInternalSignup() && !await isPublicSignupAllowed()) {
            throw new APIError("FORBIDDEN", {
              message: "El registro est\xE1 cerrado: esta instancia ya tiene su organizaci\xF3n"
            });
          }
        }
      })
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user2) => {
            await onUserCreated(user2.id, user2.name);
          }
        }
      },
      session: {
        create: {
          before: async (session2) => {
            const organizationId = await resolveActiveOrganizationId(
              session2.userId
            );
            return {
              data: { ...session2, activeOrganizationId: organizationId }
            };
          }
        }
      }
    }
  });
}
var globalForAuth = globalThis;
function getAuth() {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}

// src/server/auth/provisioning.ts
var SEED_STAGES = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversaci\xF3n", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Por recuperar", kind: "lost" }
];
async function provisionOrganization(tx, input) {
  await tx.insert(schema_exports.organization).values({
    id: input.organizationId,
    name: input.name,
    slug: input.slug
  });
  await tx.insert(schema_exports.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId: input.organizationId,
      name: s.name,
      position: i,
      kind: s.kind
    }))
  );
  await tx.insert(schema_exports.agentProfile).values({
    id: newId("agentProfile"),
    organizationId: input.organizationId,
    appointmentsEnabled: input.needsAppointments ?? false
  });
}
var ProvisioningError = class extends Error {
  code;
  constructor(code, message2) {
    super(message2);
    this.name = "ProvisioningError";
    this.code = code;
  }
};
async function uniqueSlug(base) {
  const db2 = getDb();
  const normalized = base.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "cliente";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? normalized : `${normalized}-${i + 1}`;
    const taken = await db2.select({ id: schema_exports.organization.id }).from(schema_exports.organization).where(eq5(schema_exports.organization.slug, candidate)).limit(1);
    if (!taken[0]) return candidate;
  }
  throw new ProvisioningError("duplicate_slug", "No se pudo generar un slug libre");
}
async function createAccountInOrganization(input) {
  const auth = getAuth();
  let userId;
  try {
    const result = await runInternalSignup(
      () => auth.api.signUpEmail({
        body: {
          name: input.name,
          email: input.email,
          password: input.password
        }
      })
    );
    userId = result.user.id;
  } catch (err) {
    const message2 = err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message2)) {
      throw new ProvisioningError(
        "duplicate_email",
        "Ya existe una cuenta con ese correo"
      );
    }
    throw new ProvisioningError("invalid", message2);
  }
  const db2 = getDb();
  const memberId = newId("organization");
  await db2.insert(schema_exports.member).values({
    id: memberId,
    organizationId: input.organizationId,
    userId,
    role: input.role
  }).onConflictDoNothing();
  return { userId, memberId };
}
async function createClientWithOwner(input) {
  const db2 = getDb();
  const slug = await uniqueSlug(input.slug || input.organizationName);
  const organizationId = newId("organization");
  await db2.transaction(async (tx) => {
    await provisionOrganization(tx, {
      organizationId,
      name: input.organizationName,
      slug,
      needsAppointments: input.needsAppointments
    });
  });
  try {
    const { userId } = await createAccountInOrganization({
      organizationId,
      name: input.ownerName,
      email: input.ownerEmail,
      password: input.password,
      role: "owner"
    });
    return { organizationId, userId, slug };
  } catch (err) {
    await db2.delete(schema_exports.organization).where(eq5(schema_exports.organization.id, organizationId));
    throw err;
  }
}

// scripts/probar-estado.ts
function envVar(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    return env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim();
  } catch {
    return void 0;
  }
}
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN"
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}
var marca = Date.now();
var correoPedidos = `prueba-pedidos-${marca}@ejemplo.invalid`;
var correoCitas = `prueba-citas-${marca}@ejemplo.invalid`;
var db = getDb();
var efimeros = [];
var orgPedidos = "";
var orgCitas = "";
var convPedidos = "";
var convCitas = "";
var fallos = [];
var mismoEstado = (a, b) => {
  const ordenar = (v) => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, val]) => [k, ordenar(val)])
      );
    }
    return v;
  };
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
};
var comprobar = (nombre, ok, detalle = "") => {
  console.log(`  ${ok ? "\u2705" : "\u{1F534}"} ${nombre}${detalle ? ` \u2014 ${detalle}` : ""}`);
  if (!ok) fallos.push(nombre);
};
async function huellaDeLaFlota() {
  const filas = await db.select().from(agentProfile);
  return filas.filter((f) => !efimeros.includes(f.organizationId)).map((f) => JSON.stringify(f)).sort().join("\n");
}
async function ponerFicha(organizationId, ficha) {
  await db.update(agentProfile).set({ ficha: JSON.stringify(aSecciones(ficha)), updatedAt: /* @__PURE__ */ new Date() }).where(eq6(agentProfile.organizationId, organizationId));
}
async function requisitosGuardados(organizationId) {
  const [p] = await db.select({ ficha: agentProfile.ficha }).from(agentProfile).where(eq6(agentProfile.organizationId, organizationId));
  const ficha = leerFichaAplanada(p?.ficha ?? null);
  return ficha ? requisitosDe(ficha) : void 0;
}
var FICHA_BASE = {
  tono: "cercano",
  ubicacion: "Cra 1 #2-3",
  horario: { abre: "9:30 AM", cierra: "6:30 PM", dias: [1, 2, 3, 4, 5] },
  pago: { formas: "efectivo", compruebaUnaPersona: true },
  saludoInicial: "Hola",
  reglasPropias: [],
  preguntasFrecuentes: [],
  escalarSiempre: [],
  nuncaPrometer: []
};
try {
  console.log(`
${"=".repeat(74)}`);
  console.log("FASE 2 \u2014 prueba de extremo a extremo (dos clientes ef\xEDmeros)");
  console.log(`${"=".repeat(74)}`);
  const flotaAntes = await huellaDeLaFlota();
  console.log("\n\n\u25A0 BLOQUE A \u2014 PEDIDOS\n");
  const creadoA = await createClientWithOwner({
    organizationName: `PRUEBA pedidos ${marca}`,
    ownerName: "Prueba Pedidos",
    ownerEmail: correoPedidos,
    password: `Prueba-${marca}-x9`
  });
  orgPedidos = creadoA.organizationId;
  efimeros.push(orgPedidos);
  const idSencillo = newId("product");
  const idCaja = newId("product");
  await db.insert(product).values([
    { id: idSencillo, organizationId: orgPedidos, name: "SENCILLO", priceCents: 1e6, position: 0 },
    { id: idCaja, organizationId: orgPedidos, name: "CAJA GRANDE", priceCents: 4e6, position: 1 }
  ]);
  const gSalsaUnica = newId("productOptionGroup");
  const gSalsasCaja = newId("productOptionGroup");
  const gAdiciones = newId("productOptionGroup");
  await db.insert(productOptionGroup).values([
    // 1 de 2: no hay nada que repetir.
    { id: gSalsaUnica, organizationId: orgPedidos, productId: idSencillo, name: "SALSA", minSelect: 1, maxSelect: 1, position: 0 },
    /*
     * 5 opciones de 4 sabores: SOLO se puede completar repitiendo. Es el caso
     * que dejó el pedido más caro sin poder cerrarse (16-ago). Lo declara el
     * grupo — el núcleo no sabe qué es una salsa.
     */
    { id: gSalsasCaja, organizationId: orgPedidos, productId: idCaja, name: "SALSAS", minSelect: 5, maxSelect: 5, permiteRepeticion: true, position: 0 },
    // Y un segundo grupo con un nombre de opción REPETIDO en el otro: el cobro cruzado.
    { id: gAdiciones, organizationId: orgPedidos, productId: idCaja, name: "ADICIONES", minSelect: 0, maxSelect: 3, position: 1 }
  ]);
  await db.insert(productOption).values([
    { id: newId("productOption"), organizationId: orgPedidos, groupId: gSalsaUnica, name: "arequipe", priceDeltaCents: 0, position: 0 },
    { id: newId("productOption"), organizationId: orgPedidos, groupId: gSalsaUnica, name: "lechera", priceDeltaCents: 0, position: 1 },
    ...["arequipe", "lechera", "chocolate", "frutos rojos"].map((n, i) => ({
      id: newId("productOption"),
      organizationId: orgPedidos,
      groupId: gSalsasCaja,
      name: n,
      priceDeltaCents: 0,
      position: i
    })),
    // El MISMO nombre que una salsa gratis, aquí a $1.500. Cobrarlo dos veces era el bug.
    { id: newId("productOption"), organizationId: orgPedidos, groupId: gAdiciones, name: "arequipe", priceDeltaCents: 15e4, position: 0 },
    { id: newId("productOption"), organizationId: orgPedidos, groupId: gAdiciones, name: "oreo", priceDeltaCents: 2e5, position: 1 }
  ]);
  await ponerFicha(orgPedidos, {
    ...FICHA_BASE,
    nombre: `PRUEBA pedidos ${marca}`,
    vertical: "pedidos",
    queVende: "postres",
    catalogo: "SENCILLO \u2014 $10.000",
    entrega: { haceDomicilios: true, quienPagaElDomicilio: "el cliente" },
    cierre: {
      requisitos: [
        { id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true },
        { id: "telefono", tipo: "telefono", etiqueta: "un celular de contacto", obligatorio: true },
        { id: "direccion", tipo: "direccion", etiqueta: "la direcci\xF3n", obligatorio: true, soloSi: "entrega.haceDomicilios" }
      ]
    }
  });
  const contactoA = newId("contact");
  await db.insert(contact).values({
    id: contactoA,
    organizationId: orgPedidos,
    phone: `99900${marca}`.slice(0, 15),
    name: "Cliente de prueba"
  });
  convPedidos = newId("conversation");
  await db.insert(conversation).values({
    id: convPedidos,
    organizationId: orgPedidos,
    contactId: contactoA,
    isTest: true
    // JAMÁS toca WhatsApp
  });
  console.log(`  cliente ef\xEDmero de pedidos: ${orgPedidos}`);
  const catalogo = await catalogoDe(orgPedidos, "pedidos");
  const requisitos = await requisitosGuardados(orgPedidos);
  const caja = catalogo.find((p) => p.id === idCaja);
  console.log("\nA1. EL CAT\xC1LOGO LLEGA COMO EST\xC1 EN LA BASE");
  comprobar("el vertical se deduce en un solo sitio", verticalDe(false) === "pedidos");
  comprobar("los dos productos, con sus grupos", catalogo.length === 2 && caja?.grupos.length === 2);
  comprobar(
    "la regla de repetici\xF3n viaja EN EL GRUPO, no en el n\xFAcleo",
    caja?.grupos.find((g) => g.nombre === "SALSAS")?.permiteRepeticion === true && caja?.grupos.find((g) => g.nombre === "ADICIONES")?.permiteRepeticion === false
  );
  comprobar(
    "los requisitos salen de la ficha, no de una constante",
    requisitos?.length === 3,
    requisitos?.map((r) => r.id).join(", ")
  );
  console.log("\nA2. UN PEDIDO SENCILLO");
  const v1 = validarPropuesta(
    { items: [{ ofrecible: "sencillo", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] }], datos: {}, paso: "eligiendo_opciones" },
    catalogo,
    void 0,
    requisitos
  );
  comprobar("la propuesta v\xE1lida pasa", v1.ok, v1.rechazos.join(" \xB7 "));
  comprobar("el backend resuelve el productId", v1.estado.items[0]?.ofrecible.id === idSencillo);
  comprobar("el total lo calcula el servidor", v1.estado.totalCents === 1e6, "$10.000");
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: v1.estado, actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("se recupera lo guardado", mismoEstado(await leerEstado(convPedidos), v1.estado));
  console.log("\nA3. VARIOS GRUPOS A LA VEZ, Y LA REPETICI\xD3N");
  const cincoSalsas = [
    { grupo: "SALSAS", opcion: "arequipe" },
    { grupo: "SALSAS", opcion: "arequipe" },
    { grupo: "SALSAS", opcion: "lechera" },
    { grupo: "SALSAS", opcion: "chocolate" },
    { grupo: "SALSAS", opcion: "frutos rojos" }
  ];
  const v2 = validarPropuesta(
    { items: [{ ofrecible: "caja grande", cantidad: 1, opciones: [...cincoSalsas, { grupo: "ADICIONES", opcion: "arequipe" }] }], datos: {}, paso: "eligiendo_opciones" },
    catalogo,
    void 0,
    requisitos
  );
  comprobar("cinco de cuatro sabores: se puede repetir donde el grupo lo permite", v2.ok, v2.rechazos.join(" \xB7 "));
  comprobar("las cinco se conservan, no se deduplican", v2.estado.items[0].seleccion.filter((s) => s.grupoNombre === "SALSAS").length === 5);
  comprobar("\xABarequipe\xBB dos veces son dos, no una", v2.estado.items[0].seleccion.filter((s) => s.grupoNombre === "SALSAS" && s.nombre === "arequipe").length === 2);
  comprobar("cada grupo cobra lo suyo: no hay cobro cruzado", v2.estado.totalCents === 415e4, `$${(v2.estado.totalCents ?? 0) / 100}`);
  const v2b = validarPropuesta(
    { items: [{ ofrecible: "caja grande", cantidad: 1, opciones: [...cincoSalsas, { grupo: "ADICIONES", opcion: "oreo" }, { grupo: "ADICIONES", opcion: "oreo" }] }], datos: {}, paso: "eligiendo_opciones" },
    catalogo,
    void 0,
    requisitos
  );
  comprobar(
    "y donde el grupo NO lo permite, se pregunta en vez de adivinar",
    !v2b.ok || v2b.estado.items[0].seleccion.filter((s) => s.grupoNombre === "ADICIONES").length < 2,
    v2b.dudas?.[0]?.preguntar ?? v2b.rechazos[0] ?? ""
  );
  console.log("\nA4. LO QUE FALTA PARA CERRAR");
  const faltan = loQueFalta(v2.estado, catalogo, requisitos);
  comprobar(
    "pide los tres datos que declar\xF3 la ficha",
    (requisitos ?? []).every((r) => faltan.some((f) => f.includes(r.etiqueta))),
    faltan.join(" \xB7 ")
  );
  const conNombre = { ...v2.estado, datos: { nombre: "Ana" } };
  comprobar("y deja de pedir el que ya tiene", !loQueFalta(conNombre, catalogo, requisitos).some((f) => f.includes("el nombre")));
  comprobar(
    "el resumen no inventa g\xE9nero ni trata al cliente de usted o de t\xFA",
    !/\b(la dio|lo dio|dió|usted)\b/i.test(comoTexto(conNombre, catalogo, requisitos))
  );
  console.log("\nA5. CONFIRMAR");
  const sinDatos = validarPropuesta(
    { items: [{ ofrecible: "caja grande", cantidad: 1, opciones: cincoSalsas }], datos: {}, confirmado: true },
    catalogo,
    void 0,
    requisitos
  );
  comprobar("no se confirma sin los datos obligatorios", !sinDatos.ok || !sinDatos.estado.confirmado, sinDatos.rechazos[0] ?? "");
  const sinRequisitos = validarPropuesta(
    { items: [{ ofrecible: "caja grande", cantidad: 1, opciones: cincoSalsas }], datos: { nombre: "Ana", telefono: "3001234567", direccion: "Cra 1 #2-3" }, confirmado: true },
    catalogo
  );
  comprobar("ni cuando el negocio NO ha declarado qu\xE9 pide", !sinRequisitos.ok || !sinRequisitos.estado.confirmado, sinRequisitos.rechazos[0] ?? "");
  const completo = validarPropuesta(
    { items: [{ ofrecible: "caja grande", cantidad: 1, opciones: [...cincoSalsas, { grupo: "ADICIONES", opcion: "arequipe" }] }], datos: { nombre: "Ana", telefono: "3001234567", direccion: "Cra 1 #2-3" }, confirmado: true, paso: "confirmado" },
    catalogo,
    void 0,
    requisitos
  );
  comprobar("con todo lo que pide la ficha, S\xCD se confirma", completo.ok && completo.estado.confirmado, completo.rechazos.join(" \xB7 "));
  comprobar("y el total sigue siendo el del servidor", completo.estado.totalCents === 415e4);
  comprobar("no queda nada por pedir", loQueFalta(completo.estado, catalogo, requisitos).length === 0);
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: completo.estado, actor: "script:probar-estado", proceso: "probar:estado" });
  console.log("\nA6. CORRUPCI\xD3N DELIBERADA (nada de esto debe persistirse)");
  const guardadoBueno = await leerEstado(convPedidos);
  const casos = [
    ["producto inexistente", { items: [{ ofrecible: "PIZZA", cantidad: 1, opciones: [] }], datos: {} }],
    ["opci\xF3n que no existe en el grupo", { items: [{ ofrecible: "sencillo", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "mostaza" }] }], datos: {} }],
    ["cantidad 0", { items: [{ ofrecible: "sencillo", cantidad: 0, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] }], datos: {} }],
    ["una opci\xF3n de OTRO producto", { items: [{ ofrecible: "sencillo", cantidad: 1, opciones: [{ grupo: "ADICIONES", opcion: "oreo" }] }], datos: {} }],
    ["confirmar con la mitad de los datos", { items: [{ ofrecible: "sencillo", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] }], datos: { nombre: "Ana" }, confirmado: true }]
  ];
  for (const [nombre, mala] of casos) {
    const r = validarPropuesta(mala, catalogo, void 0, requisitos);
    const rechazada = !r.ok || r.estado.items[0]?.ofrecible.id === null || (r.dudas?.length ?? 0) > 0 || !r.estado.confirmado;
    comprobar(nombre, rechazada, r.rechazos[0] ?? r.dudas?.[0]?.preguntar ?? "no resuelve el producto");
  }
  comprobar("el estado guardado sigue intacto tras los intentos", mismoEstado(await leerEstado(convPedidos), guardadoBueno));
  console.log("\nA7. ROLLBACK Y ESQUEMA DESCONOCIDO");
  await borrarEstado(convPedidos, { actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("el estado se borra (es lo que hace el \xAB0\xBB)", await leerEstado(convPedidos) === null);
  const [perfilA] = await db.select({ stateSource: agentProfile.stateSource }).from(agentProfile).where(eq6(agentProfile.organizationId, orgPedidos));
  comprobar("la bandera nace y sigue en 'prompt'", perfilA?.stateSource === "prompt");
  const delFuturo = { ...estadoVacio(), schema_version: 99 };
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: delFuturo, actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("una versi\xF3n que no conocemos no se usa a medias: se empieza limpio", await leerEstado(convPedidos) === null);
  console.log("\nA8. CONCURRENCIA (dos turnos a la vez sobre la misma conversaci\xF3n)");
  const dos = [
    { ...estadoVacio(), items: [{ ofrecible: { id: idSencillo, nombre: "SENCILLO" }, cantidad: 1, seleccion: [], totalCents: 1e6 }], paso: "turno-A" },
    { ...estadoVacio(), items: [{ ofrecible: { id: idSencillo, nombre: "SENCILLO" }, cantidad: 2, seleccion: [], totalCents: 2e6 }], paso: "turno-B" }
  ];
  await Promise.all(
    dos.map((e) => guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: e, actor: "script:probar-estado", proceso: "concurrencia" }))
  );
  const tras = await leerEstado(convPedidos);
  const coherente = tras !== null && (tras.paso === "turno-A" && tras.items[0]?.cantidad === 1 || tras.paso === "turno-B" && tras.items[0]?.cantidad === 2);
  comprobar("gana uno de los dos ENTERO, sin mezclarse", coherente, `qued\xF3 ${tras?.paso}`);
  await borrarEstado(convPedidos, { actor: "script:probar-estado", proceso: "limpieza" });
  console.log("\nA9. DOS COSAS EN UN PEDIDO (el caso real del 17-ago)");
  const dosCosas = validarPropuesta(
    {
      items: [
        { ofrecible: "sencillo", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] },
        { ofrecible: "caja grande", cantidad: 1, opciones: cincoSalsas }
      ],
      datos: { nombre: "Ana", telefono: "3001234567", direccion: "Cra 1 #2-3" },
      confirmado: true,
      paso: "confirmado"
    },
    catalogo,
    void 0,
    requisitos
  );
  comprobar(
    "los dos caben, y el pedido se confirma",
    dosCosas.ok && dosCosas.estado.confirmado,
    dosCosas.rechazos.join(" \xB7 ")
  );
  comprobar(
    "cada uno con SUS opciones, sin mezclarse",
    dosCosas.estado.items[0]?.seleccion.length === 1 && dosCosas.estado.items[1]?.seleccion.length === 5
  );
  comprobar(
    "el total es la SUMA de los dos",
    dosCosas.estado.totalCents === 1e6 + 4e6,
    `$${(dosCosas.estado.totalCents ?? 0) / 100}`
  );
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: dosCosas.estado, actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("y vuelve de la base con sus DOS items", (await leerEstado(convPedidos))?.items.length === 2);
  await borrarEstado(convPedidos, { actor: "script:probar-estado", proceso: "limpieza" });
  console.log("\n\n\u25A0 BLOQUE B \u2014 CITAS\n");
  const creadoB = await createClientWithOwner({
    organizationName: `PRUEBA citas ${marca}`,
    ownerName: "Prueba Citas",
    ownerEmail: correoCitas,
    password: `Prueba-${marca}-y7`,
    needsAppointments: true
  });
  orgCitas = creadoB.organizationId;
  efimeros.push(orgCitas);
  const idServicio = newId("service");
  await db.insert(service).values({
    id: idServicio,
    organizationId: orgCitas,
    name: "PESTA\xD1AS CL\xC1SICAS",
    priceCents: 8e6,
    durationMin: 90
  });
  const idStaff = newId("staffMember");
  await db.insert(staffMember).values({ id: idStaff, organizationId: orgCitas, name: "Profesional 1" });
  await db.insert(staffService).values({
    id: newId("staffService"),
    organizationId: orgCitas,
    staffId: idStaff,
    serviceId: idServicio
  });
  await ponerFicha(orgCitas, {
    ...FICHA_BASE,
    nombre: `PRUEBA citas ${marca}`,
    vertical: "citas",
    queVende: "servicios de belleza",
    catalogo: "PESTA\xD1AS CL\xC1SICAS \u2014 $80.000",
    entrega: { haceDomicilios: false, quienPagaElDomicilio: "" },
    cierre: { requisitos: [{ id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true }] }
  });
  const contactoB = newId("contact");
  await db.insert(contact).values({
    id: contactoB,
    organizationId: orgCitas,
    phone: `99911${marca}`.slice(0, 15),
    name: "Clienta de prueba"
  });
  convCitas = newId("conversation");
  await db.insert(conversation).values({ id: convCitas, organizationId: orgCitas, contactId: contactoB, isTest: true });
  console.log(`  cliente ef\xEDmero de citas: ${orgCitas}`);
  const [perfilB] = await db.select({
    appointmentsEnabled: agentProfile.appointmentsEnabled,
    ficha: agentProfile.ficha,
    stateSource: agentProfile.stateSource
  }).from(agentProfile).where(eq6(agentProfile.organizationId, orgCitas));
  console.log("\nB1. EL VERTICAL");
  comprobar("nace como negocio de citas", perfilB?.appointmentsEnabled === true);
  comprobar("y el vertical se deduce del mismo sitio que en pedidos", verticalDe(perfilB?.appointmentsEnabled ?? false) === "citas");
  console.log("\nB2. LO QUE PIDE PARA CERRAR");
  const reqCitas = await requisitosGuardados(orgCitas);
  comprobar("pide exactamente lo que declar\xF3: uno", reqCitas?.length === 1, reqCitas?.map((r) => r.id).join(", "));
  comprobar("NO pide direcci\xF3n", !reqCitas?.some((r) => r.id === "direccion" || r.tipo === "direccion"));
  comprobar("NO pide tel\xE9fono", !reqCitas?.some((r) => r.id === "telefono" || r.tipo === "telefono"));
  const catalogoCitas = await catalogoDe(orgCitas, "citas");
  const servicio = catalogoCitas[0];
  const citaElegida = {
    ...estadoVacio(),
    producto: { id: servicio?.id ?? null, nombre: servicio?.nombre ?? null, cantidad: 1 },
    datos: { nombre: "Ana" }
  };
  comprobar(
    "con el servicio y el nombre, no queda nada pendiente",
    loQueFalta(citaElegida, catalogoCitas, reqCitas).length === 0,
    loQueFalta(citaElegida, catalogoCitas, reqCitas).join(" \xB7 ")
  );
  const sinNada = { ...estadoVacio(), datos: { nombre: "Ana" } };
  comprobar(
    "y sin servicio elegido, lo \xFAnico que falta es el servicio: nunca un dato personal",
    loQueFalta(sinNada, catalogoCitas, reqCitas).length === 1,
    loQueFalta(sinNada, catalogoCitas, reqCitas).join(" \xB7 ")
  );
  console.log("\nB3. EL FLUJO DE CITAS SIGUE FUNCIONANDO");
  comprobar(
    "el servicio se lee por el mismo camino que un producto",
    catalogoCitas.length === 1 && servicio?.nombre === "PESTA\xD1AS CL\xC1SICAS"
  );
  const horario = { open: "09:30", close: "18:30", days: "1,2,3,4,5" };
  const huecos = calcularDisponibilidad({ staffIds: [idStaff], citas: [], duracionMin: 90, hours: horario, esHoy: false });
  const franjas = Object.entries(huecos).filter(([, quienes]) => quienes.includes(idStaff));
  comprobar("hay huecos que ofrecer con la agenda vac\xEDa", franjas.length > 0, `${franjas.length} franjas: ${franjas[0]?.[0]}\u2026${franjas.at(-1)?.[0]}`);
  const ocupada = calcularDisponibilidad({
    staffIds: [idStaff],
    citas: [{ staffId: idStaff, startMin: 570, endMin: 1110 }],
    duracionMin: 90,
    hours: horario,
    esHoy: false
  });
  comprobar(
    "y ninguno cuando el d\xEDa entero est\xE1 ocupado",
    Object.values(ocupada).every((quienes) => !quienes.includes(idStaff))
  );
  console.log("\nB4. LOS REQUISITOS NO TOCAN EL PROMPT");
  const fichaB = leerFichaAplanada(perfilB?.ficha ?? null);
  const conCierre = generarPerfil(fichaB, { vertical: "citas" });
  const sinCierre = generarPerfil({ ...fichaB, cierre: void 0 }, { vertical: "citas" });
  comprobar(
    "el prompt es id\xE9ntico con y sin requisitos declarados",
    JSON.stringify(conCierre) === JSON.stringify(sinCierre)
  );
  console.log("\nB5. LA BANDERA");
  comprobar("el cliente de citas tambi\xE9n nace en 'prompt'", perfilB?.stateSource === "prompt");
  console.log("\n\n\u25A0 CIERRE\n");
  console.log("C1. LA FLOTA NO CAMBI\xD3");
  const flotaDespues = await huellaDeLaFlota();
  comprobar("todas las filas de agent_profile, id\xE9nticas", flotaAntes === flotaDespues);
  if (flotaAntes !== flotaDespues) {
    console.log(explicar(compararFila(JSON.parse(flotaAntes), JSON.parse(flotaDespues), [])));
  }
  console.log("\nC2. SIN ESTADO PERSISTENTE");
  comprobar("no queda estado en la conversaci\xF3n de pedidos", await leerEstado(convPedidos) === null);
  comprobar("ni en la de citas", await leerEstado(convCitas) === null);
} finally {
  for (const org of efimeros) {
    await db.delete(organization).where(eq6(organization.id, org));
  }
  await db.delete(user).where(inArray(user.email, [correoPedidos, correoCitas]));
  if (efimeros.length) {
    const huerfanos = [];
    const restos = [
      ["agent_profile", (await db.select().from(agentProfile).where(inArray(agentProfile.organizationId, efimeros))).length],
      ["product", (await db.select().from(product).where(inArray(product.organizationId, efimeros))).length],
      ["product_option_group", (await db.select().from(productOptionGroup).where(inArray(productOptionGroup.organizationId, efimeros))).length],
      ["product_option", (await db.select().from(productOption).where(inArray(productOption.organizationId, efimeros))).length],
      ["service", (await db.select().from(service).where(inArray(service.organizationId, efimeros))).length],
      ["staff_member", (await db.select().from(staffMember).where(inArray(staffMember.organizationId, efimeros))).length],
      ["staff_service", (await db.select().from(staffService).where(inArray(staffService.organizationId, efimeros))).length],
      ["contact", (await db.select().from(contact).where(inArray(contact.organizationId, efimeros))).length],
      ["conversation", (await db.select().from(conversation).where(inArray(conversation.organizationId, efimeros))).length],
      ["conversation_state", (await db.select().from(conversationState).where(inArray(conversationState.organizationId, efimeros))).length]
    ];
    for (const [nombre, n] of restos) if (n) huerfanos.push(`${nombre}: ${n}`);
    console.log(`
\u{1F9F9} clientes ef\xEDmeros borrados (${efimeros.join(", ")})`);
    comprobar("sin datos hu\xE9rfanos tras la limpieza", huerfanos.length === 0, huerfanos.join(" \xB7 "));
  }
}
console.log(`
${"=".repeat(74)}`);
console.log(fallos.length === 0 ? "\u2705 TODO PASA" : `\u{1F534} FALLAN ${fallos.length}: ${fallos.join(", ")}`);
console.log(`${"=".repeat(74)}
`);
process.exit(fallos.length === 0 ? 0 : 1);
