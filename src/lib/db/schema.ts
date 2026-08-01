import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Rol de PLATAFORMA (por encima de las organizaciones): la agencia que
  // hospeda la instancia. NULL = usuario normal, acotado a sus membresías.
  platformRole: text("platform_role", { enum: ["superadmin"] }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_org_phone_uq").on(t.organizationId, t.phone),
    index("contact_org_name_idx").on(t.organizationId, t.name),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // "operador": una persona escribió en la bandeja y tomó la conversación.
      enum: ["cliente", "modelo", "error", "ventana", "operador"],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
    // YCloud no manda phone_number_id: el webhook enruta por el número del
    // negocio (`to`). Guardado normalizado (solo dígitos) y único por instancia
    // para que el mensaje de un cliente jamás caiga en la bandeja de otro.
    uniqueIndex("meta_credentials_display_phone_uq").on(t.displayPhoneNumber),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    hoursOpen: text("hours_open"), // "12:30"
    hoursClose: text("hours_close"), // "20:30"
    /** Días que abre, 1 = lunes … 7 = domingo. Ej: "1,2,3,4,5,6,7". */
    hoursDays: text("hours_days"),
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
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

/* ============================================================
 * Citas (vertical de agendamiento: peluquería, estética, spa…)
 * Solo existe para organizaciones con agent_profile.appointments_enabled.
 * ============================================================ */

export const service = pgTable(
  "service",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Libre, no un enum: cada negocio arma sus propias categorías. */
    category: text("category"),
    priceCents: integer("price_cents").notNull().default(0),
    durationMin: integer("duration_min").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("service_org_idx").on(t.organizationId)]
);

export const staffMember = pgTable(
  "staff_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("staff_org_idx").on(t.organizationId)]
);

/** Qué persona puede atender cada servicio (muchos a muchos). */
export const staffService = pgTable(
  "staff_service",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffMember.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("staff_service_uq").on(t.staffId, t.serviceId)]
);

export const appointment = pgTable(
  "appointment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffMember.id),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    status: text("status", {
      enum: [
        "pendiente",
        "confirmada",
        "reagendada",
        "cancelada",
        "completada",
        "no_show",
      ],
    })
      .notNull()
      .default("pendiente"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Chequeo de solapamiento: todas las citas de UNA especialista, ese día.
    index("appointment_org_staff_starts_idx").on(
      t.organizationId,
      t.staffId,
      t.startsAt
    ),
    index("appointment_org_contact_idx").on(t.organizationId, t.contactId),
  ]
);

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * Consumo y costos
 * ============================================================ */

/**
 * Cada gasto que genera un cliente, anotado en el momento en que ocurre.
 *
 * Sin esto la agencia cobra a ciegas: sabe lo que gasta en total, pero no
 * cuánto le cuesta CADA negocio, que es lo que decide si una mensualidad da
 * margen o lo come. Importa aún más desde el 1-oct-2026, cuando Meta empieza a
 * cobrar todos los mensajes salientes.
 *
 * `costUsd` es numérico exacto, no coma flotante: son fracciones de centavo que
 * se suman miles de veces, y en flotante el total acaba desviándose.
 *
 * Los mensajes de WhatsApp se anotan aunque hoy cuesten 0 (las respuestas
 * dentro de la ventana de 24 h son gratis): contarlos ahora es lo que permite
 * proyectar la factura de octubre con datos reales en vez de con suposiciones.
 */
export const usageEvent = pgTable(
  "usage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `ia` = una llamada al modelo · `whatsapp` = un mensaje saliente. */
    kind: text("kind", { enum: ["ia", "whatsapp"] }).notNull(),
    /** El modelo usado, o el tipo de mensaje (`text`, `template`). */
    detail: text("detail"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 10 })
      .notNull()
      .default("0"),
    /** De dónde salió: el wamid del mensaje o de qué proceso viene. */
    ref: text("ref"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("usage_org_fecha_idx").on(t.organizationId, t.createdAt)]
);

/**
 * Conocimiento que el sistema propone tras leer conversaciones reales.
 *
 * El agente no "aprende solo" —el modelo no cambia—, pero su conocimiento sí
 * puede crecer: se lee en cada mensaje, así que una entrada nueva surte efecto
 * al instante. Lo que aquí se guarda son PROPUESTAS, no verdades.
 *
 * Pasan por aprobación a propósito. Un operador responde con prisa, escribe un
 * precio mal o contesta algo de un día suelto ("hoy no hay fresa"); si eso
 * entrara solo al conocimiento, el agente se lo diría a TODOS los clientes de
 * ese negocio durante meses. Un dato falso aquí se propaga a cientos de
 * conversaciones antes de que nadie lo note.
 */
export const learningProposal = pgTable(
  "learning_proposal",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    /** Por qué se propone: la frase del chat que lo motivó. */
    evidence: text("evidence"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    /** La entrada de conocimiento que se creó al aprobarla. */
    kbEntryId: text("kb_entry_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [index("learning_org_status_idx").on(t.organizationId, t.status)]
);
