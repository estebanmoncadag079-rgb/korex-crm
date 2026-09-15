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
import {
  VARIABLE_REGEX,
  countVariables,
  headerTextConVariable,
  validateBodyVariables,
  validateComponents,
  type TemplateComponents,
} from "@/server/whatsapp/template-validation";
import {
  crearTemplateYCloud,
  obtenerTemplateYCloud,
  type ResultadoCreacionTemplateYCloud,
} from "@/server/whatsapp/ycloud-templates";
import { getYcloudApiKey, proveedorRealDeOrganizacion } from "@/server/whatsapp/credentials";
import { urlPublicaDeFoto } from "@/server/ai/fotos";
import { registrarEnvioWhatsappConCosto, categoriaDeTarifaDesdeTemplate } from "@/server/pricing/rates";

/** Re-exportado tal cual desde el módulo puro (Fase 9F) — mismo import path histórico para quien ya las use desde aquí. */
export { countVariables, validateBodyVariables };

/** Errores tipados del servicio de plantillas → HTTP en la capa de API. */
export class TemplateError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "invalid"
    | "not_found"
    | "meta_error"
    | "meta_unavailable"
    // Fase 9B: el envío real de un borrador a aprobación (YCloud/Graph) es
    // una fase posterior, no autorizada todavía — nunca se finge éxito.
    // Fase 9H: sigue usándose solo para provider="graph" (sin adaptador
    // todavía, sección 2 de esa fase) — para YCloud ya hay integración real.
    | "not_implemented"
    // Fase 9H: la plantilla ya tiene un intento de envío sin resolver
    // (AMBIGUOUS) — reconciliar con `reconciliarCreacionTemplateYCloud()`
    // antes de volver a intentar un envío nuevo.
    | "reconciliation_required"
    // Fase 9H: el proveedor confirmó la creación (tenemos providerTemplateId
    // real) pero el UPDATE local falló — nunca se repite el POST; el estado
    // se reconcilia después con `obtenerTemplateYCloud`/`reconciliarCreacionTemplateYCloud`.
    | "local_write_failed";

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
  not_implemented: 501,
  reconciliation_required: 409,
  local_write_failed: 500,
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

export function renderBody(body: string, variable?: string): string {
  // Función, no string: si el valor trae "$1" o "$&" (p. ej. "$1,000 de
  // descuento"), un string de reemplazo los interpretaría como referencias
  // de grupo de captura y corrompería el texto guardado/mostrado en el CRM.
  const value = variable ?? "";
  return body.replace(VARIABLE_REGEX, () => value);
}

export type TemplateRow = typeof schema.template.$inferSelect;

export function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    rejectionReason: t.rejectionReason,
    /**
     * El texto del header cuando lleva `{{1}}`. Lo necesita quien envía:
     * sin este dato la pantalla no puede saber que hay que pedir un valor
     * más, y el envío sale sin él (Meta lo rechaza con `#132000`). No es
     * información sensible — es el texto de la propia plantilla.
     */
    headerText: headerTextConVariable(t.components),
  };
}

/**
 * Fase 9M — serialización para el panel de superadmin: incluye
 * `organizationId`/`provider`/`providerStatus`/`providerLastSyncAt`/
 * `waTemplateId` (todo lo que `serializeTemplate` omite a propósito para la
 * vista de cliente). Ninguno de estos campos es sensible — la tabla
 * `template` no tiene ninguna columna de credenciales.
 */
export function serializeAdminTemplate(t: TemplateRow) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    provider: t.provider,
    providerStatus: t.providerStatus,
    providerLastSyncAt: t.providerLastSyncAt ? t.providerLastSyncAt.toISOString() : null,
    rejectionReason: t.rejectionReason,
    waTemplateId: t.waTemplateId,
    components: t.components ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
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

/**
 * Fase 9B — el camino de BORRADOR, deliberadamente separado de
 * `createTemplate()` (que sigue intacta arriba, sin cambios, y sigue
 * siendo lo único que usa `POST /api/templates` hoy — Fase 9B, punto 9:
 * nunca romper en silencio a quien ya depende de que crear = enviar de
 * inmediato).
 *
 * Reutiliza SOLO las dos piezas de `createTemplate()` que son puras (sin
 * red): `validateBodyVariables()` y la normalización del nombre. Nunca
 * toca credenciales, nunca resuelve un WABA, nunca llama a
 * `graphRequest`/YCloud — un borrador es contenido 100% local hasta que
 * alguien lo envíe a aprobación explícitamente (`enviarPlantillaAAprobacion`,
 * abajo, todavía sin integración real).
 *
 * A diferencia de `createTemplate()` (que usa `onConflictDoUpdate` porque
 * ahí SÍ tiene sentido "reenviar una plantilla editada"), aquí un choque
 * contra `UNIQUE(organizationId, name, language)` es un error claro: crear
 * un borrador nunca debe sobrescribir en silencio una fila ya existente
 * (que podría estar `approved`).
 */
export async function crearBorradorDePlantilla(
  organizationId: string,
  input: {
    name: string;
    language: string;
    category: string;
    body: string;
    /**
     * Fase 9M — con qué proveedor se gestionará esta plantilla, resuelto
     * SIEMPRE por la capa superior (server-side, a partir de las
     * credenciales de la organización) — nunca por el cliente. `undefined`/
     * `null` conserva el comportamiento histórico de 9B (borrador sin
     * proveedor asignado todavía).
     */
    provider?: string | null;
    /** Fase 9P — header/footer opcionales. `undefined`/`null` = sin componentes, comportamiento histórico. */
    components?: TemplateComponents | null;
  }
): Promise<TemplateRow> {
  const variableError = validateBodyVariables(input.body);
  if (variableError) throw new TemplateError("invalid", variableError);
  const componentsError = validateComponents(input.components);
  if (componentsError) throw new TemplateError("invalid", componentsError);
  if (input.components?.header.type === "IMAGE") {
    const resuelto = await resolverAssetDeHeaderImagen(organizationId, input.components.header.mediaAssetId);
    if (!resuelto.ok) throw new TemplateError("invalid", resuelto.error);
  }
  // Fase 10D — `IMAGE_URL` solo lo produce `sincronizarTemplatesYCloud()`;
  // creado a mano dejaría un header sin ningún control de mime/tamaño real.
  if (input.components?.header.type === "IMAGE_URL") {
    throw new TemplateError("invalid", "El header de imagen sincronizada no se puede crear manualmente");
  }

  const name = input.name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

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
      status: "draft",
      waTemplateId: null,
      provider: input.provider ?? null,
      providerStatus: null,
      providerLastSyncAt: null,
      components: input.components ?? null,
    })
    .onConflictDoNothing({
      target: [schema.template.organizationId, schema.template.name, schema.template.language],
    })
    .returning();
  const fila = inserted[0];
  if (!fila) {
    throw new TemplateError(
      "invalid",
      `Ya existe una plantilla "${name}" en el idioma "${input.language}" para esta organización`
    );
  }
  return fila;
}

/**
 * Fase 9M — edita un borrador (nunca toca `provider`/estado del proveedor).
 * Solo permite editar mientras `status === "draft"`: una vez enviada a
 * aprobación, el contenido ya viaja o viajó a YCloud/Meta, así que editarlo
 * localmente sin un nuevo envío dejaría el CRM desincronizado del proveedor.
 */
export async function editarBorradorDePlantilla(
  organizationId: string,
  templateId: string,
  input: {
    name?: string;
    language?: string;
    category?: string;
    body?: string;
    /** Fase 9P — `undefined` conserva el header/footer actual; `null` explícito lo quita. */
    components?: TemplateComponents | null;
  }
): Promise<TemplateRow> {
  const template = await cargarTemplateScoped(organizationId, templateId);
  if (template.status !== "draft") {
    throw new TemplateError(
      "invalid",
      `Solo se pueden editar plantillas en "draft" (estado actual: "${template.status}")`
    );
  }

  const body = input.body ?? template.body;
  const variableError = validateBodyVariables(body);
  if (variableError) throw new TemplateError("invalid", variableError);

  const components = input.components !== undefined ? input.components : (template.components ?? null);
  const componentsError = validateComponents(components);
  if (componentsError) throw new TemplateError("invalid", componentsError);
  if (components?.header.type === "IMAGE") {
    const resuelto = await resolverAssetDeHeaderImagen(organizationId, components.header.mediaAssetId);
    if (!resuelto.ok) throw new TemplateError("invalid", resuelto.error);
  }
  // Fase 10D — mismo guard que crearBorradorDePlantilla, pero solo cuando
  // el CALLER intenta establecer un IMAGE_URL nuevo explícitamente: una
  // plantilla sincronizada que ya lo tenía (conservado por no pasar
  // `components`) no debe rechazarse al editar otro campo cualquiera.
  if (input.components !== undefined && input.components?.header.type === "IMAGE_URL") {
    throw new TemplateError("invalid", "El header de imagen sincronizada no se puede crear manualmente");
  }

  const name = input.name
    ? input.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    : template.name;
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

  const db = getDb();
  try {
    const updated = await db
      .update(schema.template)
      .set({
        name,
        language: input.language ?? template.language,
        category: input.category ?? template.category,
        body,
        components,
        updatedAt: new Date(),
      })
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, templateId)))
      .returning();
    return updated[0]!;
  } catch (err) {
    // El mismo UNIQUE(organizationId, name, language) de crearBorradorDePlantilla:
    // renombrar un borrador al name+language de otra plantilla existente choca aquí.
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new TemplateError(
        "invalid",
        `Ya existe una plantilla "${name}" en el idioma "${input.language ?? template.language}" para esta organización`
      );
    }
    throw err;
  }
}

/**
 * Fase 9H — clasifica en qué punto está el ÚLTIMO intento de envío a
 * aprobación de un borrador, usando SOLO columnas ya existentes del schema
 * (sin ningún valor sintético en `providerStatus`, que el propio schema
 * documenta como "el dato crudo que devuelve el proveedor" — inventar algo
 * ahí sería mentirle a esa columna):
 *
 * - `"nunca_sometido"`: `provider`/`providerLastSyncAt` siguen NULL — nunca
 *   se intentó un envío.
 * - `"pendiente_reconciliar"`: hubo un intento (`provider`+`providerLastSyncAt`
 *   seteados) cuyo resultado fue AMBIGUOUS — `rejectionReason` sigue NULL
 *   porque no hay ningún rechazo real que reportar, solo incertidumbre.
 * - `"fallo_explicito"`: el proveedor respondió con un rechazo determinado
 *   (`rejectionReason` tiene el motivo) — seguro reintentar un envío nuevo.
 * - `"creado"`: `waTemplateId` ya existe — el proveedor confirmó la
 *   creación, nunca se debe volver a hacer POST.
 */
type EstadoSubmitYCloud = "nunca_sometido" | "pendiente_reconciliar" | "fallo_explicito" | "creado";

function estadoSubmitYCloud(t: {
  waTemplateId: string | null;
  provider: string | null;
  providerLastSyncAt: Date | null;
  rejectionReason: string | null;
}): EstadoSubmitYCloud {
  if (t.waTemplateId) return "creado";
  if (!t.provider || !t.providerLastSyncAt) return "nunca_sometido";
  return t.rejectionReason ? "fallo_explicito" : "pendiente_reconciliar";
}

/**
 * Traduce el `providerStatus` CRUDO de YCloud al `status` interno de Korex.
 * Cualquier valor fuera de PENDING/APPROVED/REJECTED (PAUSED/DISABLED/
 * ARCHIVED/IN_APPEAL/DELETED, o algo no documentado) es un caso que no
 * debería ocurrir justo después de crear — se trata como `"pending"`
 * (conservador: nunca afirma "approved"/"rejected" sin certeza) y el valor
 * crudo sigue disponible sin traducir en `providerStatus` para diagnóstico.
 */
export function mapProviderStatusToTemplateStatus(providerStatus: string): "pending" | "approved" | "rejected" {
  if (providerStatus === "APPROVED") return "approved";
  if (providerStatus === "REJECTED") return "rejected";
  return "pending";
}

/** Credenciales + WABA ID + API key de YCloud ya resueltos, listos para llamar al adaptador. Lanza si falta algo — nunca llega a HTTP sin esto completo. */
export async function resolverContextoYCloud(
  organizationId: string
): Promise<{ apiKey: string; wabaId: string }> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta tu número antes de gestionar plantillas");
  }
  const apiKey = await getYcloudApiKey(organizationId);
  if (!apiKey) {
    throw new TemplateError(
      "not_connected",
      "No hay una API key de YCloud configurada (ni propia del cliente ni de la agencia)"
    );
  }
  // Lanza TemplateError("not_connected", ...) si es cuenta propia de YCloud
  // sin metaWabaId capturado aún — se detiene aquí, antes de cualquier POST.
  const wabaId = resolveWabaId(creds);
  return { apiKey, wabaId };
}

/** Carga un template scoped por organización; lanza not_found si no existe o pertenece a otra. */
async function cargarTemplateScoped(organizationId: string, templateId: string): Promise<TemplateRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, templateId)))
    .limit(1);
  const template = rows[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada en esta organización");
  return template;
}

/** JPG/PNG únicamente para HEADER IMAGE — YCloud/Meta rechazan webp/pdf ahí, aunque `media_asset` los admita para otros usos (Fase 9O). */
const MIME_IMAGENES_HEADER = ["image/jpeg", "image/png"];
/** Límite documentado de YCloud/Meta para HEADER IMAGE (Fase 9O, WebFetch contra docs.ycloud.com). */
const MAX_BYTES_HEADER_IMAGE = 5_000_000;

/**
 * Fase 9P, secciones 6/7/16 — valida y resuelve el asset usado como HEADER
 * IMAGE: debe pertenecer a la MISMA organización (`scoped`, nunca confiado
 * del body), tener mime jpg/png, pesar ≤5MB, y tener una URL pública
 * resoluble. Nunca hace HTTP externo — solo confirma que
 * `urlPublicaDeFoto()` no devuelva `null` antes de construir cualquier
 * payload al proveedor.
 */
async function resolverAssetDeHeaderImagen(
  organizationId: string,
  mediaAssetId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const db = getDb();
  const rows = await db
    .select({ mimeType: schema.mediaAsset.mimeType, tamano: schema.mediaAsset.tamano })
    .from(schema.mediaAsset)
    .where(
      scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, mediaAssetId))
    )
    .limit(1);
  const asset = rows[0];
  if (!asset) {
    return { ok: false, error: "El asset de header no existe en esta organización" };
  }
  if (!asset.mimeType || !MIME_IMAGENES_HEADER.includes(asset.mimeType)) {
    return { ok: false, error: "El header de imagen solo admite JPG o PNG" };
  }
  if (asset.tamano != null && asset.tamano > MAX_BYTES_HEADER_IMAGE) {
    return { ok: false, error: "El header de imagen no puede superar 5 MB" };
  }
  const url = urlPublicaDeFoto(mediaAssetId);
  if (!url) {
    return {
      ok: false,
      error: "No hay una URL pública disponible para este asset (falta configurar PUBLIC_MEDIA_BASE_URL)",
    };
  }
  return { ok: true, url };
}

/**
 * Fase 9P, sección 17 — traduce `TemplateComponents` (referencias) a la
 * forma YA RESUELTA que el adaptador/cliente de envío necesitan (URL real,
 * nunca `mediaAssetId`). Reutilizado tanto por `enviarPlantillaAAprobacion`
 * (imagen de EJEMPLO para la aprobación) como por `enviarTemplateAlProveedor`
 * (imagen real de CADA envío) — la sección 17 documenta explícitamente que
 * ambas pueden diferir en el futuro (snapshot por campaña); hoy resuelven
 * el mismo `mediaAssetId` con la misma función, sin forzar que deban
 * coincidir siempre.
 */
async function resolverHeaderYFooterParaProveedor(
  organizationId: string,
  components: TemplateComponents | null | undefined
): Promise<{
  header?: { type: "IMAGE"; url: string } | { type: "TEXT"; text: string };
  footer?: string;
}> {
  if (!components) return {};
  const componentsError = validateComponents(components);
  if (componentsError) throw new TemplateError("invalid", componentsError);

  let header: { type: "IMAGE"; url: string } | { type: "TEXT"; text: string } | undefined;
  if (components.header.type === "IMAGE") {
    const resuelto = await resolverAssetDeHeaderImagen(organizationId, components.header.mediaAssetId);
    if (!resuelto.ok) throw new TemplateError("invalid", resuelto.error);
    header = { type: "IMAGE", url: resuelto.url };
  } else if (components.header.type === "IMAGE_URL") {
    // Fase 10D — plantilla sincronizada desde YCloud: la URL ya es real y
    // pública (Meta la aprobó tal cual), nunca pasa por `media_asset`.
    header = { type: "IMAGE", url: components.header.url };
  } else if (components.header.type === "TEXT") {
    header = { type: "TEXT", text: components.header.text };
  }
  return { header, footer: components.footer?.text };
}

/** Aplica el resultado de `crearTemplateYCloud()`/`obtenerTemplateYCloud()` sobre la fila local — el único punto que escribe `provider`/`providerStatus`/`waTemplateId`/`rejectionReason` para el camino YCloud. */
async function aplicarResultadoYCloud(
  organizationId: string,
  templateId: string,
  resultado: ResultadoCreacionTemplateYCloud
): Promise<TemplateRow> {
  const db = getDb();
  const where = scoped(schema.template.organizationId, organizationId, eq(schema.template.id, templateId));

  if (resultado.kind === "SUCCESS") {
    const nuevoStatus = mapProviderStatusToTemplateStatus(resultado.providerStatus);
    let updated: TemplateRow[];
    try {
      updated = await db
        .update(schema.template)
        .set({
          waTemplateId: resultado.providerTemplateId,
          provider: "ycloud",
          providerStatus: resultado.providerStatus,
          providerLastSyncAt: new Date(),
          status: nuevoStatus,
          rejectionReason: nuevoStatus === "rejected" ? "Rechazada por YCloud/Meta" : null,
          updatedAt: new Date(),
        })
        .where(where)
        .returning();
    } catch {
      // Sección 16 (Fase 9H): YCloud YA confirmó la creación (tenemos
      // providerTemplateId real) — el UPDATE local falló, pero NUNCA se
      // repite el POST. El estado queda recuperable: una reconciliación
      // posterior (obtenerTemplateYCloud/reconciliarCreacionTemplateYCloud)
      // encontrará la plantilla real en YCloud y podrá completar el UPDATE.
      throw new TemplateError(
        "local_write_failed",
        `YCloud creó la plantilla (id ${resultado.providerTemplateId}) pero no se pudo guardar localmente. ` +
          "No se repite la creación — reconciliar antes de cualquier otro intento."
      );
    }
    return updated[0]!;
  }

  if (resultado.kind === "EXPLICIT_FAILURE") {
    await db
      .update(schema.template)
      .set({
        provider: "ycloud",
        providerLastSyncAt: new Date(),
        rejectionReason: resultado.error,
        updatedAt: new Date(),
      })
      .where(where);
    throw new TemplateError("invalid", `YCloud rechazó el envío a aprobación (${resultado.code}): ${resultado.error}`);
  }

  // AMBIGUOUS — sección 10 (Fase 9H): nunca approved/rejected, nunca se
  // asume que no se creó. `rejectionReason` se deja NULL a propósito: no
  // hay ningún rechazo real que reportar, solo incertidumbre.
  await db
    .update(schema.template)
    .set({
      provider: "ycloud",
      providerLastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(where);
  throw new TemplateError(
    "meta_unavailable",
    `YCloud no confirmó el resultado de la creación (${resultado.error}). ` +
      "Requiere reconciliación — usa reconciliarCreacionTemplateYCloud() antes de reintentar."
  );
}

/**
 * Fase 9H — envía un BORRADOR a aprobación ante el proveedor real
 * (`provider="ycloud"` por ahora; `"graph"` sigue sin adaptador, sección 2
 * del prompt de esta fase). Nunca reutiliza `createTemplate()` — usa
 * explícitamente `crearTemplateYCloud()`.
 *
 * `input.provider` solo hace falta la PRIMERA vez (se persiste en
 * `template.provider`, la columna que 9B dejó preparada para esto); en
 * llamadas posteriores se lee de la fila. Sin proveedor (ni en el input ni
 * ya guardado) → rechazo claro, nunca se infiere de las credenciales.
 */
export async function enviarPlantillaAAprobacion(
  organizationId: string,
  templateId: string,
  input?: { provider?: "ycloud" | "graph"; variableExample?: string }
): Promise<TemplateRow> {
  const template = await cargarTemplateScoped(organizationId, templateId);

  if (template.status !== "draft") {
    throw new TemplateError(
      "invalid",
      `Solo se pueden enviar a aprobación plantillas en "draft" (estado actual: "${template.status}")`
    );
  }

  const provider = input?.provider ?? template.provider;
  if (!provider) {
    throw new TemplateError(
      "invalid",
      "La plantilla no tiene un proveedor de aprobación asignado — indica provider: \"ycloud\" (\"graph\" aún no soportado)"
    );
  }
  if (provider === "graph") {
    // Sección 2 del prompt 9H: no construir una ruta nueva si no hace
    // falta — Graph directo sigue sin adaptador de GESTIÓN de plantillas
    // (solo existe el legacy `createTemplate()`, que crea Y envía en un
    // solo paso, incompatible con el flujo borrador→submit).
    throw new TemplateError(
      "not_implemented",
      "Envío a aprobación vía Graph directo todavía no implementado para el flujo de borradores."
    );
  }
  if (provider !== "ycloud") {
    throw new TemplateError("invalid", `Proveedor de aprobación desconocido: "${provider}"`);
  }

  const estado = estadoSubmitYCloud(template);
  if (estado === "creado") {
    throw new TemplateError("invalid", "Esta plantilla ya fue enviada al proveedor (tiene un ID confirmado)");
  }
  if (estado === "pendiente_reconciliar") {
    throw new TemplateError(
      "reconciliation_required",
      "Ya existe un envío anterior sin confirmar (resultado ambiguo) — reconcilia con " +
        "reconciliarCreacionTemplateYCloud() antes de volver a intentar"
    );
  }
  // estado === "nunca_sometido" | "fallo_explicito" → seguro continuar.

  const { apiKey, wabaId } = await resolverContextoYCloud(organizationId);

  // Fase 9P — imagen/texto de EJEMPLO para la aprobación (distinta,
  // conceptualmente, de la imagen real que se usará en cada envío una vez
  // aprobada — sección 17). Se resuelve ANTES de tocar YCloud: un asset
  // inválido o cross-tenant rechaza aquí, sin ningún HTTP externo.
  const { header, footer } = await resolverHeaderYFooterParaProveedor(organizationId, template.components);

  const resultado = await crearTemplateYCloud({
    apiKey,
    wabaId,
    name: template.name,
    language: template.language,
    category: template.category,
    body: template.body,
    variableExample: input?.variableExample,
    header,
    footer,
  });

  return aplicarResultadoYCloud(organizationId, templateId, resultado);
}

export type ResultadoReconciliacionTemplate =
  | { status: "confirmado"; template: TemplateRow }
  | { status: "no_encontrado_reintentable"; template: TemplateRow }
  | { status: "pendiente"; template: TemplateRow };

/**
 * Fase 9H, sección 11 — reconcilia un envío que quedó AMBIGUOUS,
 * consultando el estado real en YCloud. NUNCA hace un nuevo POST — solo
 * GET (`obtenerTemplateYCloud`). Solo permite considerar "seguro
 * reintentar" cuando YCloud responde NOT_FOUND con certeza (sección 12):
 * un AMBIGUOUS o un EXPLICIT_FAILURE de la propia consulta NUNCA se tratan
 * como NOT_FOUND.
 */
export async function reconciliarCreacionTemplateYCloud(
  organizationId: string,
  templateId: string
): Promise<ResultadoReconciliacionTemplate> {
  const template = await cargarTemplateScoped(organizationId, templateId);

  if (template.provider !== "ycloud") {
    throw new TemplateError("invalid", `Reconciliación solo soportada para provider="ycloud" (actual: "${template.provider}")`);
  }
  const estado = estadoSubmitYCloud(template);
  if (estado === "creado") {
    throw new TemplateError("invalid", "Esta plantilla ya tiene un ID confirmado — no hace falta reconciliar");
  }
  if (estado === "nunca_sometido") {
    throw new TemplateError("invalid", "Esta plantilla nunca fue enviada a aprobación — no hay nada que reconciliar");
  }

  const { apiKey, wabaId } = await resolverContextoYCloud(organizationId);
  const consulta = await obtenerTemplateYCloud({
    apiKey,
    wabaId,
    name: template.name,
    language: template.language,
  });

  const db = getDb();
  const where = scoped(schema.template.organizationId, organizationId, eq(schema.template.id, templateId));

  if (consulta.kind === "SUCCESS") {
    const nuevoStatus = mapProviderStatusToTemplateStatus(consulta.template.providerStatus);
    const updated = await db
      .update(schema.template)
      .set({
        waTemplateId: consulta.template.providerTemplateId,
        provider: "ycloud",
        providerStatus: consulta.template.providerStatus,
        providerLastSyncAt: new Date(),
        status: nuevoStatus,
        rejectionReason: nuevoStatus === "rejected" ? "Rechazada por YCloud/Meta" : null,
        updatedAt: new Date(),
      })
      .where(where)
      .returning();
    return { status: "confirmado", template: updated[0]! };
  }

  if (consulta.kind === "NOT_FOUND") {
    // Sección 12: NOT_FOUND con certeza — recién aquí es seguro habilitar
    // un futuro reintento. Se guarda en `rejectionReason` (mueve el estado
    // a "fallo_explicito" en `estadoSubmitYCloud`, que ya permite reenviar)
    // — nunca se reintenta automáticamente desde esta función.
    const updated = await db
      .update(schema.template)
      .set({
        providerLastSyncAt: new Date(),
        rejectionReason: `Reconciliación (${new Date().toISOString()}): YCloud no tiene esta plantilla — se puede reintentar el envío.`,
        updatedAt: new Date(),
      })
      .where(where)
      .returning();
    return { status: "no_encontrado_reintentable", template: updated[0]! };
  }

  // AMBIGUOUS o EXPLICIT_FAILURE de la propia CONSULTA: sigue sin poder
  // afirmarse nada — nunca se trata como NOT_FOUND (sección 12).
  const updated = await db
    .update(schema.template)
    .set({ providerLastSyncAt: new Date(), updatedAt: new Date() })
    .where(where)
    .returning();
  return { status: "pendiente", template: updated[0]! };
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
  /** Valor del `{{1}}` del HEADER — parámetro distinto del `variable` del body. */
  headerVariable?: string;
  retry?: boolean;
  timeoutMs?: number;
  /**
   * Contenido a usar en vez del `template` vivo (Fase 6C, fuente de verdad
   * híbrida): cuando se pasa, `name`/`language`/`body` de este snapshot
   * gobiernan el payload al proveedor y el `renderedText` — `templateId`
   * solo se usa para confirmar que la plantilla sigue existiendo y
   * `approved` (identidad/estado ante Meta, nunca contenido). Sin este
   * campo (uso conversacional normal vía `sendTemplate()`), se sigue
   * leyendo todo del `template` vivo — comportamiento histórico intacto.
   */
  contentSnapshot?: { name: string; language: string; body: string; components?: TemplateComponents };
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

  // "contenido" = snapshot (si se pasó) | template vivo (comportamiento
  // histórico) — "identidad/estado Meta" = SIEMPRE el template vivo, arriba.
  // Fase 9P, sección 15: `components` sigue el mismo criterio — si hay
  // snapshot de campaña, sus `components` mandan (nunca se vuelve a mirar
  // el template vivo para decidir qué imagen enviar); sin snapshot (envío
  // conversacional normal vía `sendTemplate()`), se usa el vivo.
  const contenido = input.contentSnapshot ?? {
    name: template.name,
    language: template.language,
    body: template.body,
    components: template.components ?? undefined,
  };

  const needsVariable = countVariables(contenido.body) === 1;
  if (needsVariable && !input.variable?.trim()) {
    throw new TemplateError("invalid", "La plantilla requiere el valor de {{1}}");
  }

  /**
   * La variable del HEADER es un parámetro distinto del `{{1}}` del body
   * (Meta las numera por componente). Ver `headerTextConVariable` para el
   * incidente que lo destapó: sin esto, una plantilla con header
   * personalizado se rechaza con `#132000` y el mensaje nunca sale.
   */
  const textoHeaderConVariable = headerTextConVariable(contenido.components);
  if (textoHeaderConVariable && !input.headerVariable?.trim()) {
    throw new TemplateError(
      "invalid",
      "La plantilla requiere el valor de {{1}} del encabezado"
    );
  }
  const headerTextParam = textoHeaderConVariable
    ? input.headerVariable!.trim()
    : undefined;

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
  const renderedText = renderBody(contenido.body, input.variable?.trim());

  // Fase 9P, sección 16 — el asset de header debe pertenecer a la MISMA
  // organización que la conversación/campaña (`input.organizationId`, ya
  // validado por `scoped()` arriba), nunca al `templateId` a ciegas.
  // Resuelto ANTES de cualquier HTTP: un asset cross-tenant o inválido
  // aborta aquí, sin gastar la llamada real.
  const { header } = await resolverHeaderYFooterParaProveedor(input.organizationId, contenido.components ?? null);
  const headerImageUrl = header?.type === "IMAGE" ? header.url : undefined;

  if (clientApiKey || isYcloudEnabled()) {
    try {
      const waMessageId = await ycloudSendTemplate({
        from: creds.displayPhoneNumber ?? "",
        to,
        name: contenido.name,
        language: contenido.language,
        bodyParams,
        headerImageUrl,
        headerTextParam,
        apiKey: clientApiKey,
        retry: input.retry,
        timeoutMs: input.timeoutMs,
      });
      return { kind: "SUCCESS", waMessageId, renderedText };
    } catch (err) {
      return clasificarErrorYCloud(err);
    }
  }

  // Fase 9P, sección 14 — mismo esquema estándar de Meta que YCloud ya
  // replica para envío (`{type:"header", parameters:[{type:"image",
  // image:{link:url}}]}`, confirmado en Fase 9P sección 13): un adapter
  // Graph separado no hace falta, el payload de mensaje de Meta Cloud API
  // es el mismo que YCloud expone como BSP.
  const graphComponents = [
    ...(headerImageUrl
      ? [{ type: "header", parameters: [{ type: "image", image: { link: headerImageUrl } }] }]
      : []),
    // Header de TEXTO con variable — excluyente con el de imagen: una
    // plantilla tiene un solo header, y si es TEXT no puede ser IMAGE.
    ...(headerTextParam
      ? [{ type: "header", parameters: [{ type: "text", text: headerTextParam }] }]
      : []),
    ...(needsVariable ? [{ type: "body", parameters: [{ type: "text", text: bodyParams[0]! }] }] : []),
  ];

  try {
    const waMessageId = await callGraphSend(creds, {
      messaging_product: "whatsapp",
      to: to.value,
      type: "template",
      template: {
        name: contenido.name,
        language: { code: contenido.language },
        ...(graphComponents.length ? { components: graphComponents } : {}),
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
  /** Valor del `{{1}}` del HEADER, si la plantilla lo lleva. */
  headerVariable?: string;
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

  // Fase 10C — costo REAL de una plantilla enviada de forma conversacional
  // (fuera de campaña): categoría = la del propio template (UTILITY/MARKETING),
  // proveedor y país resueltos igual que en el resto de envíos. Sin tarifa
  // cargada para ese país/proveedor, el costo se anota en 0 — nunca inventado.
  const [contexto] = await db
    .select({ category: schema.template.category, phone: schema.contact.phone })
    .from(schema.template)
    .innerJoin(schema.conversation, eq(schema.conversation.id, input.conversationId))
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(eq(schema.template.id, input.templateId))
    .limit(1);
  if (contexto) {
    await registrarEnvioWhatsappConCosto({
      organizationId: input.organizationId,
      tipo: "template",
      ref: resultado.waMessageId,
      provider: await proveedorRealDeOrganizacion(input.organizationId),
      category: categoriaDeTarifaDesdeTemplate(contexto.category),
      phone: contexto.phone,
    });
  }

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
