import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, resolveRecipient } from "@/lib/meta/client";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { getCredentialsByOrg, getCredentialsByWabaId } from "@/server/whatsapp/credentials";
import { translateMetaError } from "@/server/whatsapp/meta-errors";
import { callGraphSend, SendError, ycloudApiKeyOf } from "@/server/inbox/send";
import { isYcloudEnabled, YcloudHttpError, ycloudSendTemplate } from "@/lib/ycloud/client";
import { serializeMessage } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";

/** Errores tipados del servicio de plantillas → HTTP en la capa de API. */
export class TemplateError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "invalid"
    | "not_found"
    | "meta_error"
    | "meta_unavailable";

  constructor(code: TemplateError["code"], message: string) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
  }
}

const TEMPLATE_ERROR_STATUS: Record<TemplateError["code"], number> = {
  not_connected: 409,
  reconnect_required: 409,
  invalid: 422,
  not_found: 404,
  meta_error: 422,
  meta_unavailable: 503,
};

export function templateErrorStatus(err: TemplateError): number {
  return TEMPLATE_ERROR_STATUS[err.code];
}

/**
 * Resuelve el WABA ID correcto para llamar a Meta Graph API.
 *
 * - Cuentas de agencia o Meta directo: `creds.wabaId` ya es un WABA real →
 *   se usa tal cual.
 * - Cuentas propias de YCloud: `creds.wabaId` es sintético (`ycloud:<numero>`)
 *   y Meta no lo reconoce. Se necesita `creds.metaWabaId` (capturado
 *   automáticamente del primer mensaje entrante por `ycloud-events.ts`).
 *   Si todavía es NULL, falla con un error claro y accionable.
 *
 * Ver doc 131-WABA-ID-CAPTURADO-Y-USADO-EN-PLANTILLAS.
 */
export function resolveWabaId(creds: { wabaId: string; metaWabaId: string | null }): string {
  if (!creds.wabaId.startsWith("ycloud:")) return creds.wabaId;
  if (creds.metaWabaId) return creds.metaWabaId;
  throw new TemplateError(
    "not_connected",
    "El WABA ID real de Meta no está disponible aún para este cliente. " +
      "Se captura automáticamente del primer mensaje que reciba el número " +
      "a través del webhook de YCloud. Verifica que el webhook esté " +
      "configurado y que el número haya recibido al menos un mensaje desde " +
      "que se dio de alta. Si el problema persiste, revisa la tabla " +
      "meta_credentials (columna meta_waba_id) para confirmar que se pobló."
  );
}

const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

/** Cuenta variables {{n}} y valida el acotamiento v1: máximo UNA y debe ser {{1}}. */
export function countVariables(body: string): number {
  const matches = [...body.matchAll(VARIABLE_REGEX)];
  return matches.length;
}

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

export function renderBody(body: string, variable?: string): string {
  // Función, no string: si el valor trae "$1" o "$&" (p. ej. "$1,000 de
  // descuento"), un string de reemplazo los interpretaría como referencias
  // de grupo de captura y corrompería el texto guardado/mostrado en el CRM.
  const value = variable ?? "";
  return body.replace(VARIABLE_REGEX, () => value);
}

type TemplateRow = typeof schema.template.$inferSelect;

export function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    rejectionReason: t.rejectionReason,
  };
}

/** Crea la plantilla y la manda a aprobación de Meta (FR-050). */
export async function createTemplate(
  organizationId: string,
  input: { name: string; language: string; category: string; body: string }
): Promise<TemplateRow> {
  const variableError = validateBodyVariables(input.body);
  if (variableError) throw new TemplateError("invalid", variableError);

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta tu número antes de crear plantillas");
  }

  const name = input.name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

  const wabaId = resolveWabaId(creds);
  const hasVariable = countVariables(input.body) === 1;
  let waTemplateId: string | null = null;
  try {
    const res = await graphRequest<{ id?: string; status?: string }>(
      `${wabaId}/message_templates`,
      {
        method: "POST",
        token: creds.token,
        body: {
          name,
          language: input.language,
          category: input.category,
          components: [
            {
              type: "BODY",
              text: input.body,
              ...(hasVariable
                ? { example: { body_text: [["ejemplo"]] } }
                : {}),
            },
          ],
        },
      }
    );
    waTemplateId = res.id ?? null;
  } catch (err) {
    throw await translateMetaError(
      err,
      organizationId,
      (code, message) => new TemplateError(code, message)
    );
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.template)
    .values({
      id: newId("template"),
      organizationId,
      name,
      language: input.language,
      category: input.category,
      body: input.body,
      status: "pending",
      waTemplateId,
    })
    .onConflictDoUpdate({
      target: [
        schema.template.organizationId,
        schema.template.name,
        schema.template.language,
      ],
      set: {
        category: input.category,
        body: input.body,
        status: "pending",
        rejectionReason: null,
        waTemplateId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted[0]!;
}

function mapMetaStatus(
  status: string | undefined
): TemplateRow["status"] | null {
  const s = (status ?? "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "PENDING" || s === "IN_APPEAL" || s === "PENDING_DELETION") {
    return "pending";
  }
  return null;
}

/**
 * Sincroniza estados desde Graph (`GET {waba}/message_templates`). Cubre el
 * modo agencia: los webhooks de plantillas NO siguen el override de callback,
 * así que el pull es la vía universal (DV-VC-04/DV-VC-15).
 */
export async function syncTemplates(organizationId: string): Promise<number> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }

  const wabaId = resolveWabaId(creds);
  let data: {
    data?: { id?: string; name?: string; language?: string; status?: string; quality_score?: unknown; rejected_reason?: string }[];
  };
  try {
    data = await graphRequest(`${wabaId}/message_templates`, {
      token: creds.token,
    });
  } catch (err) {
    throw await translateMetaError(
      err,
      organizationId,
      (code, message) => new TemplateError(code, message)
    );
  }

  const db = getDb();
  const local = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));

  let updated = 0;
  for (const remote of data.data ?? []) {
    const status = mapMetaStatus(remote.status);
    if (!status) continue;
    const match = local.find(
      (t) =>
        (remote.id && t.waTemplateId === remote.id) ||
        (t.name === remote.name && t.language === remote.language)
    );
    if (!match || match.status === status) continue;
    await db
      .update(schema.template)
      .set({
        status,
        rejectionReason: remote.rejected_reason ?? null,
        waTemplateId: match.waTemplateId ?? remote.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.template.id, match.id));
    updated += 1;
  }
  return updated;
}

/** Evento webhook `message_template_status_update` (modo directo, FR-050). */
export async function applyTemplateStatusEvent(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  if (!wabaId) return;
  const creds = await getCredentialsByWabaId(wabaId);
  if (!creds) return;

  const status = mapMetaStatus(value.event);
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (!status || !name || !language) return;

  const db = getDb();
  await db
    .update(schema.template)
    .set({
      status,
      rejectionReason: status === "rejected" ? (value.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.template.organizationId, creds.organizationId),
        eq(schema.template.name, name),
        eq(schema.template.language, language)
      )
    );
}

/**
 * El resultado de UN intento de envío al proveedor — nunca lanzado, solo
 * devuelto (Fase 5C, auditoría de idempotencia de campañas).
 *
 * Los errores de PRECONDICIÓN (plantilla inexistente/no aprobada, variable
 * faltante, conversación inexistente, sandbox, credenciales no conectadas o
 * que requieren reconexión, contacto sin teléfono) siguen siendo excepciones
 * (`TemplateError`/`SendError`) — nunca se convierten en un
 * `ResultadoProveedor`, porque no describen "qué contestó el proveedor",
 * describen "esto no llegó a intentarse". Solo el resultado de la llamada
 * HTTP real, una vez que todas las precondiciones ya pasaron, se tipa aquí.
 *
 * `causa` conserva el error original (o `null` en éxito) — lo usa
 * `sendTemplate()` para reconstruir su comportamiento histórico exacto
 * (ver más abajo); el futuro motor de campañas puede ignorarlo, solo le
 * hace falta `kind`/`error`/`retryable`.
 */
export type ResultadoProveedor =
  | { kind: "SUCCESS"; waMessageId: string; renderedText: string }
  | { kind: "EXPLICIT_FAILURE"; error: string; retryable: boolean; causa: unknown }
  | { kind: "AMBIGUOUS_FAILURE"; error: string; causa: unknown };

/**
 * Clasifica un fallo de YCloud con la evidencia real auditada en Fase 5A/5B:
 *
 * - 429            → EXPLICIT_FAILURE, retryable=true (el servidor SÍ
 *                     respondió, con certeza de que no procesó nada — no es
 *                     lo mismo que el silencio de un timeout).
 * - >=500          → AMBIGUOUS_FAILURE (pudo empezar a procesar antes de
 *                     fallar).
 * - Cualquier otro 4xx (400/401/403/…) → EXPLICIT_FAILURE, retryable=false.
 *   YCloud no expone hoy ninguna señal de "esto fue un error de auth"
 *   distinta de un rechazo cualquiera — no se inventa esa distinción.
 * - Lo que no sea `YcloudHttpError` (el `fetch` nunca tuvo respuesta: red,
 *   DNS, timeout/AbortError) → AMBIGUOUS_FAILURE, siempre. Nunca se sabe si
 *   YCloud llegó a procesar la petición.
 */
function clasificarErrorYCloud(err: unknown): ResultadoProveedor {
  if (err instanceof YcloudHttpError) {
    if (err.status === 429) {
      return { kind: "EXPLICIT_FAILURE", error: err.message, retryable: true, causa: err };
    }
    if (err.status >= 500) {
      return { kind: "AMBIGUOUS_FAILURE", error: err.message, causa: err };
    }
    return { kind: "EXPLICIT_FAILURE", error: err.message, retryable: false, causa: err };
  }
  return {
    kind: "AMBIGUOUS_FAILURE",
    error: err instanceof Error ? err.message : String(err),
    causa: err,
  };
}

/**
 * Clasifica un fallo de Graph directo — camino actual sin tocar
 * (`callGraphSend` ya traduce cualquier `MetaApiError` a `SendError` vía
 * `translateMetaError`).
 *
 * `reconnect_required`/`sandbox_violation`/`not_connected`/`window_closed`
 * son señales de PRECONDICIÓN/configuración, no del intento de envío en sí
 * — se relanzan tal cual (nunca se convirtieron en un resultado antes de
 * esta fase, y siguen sin hacerlo).
 *
 * Límite real, no inventado: `translateMetaError` no distingue un 429 de
 * cualquier otro 4xx — ambos caen en `meta_error`. Sin esa evidencia, se
 * clasifica conservadoramente como no reintentable, a diferencia de YCloud
 * (que sí expone el status real). Asimetría documentada, no resuelta aquí.
 */
function clasificarErrorGraph(err: unknown): ResultadoProveedor {
  if (err instanceof SendError) {
    if (err.code === "meta_unavailable") {
      return { kind: "AMBIGUOUS_FAILURE", error: err.message, causa: err };
    }
    if (err.code === "meta_error") {
      return { kind: "EXPLICIT_FAILURE", error: err.message, retryable: false, causa: err };
    }
    throw err;
  }
  return {
    kind: "AMBIGUOUS_FAILURE",
    error: err instanceof Error ? err.message : String(err),
    causa: err,
  };
}

/**
 * Hace TODO lo que `sendTemplate()` hacía antes de tocar al proveedor, y
 * luego llama al proveedor — pero NO inserta `message`, NO publica, NO
 * actualiza `conversation`. Es la pieza que el futuro worker de campañas
 * necesita para reutilizar exactamente la misma lógica de "qué proveedor,
 * cómo arma el payload, cómo clasifica el resultado" sin duplicarla (Fase
 * 5A/5B/5C).
 *
 * `retry`/`timeoutMs` solo tienen efecto observable en la rama YCloud —
 * Graph nunca tuvo reintento interno, un solo intento siempre (ver
 * auditoría Fase 5A/5B). El contrato se mantiene uniforme igual.
 */
export async function enviarTemplateAlProveedor(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  variable?: string;
  retry?: boolean;
  timeoutMs?: number;
}): Promise<ResultadoProveedor> {
  const db = getDb();

  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        input.organizationId,
        eq(schema.template.id, input.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada");
  if (template.status !== "approved") {
    throw new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas");
  }
  const needsVariable = countVariables(template.body) === 1;
  if (needsVariable && !input.variable?.trim()) {
    throw new TemplateError("invalid", "La plantilla requiere el valor de {{1}}");
  }

  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TemplateError("not_found", "Conversación no encontrada");
  if (row.conversation.isTest) {
    // Aserción dura del sandbox (FR-031)
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) throw new TemplateError("not_connected", "Sin número conectado");
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta el número");
  }

  const to = resolveRecipient(row.contact);
  if (!to) {
    throw new TemplateError("not_found", "El contacto no tiene teléfono ni identificador de WhatsApp");
  }

  /**
   * Igual que `sendText`: por YCloud si el cliente trajo su propia cuenta o
   * si la agencia tiene una configurada, por Graph directo si no. Antes esta
   * función SIEMPRE usaba Graph, así que un cliente en YCloud (La Churra,
   * Lis) no podía mandar una plantilla cuando la ventana de 24 h estaba
   * cerrada — fallaba contra Meta con credenciales que no eran suyas.
   */
  const clientApiKey = ycloudApiKeyOf(creds);
  const bodyParams = needsVariable ? [input.variable!.trim()] : [];
  const renderedText = renderBody(template.body, input.variable?.trim());

  if (clientApiKey || isYcloudEnabled()) {
    try {
      const waMessageId = await ycloudSendTemplate({
        from: creds.displayPhoneNumber ?? "",
        to,
        name: template.name,
        language: template.language,
        bodyParams,
        apiKey: clientApiKey,
        retry: input.retry,
        timeoutMs: input.timeoutMs,
      });
      return { kind: "SUCCESS", waMessageId, renderedText };
    } catch (err) {
      return clasificarErrorYCloud(err);
    }
  }

  try {
    const waMessageId = await callGraphSend(creds, {
      messaging_product: "whatsapp",
      to: to.value,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(needsVariable
          ? {
              components: [
                { type: "body", parameters: [{ type: "text", text: bodyParams[0]! }] },
              ],
            }
          : {}),
      },
    });
    return { kind: "SUCCESS", waMessageId, renderedText };
  } catch (err) {
    return clasificarErrorGraph(err);
  }
}

/**
 * Envía una plantilla APROBADA a una conversación (ventana cerrada, FR-051).
 *
 * Wrapper delgado (Fase 5C) sobre `enviarTemplateAlProveedor`: misma firma
 * pública, mismo `INSERT` de `message`, mismo `publish`, y el mismo
 * comportamiento de errores observable de siempre — incluida la asimetría
 * histórica entre proveedores (YCloud: cualquier fallo se envuelve en
 * `TemplateError("meta_error", …)`; Graph: el `SendError` original se deja
 * propagar tal cual). `retry` no se pasa explícitamente → conserva el
 * reintento interno de siempre para el envío conversacional.
 */
export async function sendTemplate(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  variable?: string;
}): Promise<{ messageId: string }> {
  const resultado = await enviarTemplateAlProveedor(input);
  if (resultado.kind !== "SUCCESS") {
    if (resultado.causa instanceof SendError) throw resultado.causa;
    throw new TemplateError("meta_error", resultado.error);
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: resultado.waMessageId,
      direction: "out",
      type: "template",
      text: resultado.renderedText,
      status: "pending",
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id };
}
