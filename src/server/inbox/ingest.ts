import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByPhoneNumberId,
  getYcloudApiKey,
} from "@/server/whatsapp/credentials";
import { describirImagen, transcribirAudio } from "@/server/ai/transcribir";
import type { WebhookValue } from "@/server/inbox/webhook";
import { applyStatusUpdate } from "@/server/inbox/status";
import {
  avanzarLeadSilencioso,
  cerrarLeadPorComprobante,
  esComprobanteDePago,
  onLeadActivity,
  reactivarLeadSilencioso,
} from "@/server/inbox/lead-activity";
import {
  clearHandoff,
  isReturnToAgentPhrase,
  markHumanTookOver,
  resumeReason,
} from "@/server/inbox/handoff-policy";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { resumirTexto } from "@/server/registro-de-cambios";

/** Tipos de contenido soportados; el resto se ignora sin error. */
const SUPPORTED_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
]);

/**
 * Un contacto SIEMPRE se identifica por uno de los dos, nunca por ninguno.
 * `waUserId` cubre a quien usa nombre de usuario de WhatsApp (sin teléfono
 * expuesto al negocio — función de Meta lanzada en 2026, verificada en vivo
 * el 2-ago-2026 cuando dos clientes reales llegaron así, en Lis y en La
 * Churra, y sus mensajes se perdían sin dejar rastro).
 */
export type ContactIdentifier = { phone: string | null; waUserId: string | null };

/**
 * Busca por CUALQUIERA de las dos señales, no por una elegida de antemano: es
 * lo que evita que la misma persona nazca dos veces cuando Meta cambia de
 * señal a mitad de camino. Devuelve los candidatos del más antiguo al más
 * nuevo — el más viejo es el que tiene el historial.
 */
async function buscarPorIdentidad(
  organizationId: string,
  { phone, waUserId }: ContactIdentifier
) {
  const señales = [
    phone ? eq(schema.contact.phone, phone) : null,
    waUserId ? eq(schema.contact.waUserId, waUserId) : null,
  ].filter((s) => s !== null);

  return getDb()
    .select()
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, organizationId), or(...señales)))
    .orderBy(schema.contact.createdAt);
}

/**
 * Un contacto se identifica por su teléfono, por su BSUID, o por los dos.
 *
 * **Lo normal es que lleguen los dos** (98 de 99 eventos reales, medido el
 * 5-ago-2026): antes se guardaba solo el teléfono y se tiraba el BSUID, así
 * que el día que Meta dejara de mandar `from` para un cliente conocido —la
 * dirección declarada de su migración— ese cliente habría entrado como
 * contacto y conversación NUEVOS, con el historial partido y el agente
 * saludándolo como a un desconocido.
 *
 * Ahora se guardan ambas y **la que llegue tarde se rellena sobre el contacto
 * que ya existía**, que es el caso real de Nathalia y Marii (guardadas solo
 * por BSUID, sin teléfono, antes de este arreglo).
 */
export async function getOrCreateContact(
  organizationId: string,
  identifier: ContactIdentifier,
  name?: string | null
) {
  const { phone, waUserId } = identifier;
  if (!phone && !waUserId) {
    throw new Error("getOrCreateContact: hace falta phone o waUserId");
  }
  const db = getDb();

  const candidatos = await buscarPorIdentidad(organizationId, identifier);
  if (candidatos.length > 0) {
    const existing = candidatos[0]!;
    /**
     * Dos contactos distintos, uno por cada señal: son la misma persona, pero
     * fusionarlos en caliente implica mover mensajes, conversaciones, leads y
     * citas — demasiado para hacerlo solo y sin que nadie mire. Se usa el más
     * antiguo (el del historial) y se deja el aviso para resolverlo a mano.
     * No debería ocurrir con este arreglo puesto: es defensa por si ya había
     * duplicados de antes.
     */
    if (candidatos.length > 1) {
      /*
       * Los ids bastan para encontrarlos en el panel y fusionarlos; el teléfono
       * y el BSUID iban en claro y son de la persona duplicada. En huella se
       * conserva lo que de verdad se mira aquí: **si los dos candidatos traen
       * el mismo número o distinto** — misma huella, mismo dato.
       */
      console.warn(
        `[contacto] MISMA PERSONA EN DOS CONTACTOS de ${organizationId}: ` +
          candidatos
            .map(
              (c) =>
                `${c.id} (tel=${c.phone ? resumirTexto(c.phone) : "-"}, ` +
                `bsuid=${c.waUserId ? resumirTexto(c.waUserId) : "-"})`
            )
            .join(" | ") +
          ` — se usa ${existing.id}; fusionar a mano`
      );
    }

    /*
     * La señal que faltaba: se rellena sin pisar nunca una ya guardada — y
     * SIN escribir un valor que ya sea de OTRO candidato (24-ago-2026).
     *
     * Hasta ahora esto solo comprobaba `!existing.phone`/`!existing.waUserId`
     * y lanzaba un UPDATE a ciegas. Cuando `candidatos.length > 1` —el "misma
     * persona en dos contactos" de arriba— la señal que faltaba en `existing`
     * casi siempre YA estaba en el otro candidato, y el UPDATE chocaba contra
     * el índice único de la base sin que nada lo capturara: el webhook
     * ENTERO fallaba y el mensaje del cliente no quedaba ni registrado.
     *
     * Medido en Lis Pastelería: 87 eventos así en 18 días (6 al 24-ago),
     * 44 de ellos mensajes reales de clientas — no ecos — perdidos sin dejar
     * una fila (docs/korexia/126). `buscarPorIdentidad` ya trae TODOS los
     * candidatos que comparten cualquiera de las dos señales, así que basta
     * con no ofrecer como "faltante" nada que otro candidato ya tenga.
     */
    const yaEsDeOtroContacto = (valor: string, campo: "phone" | "waUserId") =>
      candidatos.some((c) => c.id !== existing.id && c[campo] === valor);

    const faltantes: Partial<typeof schema.contact.$inferInsert> = {};
    if (phone && !existing.phone && !yaEsDeOtroContacto(phone, "phone")) {
      faltantes.phone = phone;
    }
    if (waUserId && !existing.waUserId && !yaEsDeOtroContacto(waUserId, "waUserId")) {
      faltantes.waUserId = waUserId;
    }
    // Reactivar si estaba archivado (el nombre editado por el operador se respeta).
    const reactivar = existing.archivedAt !== null;

    if (Object.keys(faltantes).length > 0 || reactivar) {
      const [actualizado] = await db
        .update(schema.contact)
        .set({
          ...faltantes,
          ...(reactivar ? { archivedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.contact.id, existing.id))
        .returning();
      if (actualizado) return { contact: actualizado, isNew: false };
    }
    return { contact: existing, isNew: false };
  }

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      waUserId,
      name: name?.trim() || phone || waUserId!,
    })
    // Cubre los dos índices únicos (teléfono y BSUID) sin nombrar ninguno: si
    // otro webhook simultáneo se adelantó, se resuelve leyendo abajo.
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  const [carrera] = await buscarPorIdentidad(organizationId, identifier);
  if (!carrera) throw new Error("contacto no encontrado tras upsert");
  return { contact: carrera, isNew: false };
}

export async function getOrCreateConversation(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const inserted = await db
    .insert(schema.conversation)
    .values({ id: newId("conversation"), organizationId, contactId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const rows = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("conversación no encontrada tras upsert");
  return existing;
}

/**
 * Procesa el `value` de un cambio `messages` del webhook: mensajes entrantes
 * (idempotentes por wa_message_id) y actualizaciones de estado.
 */
export async function processMessagesValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    // Caso típico: webhook/override configurado ANTES de guardar la conexión
    // en el wizard — el evento llega pero no hay a qué organización enrutarlo.
    console.warn(
      `[webhook] evento para phone_number_id desconocido (${phoneNumberId}): ` +
        "guarda la conexión en Configuración → WhatsApp para recibir mensajes"
    );
    return;
  }

  const organizationId = credentials.organizationId;

  for (const status of value.statuses ?? []) {
    await applyStatusUpdate(organizationId, status);
  }

  for (const msg of value.messages ?? []) {
    if (!SUPPORTED_TYPES.has(msg.type)) continue; // reacciones, etc.: ignorar
    if (!msg.from) {
      // Meta-directo no propaga hoy un identificador alternativo (waUserId)
      // como sí hace YCloud: sin `from` no hay dónde guardar el mensaje.
      // Se descarta con aviso, nunca con una excepción sin capturar.
      console.warn(
        `[webhook] MENSAJE DESCARTADO: falta "from" (id=${msg.id}, type=${msg.type})`
      );
      continue;
    }
    const profileName = value.contacts?.find(
      (c) => c.wa_id === msg.from
    )?.profile?.name;
    await ingestInboundMessage({
      organizationId,
      from: msg.from,
      profileName: profileName ?? null,
      waMessageId: msg.id,
      type: msg.type,
      text: msg.text?.body ?? null,
      timestamp: msg.timestamp,
    });
  }
}

export async function ingestInboundMessage(
  input: {
    organizationId: string;
    /** Uno de los dos siempre está presente (ver `ContactIdentifier`). */
    from: string | null;
    waUserId?: string | null;
    profileName: string | null;
    waMessageId: string;
    type: string;
    text: string | null;
    timestamp: string;
    mediaUrl?: string | null;
    mediaId?: string | null;
    mimeType?: string | null;
    /** wamid del mensaje del chat que el cliente citó, si citó alguno. */
    replyToWamid?: string | null;
    /** Responde a un Estado del negocio: no se sabe qué vio. */
    respondeAEstado?: boolean;
  },
  opts?: { triggerAgent?: boolean }
): Promise<void> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await getOrCreateContact(
    organizationId,
    { phone: input.from, waUserId: input.waUserId ?? null },
    input.profileName
  );
  const conversation = await getOrCreateConversation(
    organizationId,
    contact.id
  );

  // El momento del mensaje ANTERIOR: con él se sabe si el cliente vuelve tras
  // un silencio largo (y el agente puede retomar) o si el equipo está
  // atendiendo ahora mismo (y no hay que interrumpirlo).
  const previousMessageAt = conversation.lastMessageAt;

  const waTimestamp = toDate(input.timestamp);

  /*
   * Audio e imagen se convierten a texto ANTES de guardarlos, para que el texto
   * viaje dentro del propio mensaje. A partir de ahí todo lo demás funciona sin
   * enterarse de que no era texto: el agente lo lee como si se lo hubieran
   * escrito, quien atienda a mano lo ve en la bandeja sin abrir el adjunto, y
   * entra en el aprendizaje y en los respaldos.
   */
  const texto = await mediaATexto(input, organizationId);
  const textoPlano = textoDeMensaje(texto, input.mediaUrl, input.type);
  const textoFinal = conContextoDeRespuesta(textoPlano, {
    citado: input.replyToWamid
      ? await textoCitado(organizationId, input.replyToWamid)
      : null,
    respondeAEstado: input.respondeAEstado,
  });

  // Idempotencia dura: mismo wa_message_id → sin efectos adicionales.
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.waMessageId,
      direction: "in",
      type: input.type,
      text: textoFinal,
      status: "delivered",
      mediaUrl: input.mediaUrl ?? null,
      mediaId: input.mediaId ?? null,
      mimeType: input.mimeType ?? null,
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  const message = inserted[0];
  if (!message) return; // duplicado

  await db
    .update(schema.conversation)
    .set({
      lastInboundAt: waTimestamp,
      lastMessageAt: waTimestamp,
      unreadCount: sql`${schema.conversation.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conversation.id));

  await onLeadActivity(organizationId, contact.id, waTimestamp);

  // Volvió a escribir: si se había enfriado, su tarjeta sube de nuevo a la
  // conversación. Va antes que el comprobante para no pisar un cierre.
  await reactivarLeadSilencioso(organizationId, contact.id);

  // Un comprobante cierra el lead aunque el agente no intervenga: en los
  // negocios que atienden a mano, era la venta que el tablero nunca veía.
  if (esComprobanteDePago(textoFinal, input.type)) {
    await cerrarLeadPorComprobante(organizationId, contact.id);
  }

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  // Modo observación: se ingiere y publica el mensaje, pero NO responde el agente.
  if (opts?.triggerAgent === false) return;

  /**
   * Sin texto real ni adjunto (reacciones/respuestas a un Estado, ediciones
   * de WhatsApp, tipos no soportados): el mensaje queda guardado y visible en
   * el hilo con su marcador (arriba), pero NO dispara al agente. Pasárselo
   * como si el cliente lo hubiera escrito lo confunde — caso real: el modelo
   * ejecutó `handoff` sin sentido al ver "[mensaje no compatible: tipo
   * edit...]" en Lis Pastelería (3-ago-2026), y como Lis no tiene número de
   * aviso, la clienta quedó esperando sin que nadie se enterara.
   */
  if (!texto && !input.mediaUrl) return;

  // Conversación en manos de una persona: el agente solo vuelve si el cliente
  // lo pide con "0" o si nadie contestó en horas. Si no, silencio: dos voces
  // respondiendo a la vez es peor que una respuesta lenta.
  if (conversation.handoffAt) {
    const reason = resumeReason({
      handoffAt: conversation.handoffAt,
      text: input.text,
      lastMessageAt: previousMessageAt,
    });
    if (!reason) return;
    await clearHandoff(conversation.id, organizationId);
    console.info(
      `[agente] retoma la conversación ${conversation.id} por ${reason}`
    );
  }

  // Sin mensajes previos = el cliente acaba de saludar: se le responde sin la
  // espera de agrupación, que ahí solo se siente como demora.
  await maybeRunAgentTurn(conversation.id, {
    immediate: previousMessageAt === null,
  });
}

/**
 * Marcador de texto para lo que llega sin texto NI adjunto — típico de un
 * `type: "unsupported"` (reaccionar o responder a un Estado a veces llega
 * así, verificado en vivo el 1-ago-2026). El mensaje SIEMPRE se guarda, pero
 * `toChatHistory` descarta cualquier fila sin texto al armar lo que ve el
 * agente: sin este marcador, quedaba invisible para la IA aunque el cliente
 * sí hubiera escrito algo. Con adjunto pero sin texto (imagen/audio cuya
 * conversión falló) se deja el `null` tal cual — comportamiento existente,
 * no se toca aquí.
 */
export function textoDeMensaje(
  texto: string | null,
  mediaUrl: string | null | undefined,
  type: string
): string | null {
  if (texto) return texto;
  if (mediaUrl) return null;
  return `[mensaje no compatible: tipo "${type}", revisa WhatsApp directamente]`;
}

/**
 * El texto del mensaje que el cliente citó. Null si no lo tenemos guardado
 * (una foto sin pie, o algo anterior a que este negocio entrara al CRM).
 */
async function textoCitado(
  organizationId: string,
  wamid: string
): Promise<string | null> {
  try {
    const filas = await getDb()
      .select({ text: schema.message.text })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.organizationId, organizationId),
          eq(schema.message.waMessageId, wamid)
        )
      )
      .limit(1);
    return filas[0]?.text ?? null;
  } catch (err) {
    console.error("[ingesta] no se pudo leer el mensaje citado:", err);
    return null;
  }
}

/** Recorta la cita para que no se coma el contexto del agente. */
const LARGO_CITA = 160;

/**
 * Antepone al mensaje a QUÉ está respondiendo el cliente (9-ago-2026).
 *
 * Sigue el mismo patrón que las transcripciones de audio e imagen: el dato
 * viaja dentro del propio texto, con una marca entre corchetes. Así lo ve el
 * agente, lo ve quien atiende desde la bandeja, y entra en el aprendizaje y los
 * respaldos sin tocar el esquema.
 *
 * Los dos casos son distintos a propósito:
 *
 * - **Citó un mensaje** → se le da el texto citado. Es lo más frecuente (40 de
 *   489 entrantes medidos) y hasta ahora el agente respondía a ciegas a cosas
 *   como "¿y este cuánto vale?".
 * - **Respondió a un Estado** → NO se puede saber qué vio: el contenido de la
 *   historia no llega en el webhook. Se marca como tal para que el agente
 *   **no lo adivine**, que es justo lo que hacía: a "Qué es eso tan ricón?" le
 *   contestó "te refieres a los cremosos, ¿verdad?" cuando la historia era de
 *   un latte frío.
 */
export function conContextoDeRespuesta(
  texto: string | null,
  contexto: { citado?: string | null; respondeAEstado?: boolean }
): string | null {
  if (contexto.citado) {
    const cita = contexto.citado.replace(/\s+/g, " ").trim().slice(0, LARGO_CITA);
    const puntos = contexto.citado.trim().length > LARGO_CITA ? "…" : "";
    return `[RESPONDE A ESTE MENSAJE TUYO: "${cita}${puntos}"]\n${texto ?? ""}`.trim();
  }
  if (contexto.respondeAEstado) {
    return `[RESPONDE A UNA PUBLICACIÓN DEL NEGOCIO — no sabes qué contenía]\n${texto ?? ""}`.trim();
  }
  return texto;
}

/**
 * Convierte a texto lo que no vino escrito. Devuelve el texto original si no
 * hay nada que convertir o si el proveedor falla — nunca lanza.
 *
 * Las dos ramas se tratan distinto a propósito:
 *
 * - **Audio**: solo si el mensaje no trae ya texto. Una nota de voz no lleva
 *   pie, pero si algún día lo llevara sería lo que escribió la persona, y eso
 *   manda sobre cualquier transcripción.
 *
 * - **Imagen**: siempre, y el pie se CONSERVA delante. El caso normal es el
 *   comprobante de pago con un "listo" encima: quedarse con el pie sería
 *   quedarse justo sin lo que hay que mirar.
 */
async function mediaATexto(
  input: {
    organizationId: string;
    type: string;
    text: string | null;
    mediaUrl?: string | null;
    mimeType?: string | null;
  },
  organizationId: string,
  /** Quién lo mandó: cambia la instrucción con la que se lee la imagen. */
  deQuien: "cliente" | "negocio" = "cliente"
): Promise<string | null> {
  if (!input.mediaUrl) return input.text;
  const pie = input.text?.trim() || null;

  if (input.type === "audio" && !pie) {
    const { texto } = await transcribirAudio({
      organizationId,
      mediaUrl: input.mediaUrl,
      mimeType: input.mimeType,
      apiKey: await getYcloudApiKey(organizationId),
    });
    return texto ?? input.text;
  }

  if (input.type === "image") {
    const { texto } = await describirImagen({
      organizationId,
      mediaUrl: input.mediaUrl,
      mimeType: input.mimeType,
      apiKey: await getYcloudApiKey(organizationId),
      deQuien,
    });
    if (!texto) return input.text;
    return pie ? `${pie}\n${texto}` : texto;
  }

  return input.text;
}

/**
 * Registra un mensaje que el negocio envió desde su CELULAR (coexistencia) y
 * cede el turno: si una persona está respondiendo por su cuenta, el agente
 * calla — si no, los dos le escriben al mismo cliente a la vez.
 *
 * Idempotente por `wa_message_id`: un eco repetido no vuelve a tocar el turno.
 */
export async function ingestOutboundEcho(input: {
  organizationId: string;
  /** Uno de los dos siempre está presente (ver `ContactIdentifier`). */
  toPhone: string | null;
  toWaUserId?: string | null;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
  mediaUrl?: string | null;
  mediaId?: string | null;
  mimeType?: string | null;
}): Promise<void> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await getOrCreateContact(organizationId, {
    phone: input.toPhone,
    waUserId: input.toWaUserId ?? null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id);
  const waTimestamp = toDate(input.timestamp);

  /**
   * El audio y las fotos que manda el NEGOCIO desde su celular también se
   * convierten a texto, igual que los del cliente.
   *
   * Sin esto, el agente no se entera de que existieron: `toChatHistory`
   * descarta las filas sin texto. Si Lis resuelve por nota de voz "el
   * domicilio son 8.000" y devuelve el turno, el agente retomaba sin saberlo
   * y podía decir otra cosa. Con el comando de retorno disparando el turno
   * (abajo), esto pasó de incómodo a necesario.
   */
  const texto = await mediaATexto(
    { ...input, organizationId },
    organizationId,
    "negocio"
  );

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.waMessageId,
      direction: "out",
      type: input.type,
      text: texto,
      // Ya salió por WhatsApp: nació entregado, no "pendiente".
      status: "sent",
      aiGenerated: false,
      mediaUrl: input.mediaUrl ?? null,
      mediaId: input.mediaId ?? null,
      mimeType: input.mimeType ?? null,
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  const message = inserted[0];
  if (!message) return; // eco duplicado: ya estaba registrado

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: waTimestamp, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  publish(organizationId, {
    type: "message.new",
    data: { conversationId: conversation.id, message: serializeMessage(message) },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  // Contestar desde el celular también arranca la conversación en el embudo.
  // Aislado: el eco ya quedó registrado y el relevo humano de abajo es lo que
  // de verdad importa de este webhook.
  await avanzarLeadSilencioso(organizationId, contact.id);

  // Mismo trato que si hubiera escrito desde la bandeja: toma la conversación,
  // salvo que esté devolviéndole el turno al agente.
  if (isReturnToAgentPhrase(texto)) {
    await clearHandoff(conversation.id, organizationId);
    /**
     * Y sigue la conversación en el acto, sin esperar a que el cliente vuelva
     * a escribir. Antes el comando solo quitaba el relevo: el agente quedaba
     * despierto pero mudo, y quien había pedido algo se quedaba esperando.
     *
     * Caso real (Lis, 6-ago-2026): la clienta escribió "Cremoso de 7 Oz" a
     * las 18:16:43, Lis devolvió el turno a las 18:18:30 y el agente **no
     * dijo nada durante 5 minutos**, hasta que la clienta escribió "Gracias"
     * a las 18:21 — solo entonces soltó la respuesta que ya tenía lista. El
     * día anterior, con otra clienta, Lis tuvo que escribir la respuesta a
     * mano y repetir el comando.
     *
     * Si no hay nada pendiente del cliente, `runAgentTurn` lo detecta y se
     * omite solo (`entrantesSinResponder`): no suelta un mensaje de la nada.
     */
    await maybeRunAgentTurn(conversation.id, { immediate: true });
  } else {
    await markHumanTookOver(conversation.id, organizationId);
  }
}

function toDate(timestamp: string): Date {
  const n = Number(timestamp);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

export function serializeMessage(m: typeof schema.message.$inferSelect) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    status: m.status,
    aiGenerated: m.aiGenerated,
    // El enlace del proveedor NO viaja al navegador: se sirve por /api/media.
    hasMedia: Boolean(m.mediaUrl),
    mimeType: m.mimeType,
    createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
  };
}

/**
 * Un mensaje del HISTORIAL que sincroniza la coexistencia.
 *
 * Se guarda y nada más. Es deliberado y es lo que hace que esta función exista
 * aparte en vez de reusar las otras dos:
 *
 * - **No dispara al agente.** Son conversaciones de hace semanas o meses; si
 *   entraran por el camino normal, el agente contestaría a decenas de clientas
 *   a la vez sobre pedidos que ya se resolvieron.
 * - **No toca `lastInboundAt`.** Esa marca decide la ventana de 24 h de
 *   WhatsApp: rellenarla con fechas viejas no abre ninguna ventana, pero
 *   pisarla con una vieja sí puede cerrar la de una conversación viva.
 * - **No marca relevo humano** ni mueve el embudo: que el negocio respondiera
 *   en mayo no significa que hoy esté atendiendo a mano esa conversación.
 * - **No transcribe audios ni fotos.** Serían cientos de llamadas al modelo por
 *   material viejo, y los enlaces de medios de WhatsApp caducan.
 *
 * Lo que sí hace: dejar la conversación completa en la bandeja —para que el
 * equipo tenga el contexto— y, sobre todo, ponerla a disposición del
 * aprendizaje, que es de donde sale el conocimiento del negocio.
 */
export async function ingestHistoryMessage(input: {
  organizationId: string;
  direction: "in" | "out";
  customerPhone: string | null;
  customerWaUserId?: string | null;
  profileName?: string | null;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
}): Promise<{ guardado: boolean }> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await getOrCreateContact(organizationId, {
    phone: input.customerPhone,
    waUserId: input.customerWaUserId ?? null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id);
  const waTimestamp = toDate(input.timestamp);

  /*
   * El nombre del perfil solo se rellena si el contacto no tenía: el historial
   * trae el nombre de entonces, y pisar el actual con uno de hace seis meses
   * sería cambiar hacia atrás lo que el equipo ya ve bien.
   */
  if (input.profileName && !contact.name) {
    await db
      .update(schema.contact)
      .set({ name: input.profileName })
      .where(eq(schema.contact.id, contact.id));
  }

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.waMessageId,
      direction: input.direction,
      type: input.type,
      text: input.text,
      status: input.direction === "out" ? "sent" : "delivered",
      // Lo escribió una PERSONA del negocio desde su celular, no el agente.
      // Importa para el aprendizaje: lo que contestó un humano es justo donde
      // el conocimiento tiene un hueco.
      aiGenerated: input.direction === "out" ? false : undefined,
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();

  if (!inserted[0]) return { guardado: false }; // ya estaba: la sincronización repite

  /*
   * `lastMessageAt` sí se pone al día, pero solo hacia atrás: es lo que ordena
   * la bandeja. Si la conversación ya tiene actividad más reciente, se respeta.
   */
  await db
    .update(schema.conversation)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, conversation.id),
        isNull(schema.conversation.lastMessageAt)
      )
    );

  return { guardado: true };
}
