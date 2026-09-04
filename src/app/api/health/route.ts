import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Fase 10N-A — el health check original solo confirmaba que la app
 * respondía y que la base estaba viva. No bastaba para un deploy
 * automatizado: "healthy" y un 200 no prueban que el contenedor lleve el
 * commit esperado (ver docs/korexia/02-INFRAESTRUCTURA.md, incidentes del
 * 1-ago y 5-ago-2026 — un `docker service update --force` puede reconstruir
 * código viejo con el servicio quedando healthy igual). `commit` se
 * hornea en la imagen en build time (`GIT_COMMIT`, ver Dockerfile) — nunca
 * se lee de git en runtime, el contenedor no tiene `.git`.
 *
 * `campaignWorkerEnabled` expone en texto plano el estado real de
 * `CAMPAIGN_WORKER_ENABLED` — para que un script de deploy pueda verificar
 * que el primer despliegue de este módulo salió con el worker apagado,
 * sin tener que adivinarlo ni confiar en que nadie lo cambió a mano.
 */
export async function GET() {
  const commit = process.env.GIT_COMMIT ?? null;
  try {
    const env = getEnv();
    await getDb().execute(sql`select 1`);
    return Response.json({
      ok: true,
      commit,
      campaignWorkerEnabled: env.CAMPAIGN_WORKER_ENABLED,
    });
  } catch {
    return Response.json(
      { ok: false, commit, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
