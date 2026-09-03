/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { cleanupOrphanRuns } = await import("./instrumentation-node");
    await cleanupOrphanRuns();
    const { arrancarWorker } = await import("./server/ai/worker");
    arrancarWorker();
    // Fase 10B — apagado por defecto (`CAMPAIGN_WORKER_ENABLED`), a
    // diferencia del worker de IA: un envío masivo real solo debe
    // arrancar cuando alguien lo enciende explícitamente.
    const { arrancarWorkerDeCampanas } = await import("./server/campaigns/worker-daemon");
    arrancarWorkerDeCampanas();
  }
}
