/**
 * Utilidades para las pruebas que necesitan Postgres de verdad.
 *
 * Existen porque desde el 8-ago-2026 la coalescencia de turnos y el rate-limit
 * viven en SQL (`docs/korexia/33-ESCALABILIDAD.md`): un índice único parcial,
 * un `ON CONFLICT`, un `FOR UPDATE SKIP LOCKED`. Nada de eso se puede probar
 * con un doble sin acabar probando el doble.
 *
 * Se saltan solas si no hay `TEST_DATABASE_URL`, para que `pnpm test` siga
 * funcionando sin base a mano. Cómo levantar una base desechable:
 * `docs/korexia/34-COLA-DE-TURNOS.md`.
 */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const hayBase = Boolean(TEST_DB_URL);

/**
 * Apunta la app a la base de pruebas ANTES de que se importe nada que lea el
 * entorno, y devuelve los módulos ya cargados contra ella.
 */
export async function cargarConBaseDePruebas() {
  process.env.DATABASE_URL = TEST_DB_URL;
  // `getEnv()` valida el entorno entero al primer uso; estas pruebas solo
  // tocan la base, pero sin lo demás ni se llega a abrir la conexión.
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET ??= "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN ??= "token-de-test";

  const db = await import("@/lib/db");
  const cola = await import("@/server/ai/cola");
  const campaignCola = await import("@/server/campaigns/cola");
  const campaignRecovery = await import("@/server/campaigns/recovery");
  const campaignMotor = await import("@/server/campaigns/motor");
  const campaignWorker = await import("@/server/campaigns/worker");
  const campaignPruebaControlada = await import("@/server/campaigns/prueba-controlada");
  const campaignEjecutarPrimerEnvio = await import("@/server/campaigns/ejecutar-primer-envio");
  const templates = await import("@/server/whatsapp/templates");
  const rateLimit = await import("@/lib/rate-limit");
  const leads = await import("@/server/inbox/lead-activity");
  const provisioning = await import("@/server/auth/provisioning");
  const auth = await import("@/lib/auth");
  const generador = await import("@/server/ai/generador/aplicar");
  const catalogo = await import("@/server/catalog/sembrar");
  const catalogoQueries = await import("@/server/catalog/queries");
  const catalogoGrupos = await import("@/server/catalog/grupos");
  const catalogoRender = await import("@/server/catalog/render");
  const catalogoProductos = await import("@/server/catalog/productos");
  const catalogoOpciones = await import("@/server/catalog/opciones");
  const estado = await import("@/server/orders/estado");
  return {
    ...db,
    cola,
    campaignCola,
    campaignRecovery,
    campaignMotor,
    campaignWorker,
    campaignPruebaControlada,
    campaignEjecutarPrimerEnvio,
    templates,
    rateLimit,
    leads,
    provisioning,
    auth,
    generador,
    catalogo,
    catalogoQueries,
    catalogoGrupos,
    catalogoRender,
    catalogoProductos,
    catalogoOpciones,
    estado,
  };
}

/** Organización + contacto + conversación mínimos para colgar trabajos. */
/**
 * Dos contactos, no uno: `conversation_org_contact_real_uq` solo admite una
 * conversación real por contacto y organización.
 */
export const FIXTURE = {
  org: "org_test_cola",
  contacto: "ct_test_cola",
  contacto2: "ct_test_cola_2",
  conversacion: "cv_test_cola",
  conversacion2: "cv_test_cola_2",
};
