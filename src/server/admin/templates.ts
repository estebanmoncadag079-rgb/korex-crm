import { and, desc, eq, ilike, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

export type ProviderDeTemplates = "ycloud" | "graph";

/**
 * Resuelve con qué proveedor se gestionarán las plantillas de una
 * organización, a partir de sus credenciales conectadas — NUNCA a partir de
 * un valor que mande el cliente (Fase 9M, secciones 5/6: "No inferir YCloud
 * solo porque exista una credential cualquiera"). Mismo criterio ya usado
 * en `ycloudApiKeyOf()`/`resolveWabaId()` (`src/server/inbox/send.ts`,
 * `src/server/whatsapp/templates.ts`): `phoneNumberId` con el prefijo
 * sintético `"ycloud:"` es una conexión YCloud (propia del cliente o de la
 * agencia); cualquier otro valor es una conexión Meta Graph directa —
 * `"graph"` sigue sin adaptador de gestión de plantillas (Fase 9D/9H), así
 * que la capa de API debe mostrar un error claro para ese caso, nunca
 * intentar YCloud por error.
 *
 * `null` = sin ninguna conexión — no hay proveedor con el que gestionar
 * nada todavía.
 */
export async function resolverProviderDeOrganizacion(
  organizationId: string
): Promise<ProviderDeTemplates | null> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return null;
  return creds.phoneNumberId.startsWith("ycloud:") ? "ycloud" : "graph";
}

export type AdminTemplateSummary = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: "draft" | "pending" | "approved" | "rejected";
  provider: string | null;
  providerStatus: string | null;
  providerLastSyncAt: string | null;
  rejectionReason: string | null;
  waTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTemplateFiltros = {
  organizationId?: string;
  status?: "draft" | "pending" | "approved" | "rejected";
  provider?: string;
  /** Búsqueda por nombre, subcadena, sin distinguir mayúsculas. */
  q?: string;
};

/**
 * Listado CROSS-ORGANIZACIÓN de plantillas para el panel de superadmin —
 * deliberadamente sin `scoped()` (Fase 9M, sección 4): el gate de acceso es
 * `withPlatformAdmin` en la capa de API, no un filtro de tenant aquí — mismo
 * criterio que `listClients()` (la otra única lectura cross-tenant
 * intencional de la app, `src/server/admin/clients.ts`).
 *
 * Nunca selecciona columnas de `meta_credentials` — solo las columnas de
 * `template` explícitamente pedidas (Fase 9M, sección 4/22): jamás
 * token/tokenCipher/apiKey/webhookSecret.
 */
export async function listAdminTemplates(
  filtros: AdminTemplateFiltros = {}
): Promise<AdminTemplateSummary[]> {
  const db = getDb();
  const condiciones: SQL[] = [];
  if (filtros.organizationId) {
    condiciones.push(eq(schema.template.organizationId, filtros.organizationId));
  }
  if (filtros.status) condiciones.push(eq(schema.template.status, filtros.status));
  if (filtros.provider) condiciones.push(eq(schema.template.provider, filtros.provider));
  if (filtros.q) condiciones.push(ilike(schema.template.name, `%${filtros.q}%`));

  const rows = await db
    .select({
      id: schema.template.id,
      organizationId: schema.template.organizationId,
      organizationName: schema.organization.name,
      name: schema.template.name,
      language: schema.template.language,
      category: schema.template.category,
      body: schema.template.body,
      status: schema.template.status,
      provider: schema.template.provider,
      providerStatus: schema.template.providerStatus,
      providerLastSyncAt: schema.template.providerLastSyncAt,
      rejectionReason: schema.template.rejectionReason,
      waTemplateId: schema.template.waTemplateId,
      createdAt: schema.template.createdAt,
      updatedAt: schema.template.updatedAt,
    })
    .from(schema.template)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.template.organizationId)
    )
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(schema.template.updatedAt));

  return rows.map((r) => ({
    ...r,
    providerLastSyncAt: r.providerLastSyncAt ? r.providerLastSyncAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
