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
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // NULL no choca consigo mismo en un índice único de Postgres: varios
    // contactos sin teléfono (o sin wa_user_id) conviven sin problema.
    uniqueIndex("contact_org_phone_uq").on(t.organizationId, t.phone),
    uniqueIndex("contact_org_wa_user_id_uq").on(t.organizationId, t.waUserId),
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
    origen: text("origen", { enum: ["cliente", "operador", "agente"] })
      .notNull()
      .default("cliente"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

/* ============================================================
 * Catálogo de PEDIDOS (churrería, pastelería, restaurante…)
 *
 * El equivalente de `service` para el otro vertical. Existe desde el
 * 15-ago-2026 para sacar el menú del prompt: hasta entonces vivía como TEXTO
 * dentro de `agent_profile.instructions`, así que cambiar un precio obligaba a
 * regenerar el prompt, y el mismo dato podía estar en dos sitios a la vez.
 *
 * Es el patrón que citas ya usa desde el 13-ago (`docs/korexia/58-EL-CATALOGO-VIVE-EN-SERVICIOS.md`).
 *
 * ⚠️ Tabla propia y NO `service`, a propósito: `service.durationMin` es NOT NULL
 * y no significa nada para un churro, y arrastra el acoplamiento con la
 * restricción de solape de citas y con `staff_service`. Además los productos
 * necesitan opciones con precio (salsas, tamaños, adiciones), que los servicios
 * no tienen.
 * ============================================================ */

export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("product_org_idx").on(t.organizationId),
    // Habilita las FK compuestas de los hijos: sin esto, un grupo de opciones
    // podría colgar de un producto de OTRA organización.
    uniqueIndex("product_org_id_uq").on(t.organizationId, t.id),
  ]
);

/** "Salsa", "Tamaño", "Adiciones": lo que el cliente elige de un producto. */
export const productOptionGroup = pgTable(
  "product_option_group",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
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
      name: "product_option_group_product_fk",
    }).onDelete("cascade"),
  ]
);

export const productOption = pgTable(
  "product_option",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull(),
    name: text("name").notNull(),
    /**
     * Un solo mecanismo para dos cosas: una salsa incluida va a 0, un "queso
     * extra" a +2.000, y un tamaño mayor a +8.000 sobre el precio base.
     */
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    available: boolean("available").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("product_option_org_idx").on(t.organizationId),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [productOptionGroup.organizationId, productOptionGroup.id],
      name: "product_option_group_fk",
    }).onDelete("cascade"),
  ]
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
  (t) => [
    index("service_org_idx").on(t.organizationId),
    // Habilita la FK compuesta de appointment_service: sin esto, una fila
    // podría colgar de un servicio de OTRA organización.
    uniqueIndex("service_org_id_uq").on(t.organizationId, t.id),
  ]
);

/**
 * Un recurso reservable: hoy siempre una persona, pero **no es un enum**
 * (paso 4, 18-ago-2026 — docs/korexia/83-RECURSOS-Y-RESERVAS.md). Hasta esa
 * fecha esta tabla se llamaba `staff_member` y era el único tipo de recurso
 * posible en todo el esquema; el día que un negocio necesite reservar una
 * sala o un equipo, es una fila más con otro `type`, no una tabla nueva.
 */
export const resource = pgTable(
  "resource",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Libre, no un enum: "persona" hoy; "espacio"/"equipo" el día que un negocio lo declare. */
    type: text("type").notNull().default("persona"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("resource_org_idx").on(t.organizationId),
    // Habilita la FK compuesta de appointment_resource: sin esto, un vínculo
    // podría colgar de un recurso de OTRA organización.
    uniqueIndex("resource_org_id_uq").on(t.organizationId, t.id),
  ]
);

/** Qué recurso puede atender cada servicio (muchos a muchos). */
export const resourceService = pgTable(
  "resource_service",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("resource_service_uq").on(t.resourceId, t.serviceId)]
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
    /**
     * Recordatorio manual: lo dispara el personal administrativo con un botón
     * en /appointments, cuando ellos decidan — no hay ningún proceso
     * automático que revise citas próximas. Null = nunca se envió.
     */
    remindedAt: timestamp("reminded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("appointment_org_contact_idx").on(t.organizationId, t.contactId),
    // Habilita la FK compuesta de appointment_resource.
    uniqueIndex("appointment_org_id_uq").on(t.organizationId, t.id),
  ]
);

/**
 * Qué recurso(s) lleva una reserva — la pieza que hasta el paso 4 no existía
 * (`appointment.staffId` fundía reserva y recurso en una sola fila, así que
 * una cita no podía requerir dos recursos a la vez).
 *
 * `startsAt`/`endsAt`/`status` van DUPLICADOS de `appointment` a propósito:
 * un `EXCLUDE USING gist` solo puede referenciar columnas de SU PROPIA tabla,
 * y el chequeo de solapamiento vive aquí, no en `appointment`. Un TRIGGER
 * (migración `0024_recursos_y_reservas.sql`) los mantiene sincronizados en
 * cada `UPDATE` de `appointment` — es la misma razón que ya justificó mover
 * la restricción a este lugar: no puede depender de que nadie se acuerde de
 * tocar las dos tablas.
 */
export const appointmentResource = pgTable(
  "appointment_resource",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").notNull(),
    resourceId: text("resource_id").notNull(),
    /** Espejo de `appointment.startsAt` — ver el porqué en el comentario de arriba. */
    startsAt: timestamp("starts_at").notNull(),
    /** Espejo de `appointment.endsAt`. */
    endsAt: timestamp("ends_at").notNull(),
    /** Espejo de `appointment.status`. */
    status: text("status").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // El chequeo de solapamiento: todas las reservas de UN recurso, ese día.
    index("appointment_resource_org_resource_starts_idx").on(
      t.organizationId,
      t.resourceId,
      t.startsAt
    ),
    index("appointment_resource_appointment_idx").on(t.appointmentId),
    // Aislamiento estructural, no por disciplina (docs/korexia/10-SEGURIDAD.md).
    foreignKey({
      columns: [t.organizationId, t.appointmentId],
      foreignColumns: [appointment.organizationId, appointment.id],
      name: "appointment_resource_appointment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.resourceId],
      foreignColumns: [resource.organizationId, resource.id],
      name: "appointment_resource_resource_fk",
    }),
  ]
);

/**
 * Qué servicios lleva una reserva — la pieza que hasta ahora no existía
 * (`appointment.serviceId` es único y `NOT NULL`, así que una visita no
 * podía llevar "manos y pies" a la vez).
 *
 * `appointment.serviceId` **se conserva tal cual**: pasa a significar "el
 * primer servicio de la visita", así que todo lo que hoy hace `innerJoin`
 * contra él sigue funcionando sin tocarse. Esta tabla es la fuente completa;
 * `position` conserva el orden en que se pidió y `durationMin` es un
 * espejo de `service.durationMin` en el momento de agendar — testimonio,
 * igual que `OpcionElegida.nombre`: si el negocio cambia la duración de un
 * servicio después, una visita ya agendada sigue siendo legible.
 *
 * ⚠️ **`appointment.serviceId` y la fila de aquí con `position=0` duplican
 * el mismo hecho, sin trigger que los sincronice** (a diferencia de
 * `appointment_resource`, que sí tiene uno). Hoy la única defensa es que
 * `crearCitaMultiple` (`appointments/queries.ts`) es la ÚNICA función que
 * escribe las dos, en la misma transacción. Cualquier función nueva que
 * edite los servicios de una cita ya creada debe actualizar ambas.
 */
export const appointmentService = pgTable(
  "appointment_service",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").notNull(),
    serviceId: text("service_id").notNull(),
    position: integer("position").notNull(),
    durationMin: integer("duration_min").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("appointment_service_appointment_idx").on(t.appointmentId),
    uniqueIndex("appointment_service_position_uq").on(t.appointmentId, t.position),
    foreignKey({
      columns: [t.organizationId, t.appointmentId],
      foreignColumns: [appointment.organizationId, appointment.id],
      name: "appointment_service_appointment_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.serviceId],
      foreignColumns: [service.organizationId, service.id],
      name: "appointment_service_service_fk",
    }),
  ]
);

/**
 * Los horarios que el agente le ofreció al cliente en esta conversación.
 *
 * Existen para una sola regla: **solo se puede agendar un horario que el
 * agente haya ofrecido**. `crearCita` ya valida que el hueco esté libre, pero
 * eso no impide que el modelo agende uno que nunca ofreció — el caso real es
 * una fecha relativa mal entendida ("el miércoles", "mañana en la tarde", ver
 * 19-CITAS.md) que cae por casualidad en un hueco libre y se reserva mal.
 *
 * Se reemplazan enteros en cada consulta de disponibilidad: lo ofrecido antes
 * ya no vale. Idea tomada de `offered_slots` de `nea-agent`.
 */
export const offeredSlot = pgTable(
  "offered_slot",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    /** Fecha en formato DD/MM/AAAA, tal como la maneja el motor de citas. */
    fecha: text("fecha").notNull(),
    /** Hora "HH:MM" en hora de Bogotá, igual que `disponibilidadReal`. */
    hora: text("hora").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("offered_slot_conversation_idx").on(t.conversationId)]
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

/**
 * Captura del webhook de YCloud ANTES de cualquier parseo de negocio (Fase 0
 * de la revisión de arquitectura, 3-ago-2026). Invierte el modelo de fallo
 * anterior: antes se respondía 200 y se procesaba después (con `after()`),
 * así que un fallo a mitad de camino era invisible e irrecuperable — no
 * quedaba ni rastro de qué había mandado YCloud. Ahora el crudo se guarda
 * primero; si eso falla, se responde 5xx para que el proveedor pueda
 * reintentar. Si el guardado sale bien pero el PROCESAMIENTO falla, queda
 * aquí con `status='fallido'` y el error, en vez de perderse en un log que
 * rota.
 */
export const webhookEvent = pgTable(
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
      onDelete: "set null",
    }),
    status: text("status", { enum: ["recibido", "procesado", "fallido"] })
      .notNull()
      .default("recibido"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    index("webhook_event_status_idx").on(t.status),
    index("webhook_event_org_idx").on(t.organizationId),
  ]
);

/**
 * Cola de trabajos del agente (8-ago-2026, fases 1 y 2 de
 * `docs/korexia/33-ESCALABILIDAD.md`).
 *
 * Sustituye al `Map` de `globalThis` con `setTimeout` que vivía en
 * `server/ai/pipeline.ts`. Aquel funcionaba con un solo proceso y solo con
 * suerte: **dos réplicas respondían dos veces al mismo cliente** (estuvo a
 * punto de pasar el 3-ago, cuando Swarm dejó dos contenedores vivos), y un
 * reinicio con un temporizador pendiente **perdía el turno para siempre** —
 * el cliente se quedaba esperando una respuesta que ya no iba a llegar.
 *
 * El debounce y la cola son el mismo problema, así que son una sola tabla:
 * `runAt` es "cuándo toca ejecutarlo". Cada mensaje nuevo del cliente empuja
 * ese instante hacia adelante (eso es el debounce) mediante un `ON CONFLICT`
 * sobre el índice único parcial de abajo; el worker toma lo que ya venció.
 *
 * Un trabajo terminado se BORRA: lo que queda aquí es lo pendiente y lo que
 * fracasó de verdad, así la tabla no crece sin límite.
 */
export const agentJob = pgTable(
  "agent_job",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pendiente", "corriendo", "fallido"] })
      .notNull()
      .default("pendiente"),
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
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    /**
     * Como mucho UN trabajo pendiente por conversación — es la coalescencia
     * que antes hacía `clearTimeout`. Parcial a propósito: mientras uno está
     * `corriendo`, se admite crear el siguiente `pendiente` (equivale al
     * `pending: true` del código viejo), y así los mensajes que llegan a
     * mitad de turno se atienden juntos en el turno siguiente.
     */
    uniqueIndex("agent_job_conv_pendiente_uq")
      .on(t.conversationId)
      .where(sql`status = 'pendiente'`),
    index("agent_job_listos_idx").on(t.status, t.runAt),
    index("agent_job_org_idx").on(t.organizationId),
  ]
);

/**
 * Ventana deslizante del rate-limit, en la base y no en memoria.
 *
 * El `Map` de `globalThis` que había en `lib/rate-limit.ts` se multiplicaba
 * por réplica: con tres procesos, "10 intentos por IP" se convertía en 30 —
 * el límite se relajaba justo cuando más tráfico había.
 */
export const rateLimitHit = pgTable(
  "rate_limit_hit",
  {
    id: text("id").primaryKey(),
    /** Clave del cubo: `${ruta}:${ip}`. */
    key: text("key").notNull(),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [index("rate_limit_key_at_idx").on(t.key, t.at)]
);

/**
 * Fotos y documentos que el agente puede ENVIAR: la de un producto, la
 * carta, el local — o, desde el 18-ago-2026, un catálogo en PDF cuando "una
 * foto" no alcanza porque son varias páginas de diseños. `mimeType` decide
 * cómo se entrega (imagen o documento de WhatsApp); nadie declara la
 * diferencia al subir el archivo, la tabla no distingue las dos cosas más
 * que por su tipo real.
 *
 * **Por qué en la base y no en disco**: el contenedor del CRM no tiene ningún
 * volumen montado, así que todo lo que escriba dentro se borra en cada
 * despliegue. Guardarlas aquí las hace sobrevivir y, sobre todo, **las mete en
 * el respaldo de cada 6 h sin tocar nada** — a diferencia de un disco, que
 * habría que respaldar aparte y nadie se acordaría hasta perderlo.
 *
 * Los `bytes` van en base64 y no en `bytea` porque es lo que hay que mandarle a
 * WhatsApp y al modelo de visión: guardarlo ya en ese formato evita convertir
 * en cada envío.
 *
 * **Escala**: una foto optimizada pesa ~200 KB; un salón con 46 servicios son
 * ~9 MB, y la base entera pesa 16 MB. Un catálogo en PDF bien comprimido (10
 * páginas de fotos, re-renderizadas a ~130 DPI) pesa ~1,5 MB — nada que ver
 * con los 30-40 MB que pesa el original sin comprimir de una cámara de
 * teléfono. Con 100 clientes habría que mudarlas a un almacenamiento
 * externo, pero la interfaz (`/api/media/[id]`) no cambiaría.
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Para qué sirve:
     * `producto` — se manda cuando preguntan por ese artículo concreto.
     * `carta`    — el menú/catálogo completo, para quien pide verlo todo.
     * `otro`     — el local, el equipo, lo que el negocio quiera.
     */
    kind: text("kind", { enum: ["producto", "carta", "otro"] }).notNull(),
    /**
     * Con qué se relaciona, en palabras del negocio ("Volumen Ruso",
     * "catálogo de diseños"). Es lo que el agente compara para decidir qué
     * mandar, así que se guarda tal como el cliente nombra sus cosas.
     */
    etiqueta: text("etiqueta").notNull(),
    /**
     * Cómo se le entrega al cliente. Es lo ÚNICO que el núcleo sabe de la
     * forma de un recurso — no sabe si detrás hay un menú, un catálogo, un
     * tarifario o una guía:
     *
     * `archivo` — se manda el archivo (imagen o documento, según `mimeType`).
     * `enlace`  — se manda `url` como texto: el cliente abre y no descarga.
     * `ambos`   — el archivo y, con él, el enlace a la versión completa.
     *
     * Por defecto `archivo`: los recursos que ya existían se comportan
     * exactamente igual y ningún negocio nota que esta columna apareció.
     */
    entrega: text("entrega", { enum: ["archivo", "enlace", "ambos"] })
      .notNull()
      .default("archivo"),
    /**
     * El enlace externo, cuando `entrega` es `enlace` o `ambos`.
     *
     * ⚠️ Un enlace vive fuera del CRM: si quien lo publicó lo mueve, lo borra
     * o le quita el permiso público, **deja de funcionar y el CRM no se
     * entera** — no hay forma de comprobarlo desde aquí. Un recurso guardado
     * como archivo no tiene ese problema. Ver docs/korexia/47-FOTOS-DEL-AGENTE.md.
     */
    url: text("url"),
    /**
     * Decide cómo se entrega el ARCHIVO: `image/*` como foto,
     * `application/pdf` como documento. Nulo en un recurso que solo es enlace.
     */
    mimeType: text("mime_type"),
    /** El archivo en base64, sin el prefijo `data:`. Nulo si solo es enlace. */
    datos: text("datos"),
    /** Bytes reales del archivo, para poder medir sin descodificar. */
    tamano: integer("tamano"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_org_idx").on(t.organizationId),
    // Un negocio no debe tener dos fotos para lo mismo: subir otra reemplaza.
    uniqueIndex("media_org_etiqueta_uq").on(t.organizationId, t.etiqueta),
  ]
);

/**
 * El estado del pedido, mantenido por el BACKEND — Fase 2.
 *
 * **1:1 con la conversación y se reemplaza entero en cada turno.** Sin deltas
 * ni merges: elimina una familia completa de bugs y es seguro porque la cola
 * garantiza un turno por conversación a la vez (34-COLA-DE-TURNOS.md).
 *
 * El modelo PROPONE este objeto; el backend lo valida contra el catálogo de esa
 * organización y **recalcula el total él mismo** antes de guardarlo. Lo que se
 * persiste aquí ya pasó por `normalizarPedido`.
 */
export const conversationState = pgTable("conversation_state", {
  conversationId: text("conversation_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  estado: jsonb("estado").notNull(),
  /** Para poder cambiar la forma del JSON sin adivinar cuál es cuál. */
  schemaVersion: integer("schema_version").notNull().default(1),
  /** Dónde se quedó. Existe para que "dónde se cae la gente" sea un GROUP BY. */
  paso: text("paso"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
