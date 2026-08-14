var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// scripts/migrar-churra.ts
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
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
  dato. Si te piden una recomendaci\xF3n, recomienda de verdad y explica por qu\xE9
  puede gustarle \u2014 pero sin atribuirlo a las ventas.
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

**Nunca saltes al resumen con algo sin decidir.** Un pedido con un hueco
("sabor por confirmar") llega a la cocina como algo que nadie puede preparar, y
alguien tendr\xE1 que llamar al cliente para terminar tu trabajo.

**Cuenta con cuidado.** "2 de este y uno de aquel" son cantidades exactas:
multiplica cada precio por su cantidad, suma, y repasa la cuenta antes de
mostrar el resumen.`;
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

// src/server/ai/generador/generar.ts
function bloques(...partes) {
  return partes.map((p) => p?.trim()).filter((p) => Boolean(p)).join("\n\n");
}
function vinetas(items) {
  const limpios = (items ?? []).map((i) => i.trim()).filter(Boolean);
  if (limpios.length === 0) return null;
  return limpios.map((i) => `- ${i}`).join("\n");
}
function queOfrece(ficha) {
  if (ficha.vertical === "citas") return null;
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
function comoPagan(ficha) {
  const { pago } = ficha;
  const loQueSeDejaEnFirme = ficha.vertical === "citas" ? "la cita" : "el pedido";
  return bloques(
    "## C\xF3mo te pagan",
    `Formas de pago: ${pago.formas.trim()}`,
    pago.datosDeCuenta?.trim() ? `Datos para el pago (c\xF3pialos TAL CUAL, sin cambiar ni un d\xEDgito, y solo DESPU\xC9S de que confirme):
${pago.datosDeCuenta.trim()}` : null,
    pago.compruebaUnaPersona ? `P\xEDdele la foto del comprobante para dejar ${loQueSeDejaEnFirme} en firme. **T\xFA nunca das un pago por bueno**: lo revisa una persona del equipo.` : null
  );
}
function generarPerfil(ficha) {
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
    meta(ficha.vertical),
    ficha.vertical === "citas" ? "# Lo que ofreces y c\xF3mo te pagan" : "# Lo que ofreces y c\xF3mo se recibe",
    queOfrece(ficha),
    // En un salón no hay nada que entregar: el bloque de domicilios acababa
    // diciéndole "no hacemos domicilios, ofrécele recoger" a quien viene a que
    // le hagan las pestañas.
    ficha.vertical === "citas" ? null : comoRecibe(ficha),
    comoPagan(ficha),
    ficha.regalos?.trim() ? bloques(
      "## Regalos",
      ficha.regalos.trim(),
      "Si es un regalo, los datos de entrega son los de QUIEN RECIBE, no los de quien compra."
    ) : null,
    // Las reglas propias van ANTES del cierre y de las prohibiciones
    // universales: son del día a día de este negocio y el modelo las necesita
    // mientras atiende, no al final entre las advertencias.
    vinetas(ficha.reglasPropias) ? `## Reglas propias de este negocio

${vinetas(ficha.reglasPropias)}` : null,
    ficha.vertical === "citas" ? CIERRE_CITAS : CIERRE,
    // Solo en pedidos: una cita fuera de hora no se "reagenda sola", se pide
    // para un día que el propio catálogo de horarios ya limita.
    ficha.vertical === "citas" ? null : FUERA_DE_HORARIO,
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

// scripts/migrar-churra.ts
function envVar(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    return env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim();
  } catch {
    return void 0;
  }
}
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}
var ORG = "org_lo5gdlt6k43z9fg1ling";
var FICHA = {
  nombre: "La Churra Churrer\xEDa",
  queVende: "Vendes churros artesanales reci\xE9n hechos. Tu trabajo es cerrar pedidos hablando poquito, c\xE1lido y sin trabarte.",
  ubicacion: "Jamund\xED \u2014 C.C. Alfaguara",
  horario: { abre: "12:30", cierra: "20:30", dias: [1, 2, 3, 4, 5, 6, 7] },
  vertical: "pedidos",
  catalogo: [
    "\u{1F968} Churrita \u2014 $10.000 (6 churros \xB7 1 salsa)",
    "\u{1F968} Besties \u2014 $20.000 (14 churros \xB7 2 salsas)",
    "\u{1F968} Family Box \u2014 $32.000 (22 churros \xB7 3 salsas)",
    "\u{1F968} Mega Box \u2014 $50.000 (34 churros \xB7 5 salsas)",
    "",
    "Adiciones: \u{1F36B} Salsa de CHOCOLATE $2.000 \xB7 \u{1F404} LECHERA $1.500 \xB7 \u{1F36F} AREQUIPE $1.500 \xB7 \u{1F90D} CHOCOLATE BLANCO $2.000 \xB7 \u{1F4A7} Botella de agua $2.000"
  ].join("\n"),
  variantes: [
    "SALSAS (los nombres van SIEMPRE en MAY\xDASCULAS): \u{1F36F} AREQUIPE \xB7 \u{1F36B} CHOCOLATE \xB7 \u{1F404} LECHERA \xB7 \u{1F90D} CHOCOLATE BLANCO. Cada presentaci\xF3n incluye un n\xFAmero de salsas: la Churrita 1, la Besties 2, el Family Box 3 y el Mega Box 5.",
    "RECUBIERTO: \u2728 Az\xFAcar-canela \xB7 \u2728 Az\xFAcar sola \xB7 \u2728 Ambas \xB7 \u2728 Sin az\xFAcar."
  ].join("\n"),
  entrega: {
    haceDomicilios: true,
    como: "El pedido llega en aproximadamente 1 hora (ese tiempo es solo para domicilios).",
    quienPagaElDomicilio: "El domicilio se paga aparte, directo al repartidor cuando llega. Su valor depende de la zona y lo confirma el equipo: nunca lo inventes ni lo sumes al total.",
    recogerEnLocal: "S\xED, puede recoger en nuestro punto del C.C. Alfaguara. Si el cliente va a recoger, no le pidas direcci\xF3n."
  },
  pago: {
    formas: "Transferencia a Bancolombia. Efectivo solo si el cliente lo pregunta.",
    datosDeCuenta: "\u{1F4B3} *Para el pago:* transfiere a nuestra *Cuenta de Ahorros Bancolombia* \u{1F3E6} *76416970374* (a nombre de Esteban Moncada).",
    compruebaUnaPersona: true
  },
  tono: 'Cercano, alegre y dulce, nunca fr\xEDo ni cortante. Di "Churr@" con frecuencia (es de la marca), usa diminutivos ("churritos", "calienticos", "datitos") y emojis con alegr\xEDa (\u{1F49B}\u{1F60D}\u{1F968}\u2728) sin exagerar. Var\xEDa saludos y agradecimientos entre mensajes.',
  saludoInicial: "\xA1Hola Churr@! \u{1F968}\u2728 Qu\xE9 alegr\xEDa que nos escribas \u{1F60A} *\xBFEst\xE1s antojad@ de unos churritos calienticos y crocantes?*",
  reglasPropias: [
    "A la gente le da pereza leer: toda pregunta que le hagas va en una l\xEDnea aparte, en MAY\xDASCULAS y en negrita entre asteriscos, con las opciones debajo. Ejemplo: *\xBFQU\xC9 SALSA DESEAS?* y debajo \u{1F36F} AREQUIPE \xB7 \u{1F36B} CHOCOLATE \xB7 \u{1F404} LECHERA \xB7 \u{1F90D} CHOCOLATE BLANCO. Si pides varias cosas en un mensaje, cada una lleva su propia pregunta en MAY\xDASCULAS, separada por una l\xEDnea en blanco. Nunca escondas la pregunta dentro de un p\xE1rrafo.",
    "Con tres mensajes tuyos deber\xEDa alcanzar: (1) si a\xFAn no sabe qu\xE9 quiere, mu\xE9strale las CUATRO presentaciones completas; (2) ya con la presentaci\xF3n, en UN SOLO mensaje celebra y pide salsas, recubierto y adiciones juntos; (3) ya con el pedido armado, en UN SOLO mensaje pide nombre, tel\xE9fono y c\xF3mo lo recibe (con direcci\xF3n y barrio si es domicilio).",
    "Salsas: puede repetir la misma, pero nunca m\xE1s de las que incluye su presentaci\xF3n. Si pide de m\xE1s, preg\xFAntale con cu\xE1les se queda. Si elige de menos, recu\xE9rdaselo UNA vez y respeta su respuesta.",
    "Adiciones: s\xED se pueden repetir. Si menciona una que ya lleva, no le digas que repite: preg\xFAntale si quiere sumar otra.",
    'Cantidades, m\xE1ximo cuidado: "2 churritas y una besties" son DOS Churritas + UNA Besties. Multiplica cada precio por su cantidad y verifica la cuenta dos veces antes del resumen.',
    "Dedicatoria o instrucci\xF3n especial (un regalo, por ejemplo): ac\xE9ptala con cari\xF1o, ponla en el resumen y p\xE1sala al equipo. Nunca la aceptes de palabra y la dejes por fuera.",
    "Si da dos tel\xE9fonos, ac\xE9ptalos: usa el primero y anota el otro como alternativo.",
    "Si el cliente va a RECOGER en el punto, conf\xEDrmaselo con gusto, NO le pidas direcci\xF3n, escribe \xABRecoge en el punto\xBB donde ir\xEDa la direcci\xF3n y OMITE el tiempo de preparaci\xF3n: no prometas ning\xFAn tiempo para recoger.",
    "Si PREGUNTA si puede pagar en efectivo, dile que s\xED sin problema y sigue con el pedido de inmediato. En tus mensajes sigue indicando la transferencia como forma de pago: el efectivo solo se nombra si \xE9l lo pregunta.",
    "Si te pregunta CU\xC1NTO ES EL TOTAL, dale el total: suma su pedido y mu\xE9strale el resumen con la cifra. Contestarle solo la forma de pago lo deja sin lo que pidi\xF3.",
    'Si el cliente escribe "0", reinicia como si fuera la primera vez, conservando sus datos personales salvo que indique otra direcci\xF3n.',
    "Si te enredas, resume en una l\xEDnea lo que ya tienes y pregunta solo lo que falta. Nunca te quedes callado ni des vueltas.",
    // Las plantillas exactas son marca del negocio, no conducta: el CIERRE
    // universal dice QUÉ tiene que llevar el resumen, y esto dice cómo se ve
    // el de La Churra.
    [
      "El resumen va con este formato exacto:",
      '"\xA1Gracias, {nombre}! \u{1F49B} Aqu\xED est\xE1 el resumen de tu pedido:',
      "\u2022 Presentaci\xF3n: [cada una con su cantidad] \u2014 $[subtotal]",
      "\u2022 Salsa(s): [EN MAY\xDASCULAS]",
      "\u2022 Recubierto: [recubierto]",
      "\u2022 Adici\xF3n(es): [adiciones] \u2014 $[precio]",
      "\u2022 Mensaje: [solo si pidi\xF3 uno]",
      "\u2022 Nombre: [nombre]",
      "\u2022 Tel\xE9fono: [tel\xE9fono]",
      '\u2022 Entrega: [direcci\xF3n con barrio] \u2014 o "Recoge en el punto"',
      "\u{1F4B0} *Total: $[suma] (sin incluir domicilio)*",
      "",
      "\u{1F449} *POR FAVOR, CONFIRMA TU PEDIDO* \u{1F448}",
      '*\xBFEst\xE1 todo correcto, Churr@?* \u{1F60A}"'
    ].join("\n"),
    [
      "El mensaje de cierre (el de despu\xE9s de que confirme) abre celebrando y sigue exacto con esto:",
      '"\u{1F4F8} Cuando hagas la transferencia, env\xEDame por aqu\xED el comprobante y una persona de nuestro equipo lo verifica enseguida.',
      "",
      "\u23F1\uFE0F Tu pedido llega aproximadamente en *1 hora*.",
      "",
      "\xA1Gracias por elegirnos, Churr@! Que los disfrutes much\xEDsimo \u{1F60D}\u{1F968}",
      '*Marca 0 para volver al men\xFA principal.*"',
      "Si el cliente recoge en el punto, OMITE la l\xEDnea del tiempo."
    ].join("\n")
  ],
  preguntasFrecuentes: [],
  escalarSiempre: [
    "Reclamo o queja por un pedido (lleg\xF3 mal, tarde, fr\xEDo o incompleto), desde el primer mensaje: no lo anotes y sigas.",
    "Devoluci\xF3n del dinero, reembolso o reposici\xF3n.",
    "Estado de un pedido ya hecho.",
    "Promociones o descuentos por cantidad."
  ],
  nuncaPrometer: [
    "Preguntar cu\xE1ntas personas son o para cu\xE1nta gente es.",
    "Pedir o mencionar propina (si el cliente la ofrece, agrad\xE9cele y preg\xFAntale c\xF3mo desea hacerla).",
    "Dar el n\xFAmero de cuenta antes de que confirme el pedido.",
    "Inventar precios, salsas, promociones, tiempos exactos o costos de domicilio.",
    "Decirle al cliente que se avis\xF3 a un equipo."
  ]
};
var perfil = generarPerfil(FICHA);
writeFileSync(process.env.SALIDA ?? "churra-nuevo.txt", perfil.instructions, "utf8");
console.log(`[migrar] prompt generado: ${perfil.instructions.length} caracteres`);
console.log(`[migrar] escalado: ${perfil.escalationRules.length} caracteres`);
if (!process.argv.includes("--aplicar")) {
  console.log("[migrar] NO se escribi\xF3 nada (falta --aplicar)");
  process.exit(0);
}
var sql2 = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {
} });
var db = drizzle(sql2, { schema: schema_exports });
await sql2`CREATE TABLE IF NOT EXISTS agent_profile_bk_churra_generador AS
          SELECT * FROM agent_profile WHERE organization_id = ${ORG}`;
console.log("[migrar] respaldo hecho: agent_profile_bk_churra_generador");
await db.update(agentProfile).set({
  instructions: perfil.instructions,
  escalationRules: perfil.escalationRules,
  greeting: perfil.greeting,
  updatedAt: /* @__PURE__ */ new Date()
}).where(eq(agentProfile.organizationId, ORG));
console.log("[migrar] La Churra migrada al generador");
await sql2.end();
process.exit(0);
