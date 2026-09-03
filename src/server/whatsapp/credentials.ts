import { eq, isNull, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import { isYcloudEnabled } from "@/lib/ycloud/client";

export type Credentials = {
  id: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  /** Meta directo: token de acceso. YCloud: API key del cliente ("" = la de la agencia). */
  token: string;
  /** Secreto del webhook de la cuenta YCloud del cliente (null = la de la agencia). */
  webhookSecret: string | null;
  /**
   * WABA ID real de Meta para clientes con cuenta propia de YCloud.
   * NULL mientras no llegue en un evento del webhook de YCloud.
   * Para cuentas de agencia o Meta directo, `wabaId` ya es el real y este campo
   * no se usa (ver doc 131-WABA-ID-CAPTURADO-Y-USADO-EN-PLANTILLAS).
   */
  metaWabaId: string | null;
};

type Row = typeof schema.metaCredentials.$inferSelect;

function toCredentials(row: Row): Credentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    webhookSecret:
      row.webhookSecretCipher && row.webhookSecretIv && row.webhookSecretTag
        ? decryptSecret({
            cipher: row.webhookSecretCipher,
            iv: row.webhookSecretIv,
            tag: row.webhookSecretTag,
          })
        : null,
    metaWabaId: row.metaWabaId ?? null,
  };
}

/**
 * Número a solo dígitos (E.164 sin '+'): es la CLAVE DE ENRUTAMIENTO de los
 * mensajes entrantes hacia su organización, así que se guarda y se consulta
 * siempre normalizado (Meta lo devuelve como "+57 315 513 6091").
 */
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Resuelve la conexión por WABA ID (eventos a nivel WABA, ej. plantillas). */
export async function getCredentialsByWabaId(
  wabaId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.wabaId, wabaId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/**
 * Resuelve la conexión por el número del negocio (enrutamiento del webhook de
 * YCloud, que no envía phone_number_id).
 */
export async function getCredentialsByDisplayPhone(
  phone: string
): Promise<Credentials | null> {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.displayPhoneNumber, normalized))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveCredentials(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  /** `undefined` conserva el secreto guardado; `null` lo borra. */
  webhookSecret?: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const secret =
    input.webhookSecret === undefined
      ? undefined
      : input.webhookSecret
        ? encryptSecret(input.webhookSecret)
        : null;
  const secretColumns =
    secret === undefined
      ? {}
      : {
          webhookSecretCipher: secret?.cipher ?? null,
          webhookSecretIv: secret?.iv ?? null,
          webhookSecretTag: secret?.tag ?? null,
        };
  await db
    .insert(schema.metaCredentials)
    .values({
      id: newId("credentials"),
      organizationId: input.organizationId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber
        ? normalizePhoneNumber(input.displayPhoneNumber)
        : null,
      verifiedName: input.verifiedName ?? null,
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      status: "connected",
      ...secretColumns,
    })
    .onConflictDoUpdate({
      target: [schema.metaCredentials.organizationId],
      set: {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber
          ? normalizePhoneNumber(input.displayPhoneNumber)
          : null,
        verifiedName: input.verifiedName ?? null,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        status: "connected",
        updatedAt: new Date(),
        ...secretColumns,
      },
    });
}

/**
 * Registra el número de WhatsApp de un cliente cuando el proveedor es YCloud.
 *
 * Dos formas de conectar un cliente, y las dos conviven:
 *
 * 1. **Por la cuenta de la agencia** (sin `apiKey`): solo se ata el NÚMERO a su
 *    organización y los envíos salen con la API key del entorno. Es como está
 *    conectada La Churra y gasta un cupo del plan de la agencia.
 * 2. **Con la cuenta propia del cliente** (`apiKey` + `webhookSecret`): cada
 *    negocio paga sus mensajes y aporta su propio cupo, así que la agencia no
 *    tiene techo de clientes. Sus eventos entran por `/api/webhooks/ycloud/<org>`.
 */
export async function saveYcloudNumber(input: {
  organizationId: string;
  phone: string;
  wabaId?: string | null;
  verifiedName?: string | null;
  /** `undefined` conserva la key guardada; `""` vuelve a la cuenta de la agencia. */
  apiKey?: string | null;
  webhookSecret?: string | null;
}): Promise<void> {
  const phone = normalizePhoneNumber(input.phone);
  if (!phone) throw new Error("Número inválido");

  // Corregir el número de un cliente no puede costarle sus credenciales: si no
  // llegan en esta llamada, se conservan las que ya tenía. Solo se heredan de
  // una conexión que YA era de YCloud — el token de Meta no es una API key.
  let apiKey = input.apiKey?.trim() ?? "";
  if (input.apiKey === undefined) {
    const current = await getCredentialsByOrg(input.organizationId);
    apiKey = current?.phoneNumberId.startsWith("ycloud:")
      ? current.token.trim()
      : "";
  }

  await saveCredentials({
    organizationId: input.organizationId,
    wabaId: input.wabaId || `ycloud:${phone}`,
    phoneNumberId: `ycloud:${phone}`,
    displayPhoneNumber: phone,
    verifiedName: input.verifiedName ?? null,
    token: apiKey,
    webhookSecret: input.webhookSecret,
  });
}

/**
 * API key de YCloud con la que hay que enviar por cuenta de una organización:
 * la suya si tiene cuenta propia, si no la de la agencia. Devuelve `null`
 * cuando no hay ninguna configurada.
 */
export async function getYcloudApiKey(
  organizationId: string
): Promise<string | null> {
  const credentials = await getCredentialsByOrg(organizationId);
  const own = credentials?.token.trim();
  if (own) return own;
  return process.env.YCLOUD_API_KEY?.trim() || null;
}

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}

/**
 * Fase 10C/10E — mismo criterio que ya usan `sendText`/`sendTemplate`/el
 * worker de campañas para decidir el canal real de envío: YCloud si la
 * organización trae su propia API key, o si la de la agencia está
 * habilitada; si no, Graph directo. Centralizado aquí para no repetir la
 * misma lógica de tres formas ligeramente distintas en `send.ts`,
 * `templates.ts`, `campaigns/worker.ts` y `campaigns/motor.ts`.
 */
export async function proveedorRealDeOrganizacion(organizationId: string): Promise<"ycloud" | "graph"> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return "graph";
  const propiaKey = creds.phoneNumberId.startsWith("ycloud:") ? creds.token.trim() : "";
  return propiaKey || isYcloudEnabled() ? "ycloud" : "graph";
}

/**
 * Persiste el WABA ID real de Meta para una organización con cuenta propia de
 * YCloud. Llega en cada evento del webhook (`whatsappInboundMessage.wabaId`,
 * `whatsappMessage.wabaId`): es el identificador que Meta asigna al WABA del
 * cliente, distinto del sintético `ycloud:<numero>` que solo sirve para enrutar.
 *
 * Solo escribe si el valor actual es NULL o cambió — no sobreescribe sin
 * necesidad. Descarta valores sintéticos (empezando por "ycloud:") para no
 * meterse en un bucle.
 *
 * Ver doc 131-WABA-ID-CAPTURADO-Y-USADO-EN-PLANTILLAS.
 */
export async function captureMetaWabaId(
  organizationId: string,
  realWabaId: string
): Promise<void> {
  if (!realWabaId || realWabaId.startsWith("ycloud:")) return;
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ metaWabaId: realWabaId, updatedAt: new Date() })
    .where(
      scoped(
        schema.metaCredentials.organizationId,
        organizationId,
        or(
          isNull(schema.metaCredentials.metaWabaId),
          ne(schema.metaCredentials.metaWabaId, realWabaId)
        )
      )
    );
}
