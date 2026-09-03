import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  mapProviderStatusToTemplateStatus,
  resolverContextoYCloud,
  TemplateError,
} from "@/server/whatsapp/templates";
import { listarTemplatesYCloud, type TemplateYCloudMapeado } from "@/server/whatsapp/ycloud-templates";
import type { TemplateComponents } from "@/server/whatsapp/template-validation";

/**
 * Fase 10D — sincroniza plantillas CREADAS DIRECTAMENTE EN YCLOUD (fuera de
 * Korex, ver `docs/korexia/152`) hacia la tabla local `template`, para que
 * el resto del sistema (campañas, panel `/admin/templates`) pueda verlas y
 * usarlas sin volver a crearlas a mano.
 *
 * Decisión de arquitectura (Fase 10D, sección "TEMPLATE SOURCE OF TRUTH"):
 * YCloud es donde la plantilla se crea y se aprueba; Korex solo sincroniza,
 * muestra, selecciona y congela snapshot — NUNCA modifica la plantilla en
 * YCloud desde este flujo ni desde campañas.
 *
 * `listarTemplatesYCloud()` (adaptador puro, Fase 9D) existía desde esa
 * fase pero **nunca tenía ningún caller en producción** (confirmado en la
 * auditoría 153) — esta función es el primer punto de entrada real.
 */

export type ResultadoSyncYCloud = {
  creadas: number;
  actualizadas: number;
  marcadasAusentes: number;
  total: number;
};

/** Identifica de forma estable una plantilla ya conocida localmente: por `waTemplateId` real, o por name+language (una plantilla que Korex ya tenía como draft/pending sin ID todavía). */
async function buscarTemplateExistente(
  organizationId: string,
  remoto: TemplateYCloudMapeado
): Promise<typeof schema.template.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        or(
          eq(schema.template.waTemplateId, remoto.providerTemplateId),
          and(eq(schema.template.name, remoto.name), eq(schema.template.language, remoto.language))
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** `HeaderYCloudResuelto` (ya remoto) → `HeaderComponent` local, usando `IMAGE_URL` para imágenes (Fase 10D — nunca `media_asset`, ver `template-validation.ts`). */
function componentsDesdeRemoto(remoto: TemplateYCloudMapeado): TemplateComponents | null {
  if (!remoto.header && !remoto.footer) return null;
  const header: TemplateComponents["header"] = !remoto.header
    ? { type: "NONE" }
    : remoto.header.type === "IMAGE"
      ? { type: "IMAGE_URL", url: remoto.header.url }
      : { type: "TEXT", text: remoto.header.text };
  return { header, footer: remoto.footer ? { text: remoto.footer } : null };
}

/**
 * Sincroniza TODAS las plantillas de YCloud de una organización. Idempotente
 * (upsert por `waTemplateId`, o por `name+language` si todavía no tenía
 * ID): correrla dos veces seguidas produce el mismo resultado final, sin
 * duplicar filas — `creadas`/`actualizadas` en la segunda corrida son 0
 * (nada cambió) en vez de volver a insertar.
 *
 * Plantillas que YCloud YA NO devuelve (se borraron allá): nunca se
 * eliminan localmente (preserva histórico de campañas ya enviadas con esa
 * plantilla) — se marcan `status="rejected"` con un motivo explícito, lo
 * que las excluye automáticamente de campañas nuevas (`motor.ts` exige
 * `status="approved"`), sin inventar un valor en `providerStatus` (esa
 * columna documenta el dato CRUDO real del proveedor — Fase 9A — y "ya no
 * aparece" no es un dato que YCloud haya devuelto).
 */
export async function sincronizarTemplatesYCloud(organizationId: string): Promise<ResultadoSyncYCloud> {
  const { apiKey, wabaId } = await resolverContextoYCloud(organizationId);
  const resultado = await listarTemplatesYCloud({ apiKey, wabaId });

  if (resultado.kind !== "SUCCESS") {
    // AMBIGUOUS o EXPLICIT_FAILURE: nunca se interpreta como "sin plantillas"
    // — mismo criterio que el resto del adaptador (Fase 9F).
    throw new TemplateError(
      "meta_unavailable",
      `No se pudo sincronizar con YCloud (${resultado.kind}): ${resultado.error}`
    );
  }

  const db = getDb();
  let creadas = 0;
  let actualizadas = 0;

  const vistos = new Set<string>();
  for (const remoto of resultado.templates) {
    if (!remoto.providerTemplateId || !remoto.name || !remoto.language) continue; // ya filtrado por esRespuestaDeTemplateValida en la lista, defensivo igual
    vistos.add(remoto.providerTemplateId);

    const status = mapProviderStatusToTemplateStatus(remoto.providerStatus);
    const existente = await buscarTemplateExistente(organizationId, remoto);
    const components = componentsDesdeRemoto(remoto);

    if (existente) {
      await db
        .update(schema.template)
        .set({
          name: remoto.name,
          language: remoto.language,
          category: remoto.category || existente.category,
          body: remoto.body ?? existente.body,
          status,
          provider: "ycloud",
          providerStatus: remoto.providerStatus,
          providerLastSyncAt: new Date(),
          waTemplateId: remoto.providerTemplateId,
          rejectionReason: status === "rejected" ? (existente.rejectionReason ?? "Rechazada por Meta") : null,
          components: components ?? existente.components,
          updatedAt: new Date(),
        })
        .where(
          scoped(schema.template.organizationId, organizationId, eq(schema.template.id, existente.id))
        );
      actualizadas += 1;
    } else {
      await db.insert(schema.template).values({
        id: newId("template"),
        organizationId,
        name: remoto.name,
        language: remoto.language,
        category: remoto.category || "UTILITY",
        body: remoto.body ?? "",
        status,
        provider: "ycloud",
        providerStatus: remoto.providerStatus,
        providerLastSyncAt: new Date(),
        waTemplateId: remoto.providerTemplateId,
        components,
      });
      creadas += 1;
    }
  }

  // Plantillas locales YA sincronizadas con YCloud que esta vez no aparecieron.
  const localesYcloud = await db
    .select()
    .from(schema.template)
    .where(
      scoped(schema.template.organizationId, organizationId, eq(schema.template.provider, "ycloud"))
    );
  let marcadasAusentes = 0;
  for (const local of localesYcloud) {
    if (!local.waTemplateId || vistos.has(local.waTemplateId)) continue;
    if (local.status === "rejected" && local.rejectionReason?.startsWith("Ya no aparece en YCloud")) continue; // ya marcada, no repetir
    await db
      .update(schema.template)
      .set({
        status: "rejected",
        rejectionReason: `Ya no aparece en YCloud al sincronizar (${new Date().toISOString()}) — revisar antes de reutilizarla.`,
        updatedAt: new Date(),
      })
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, local.id)));
    marcadasAusentes += 1;
  }

  return { creadas, actualizadas, marcadasAusentes, total: resultado.templates.length };
}
