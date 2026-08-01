import { desc } from "drizzle-orm";
import { apiError, withPlatformAdmin } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { RunConflictError, startRun } from "@/server/lab/runner";
import { labQuota, quotaExhausted } from "@/server/lab/quota";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withPlatformAdmin(async (session) => {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      delta:
        run.status === "done" && run.score !== null && prev?.score != null
          ? run.score - prev.score
          : null,
    };
  });
  const quota = await labQuota(session.organizationId, {
    isAgency: session.platformRole === "superadmin",
  });
  return Response.json({
    runs: withDelta,
    aiConfigured: isAiConfigured(),
    quota,
  });
});

export const POST = withPlatformAdmin(async (session) => {
  if (!isAiConfigured()) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para correr el Laboratorio"
    );
  }
  // Cada corrida cuesta unas 33 llamadas al modelo, y las paga la agencia.
  const quota = await labQuota(session.organizationId, {
    isAgency: session.platformRole === "superadmin",
  });
  if (quotaExhausted(quota)) {
    return apiError(
      429,
      "lab_quota_exceeded",
      `Ya usaste las ${quota.limit} pruebas de este mes. El cupo se renueva el día 1; si necesitas más, escríbenos.`
    );
  }

  try {
    const runId = await startRun(session.organizationId);
    return Response.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una corrida en curso; espera a que termine"
      );
    }
    throw err;
  }
});
