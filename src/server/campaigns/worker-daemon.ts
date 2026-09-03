import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { resolverTrabajoTomado } from "@/server/campaigns/worker";
import { reclamarTrabajoDeCampana } from "@/server/campaigns/cola";
import { rescatarHuerfanosDeCampana } from "@/server/campaigns/recovery";
import { enviarTemplateAlProveedor } from "@/server/whatsapp/templates";

/**
 * Fase 10B — el proceso que de verdad vacía `campaign_send_job`, clonado
 * DELIBERADAMENTE del patrón ya probado de `@/server/ai/worker.ts`
 * (sondeo + mantenimiento + `SIGTERM`/`SIGINT`, `unref()` en los timers,
 * idempotente si el módulo se recarga). Antes de esta fase, el motor de
 * campañas (`motor.ts`/`cola.ts`/`worker.ts`/`recovery.ts`) estaba completo
 * y probado pero DESCONECTADO de cualquier bucle de ejecución real — la
 * auditoría 153 lo marcó como el bloqueador más duro (nada envía nada sin
 * esto).
 *
 * No reutiliza el worker de IA ni su cola (`agent_job`): son cupos y
 * conceptos distintos a propósito (Fase 3B/4A) — un envío masivo nunca debe
 * competir por el mismo cupo de concurrencia que un turno conversacional.
 *
 * `AGENT_WORKER_ENABLED` es `true` por defecto; `CAMPAIGN_WORKER_ENABLED`
 * es `false` por defecto — un envío masivo real solo debe arrancar cuando
 * alguien lo enciende explícitamente.
 */

/** Exportado solo para tests — el resto del módulo lo usa como tipo interno. */
export type EstadoWorkerCampana = {
  id: string;
  timerSondeo: ReturnType<typeof setInterval> | null;
  timerMantenimiento: ReturnType<typeof setInterval> | null;
  enVuelo: number;
  parando: boolean;
};

const MANTENIMIENTO_MS = 60_000;

const globalForCampaignWorker = globalThis as unknown as {
  __campaignWorker?: EstadoWorkerCampana;
};

/** El proveedor REAL — inyectado explícitamente, nunca importado directo dentro de `worker.ts` (Fase 6A, punto 10: inyección de dependencia deliberada, sin bandera global de "modo test"). */
const proveedorReal = enviarTemplateAlProveedor;

export function arrancarWorkerDeCampanas(): void {
  if (globalForCampaignWorker.__campaignWorker) return;
  const env = getEnv();
  if (!env.CAMPAIGN_WORKER_ENABLED) {
    console.log("[campaign-worker] desactivado por CAMPAIGN_WORKER_ENABLED (apagado por defecto)");
    return;
  }

  const estado: EstadoWorkerCampana = {
    id: `${process.pid}-${randomUUID().slice(0, 8)}`,
    timerSondeo: null,
    timerMantenimiento: null,
    enVuelo: 0,
    parando: false,
  };
  globalForCampaignWorker.__campaignWorker = estado;

  estado.timerSondeo = setInterval(() => void sondear(estado), env.CAMPAIGN_WORKER_POLL_MS);
  estado.timerMantenimiento = setInterval(() => void mantenimiento(), MANTENIMIENTO_MS);
  estado.timerSondeo.unref?.();
  estado.timerMantenimiento.unref?.();

  console.log(
    `[campaign-worker] arrancado (${estado.id}), concurrencia=${env.CAMPAIGN_WORKER_CONCURRENCY}, ` +
      `rate-limit=${env.CAMPAIGN_RATE_LIMIT_MAX}/${env.CAMPAIGN_RATE_LIMIT_WINDOW_MS}ms`
  );
  void mantenimiento();

  for (const señal of ["SIGTERM", "SIGINT"] as const) {
    process.once(señal, () => {
      estado.parando = true;
      if (estado.timerSondeo) clearInterval(estado.timerSondeo);
      if (estado.timerMantenimiento) clearInterval(estado.timerMantenimiento);
      console.log("[campaign-worker] parando; los envíos en vuelo terminan solos");
    });
  }
}

/** Solo para tests: permite reiniciar el estado global del módulo entre pruebas. */
export function _resetWorkerDeCampanasParaTests(): void {
  const estado = globalForCampaignWorker.__campaignWorker;
  if (estado) {
    if (estado.timerSondeo) clearInterval(estado.timerSondeo);
    if (estado.timerMantenimiento) clearInterval(estado.timerMantenimiento);
  }
  globalForCampaignWorker.__campaignWorker = undefined;
}

/**
 * Reclama SECUENCIALMENTE (una consulta rápida a la vez — el propio
 * `FOR UPDATE SKIP LOCKED` de `reclamarTrabajoDeCampana` ya garantiza que
 * dos reclamos nunca se pisan, aunque corran en paralelo), pero PROCESA
 * cada envío ya reclamado SIN esperarlo (`void resolverTrabajoTomado(...)`)
 * — igual que `ai/worker.ts` separa `tomarTrabajo`/`ejecutar`. Con la
 * primera versión de este archivo (`await procesarUnEnvioDeCampana(...)`
 * dentro del `while`), `CAMPAIGN_WORKER_CONCURRENCY > 1` no tenía ningún
 * efecto real: el bucle esperaba a que el envío HTTP completo terminara
 * antes de reclamar el siguiente, así que el "paralelismo" solo ocurría
 * por accidente si el siguiente tick del `setInterval` alcanzaba a la
 * llamada anterior — sin control real del límite. Encontrado en la propia
 * autoauditoría de esta fase.
 */
/** Exportada como `sondearParaTests` (no se usa fuera de este módulo salvo en tests): mismo motivo que `_resetWorkerDeCampanasParaTests`. */
export async function sondearParaTests(estado: EstadoWorkerCampana): Promise<void> {
  return sondear(estado);
}

async function sondear(estado: EstadoWorkerCampana): Promise<void> {
  if (estado.parando) return;
  const env = getEnv();
  while (estado.enVuelo < env.CAMPAIGN_WORKER_CONCURRENCY) {
    let tomado: Awaited<ReturnType<typeof reclamarTrabajoDeCampana>>;
    try {
      tomado = await reclamarTrabajoDeCampana(estado.id);
    } catch (err) {
      console.error("[campaign-worker] no se pudo leer la cola:", err);
      return;
    }
    if (!tomado) return;

    estado.enVuelo += 1;
    void resolverTrabajoTomado(tomado, {
      proveedor: proveedorReal,
      rateLimit: { windowMs: env.CAMPAIGN_RATE_LIMIT_WINDOW_MS, max: env.CAMPAIGN_RATE_LIMIT_MAX },
    })
      .then((resultado) => {
        if (resultado.outcome === "error_inesperado" || resultado.outcome === "reconexion_requerida") {
          console.warn(`[campaign-worker] resultado ${resultado.outcome} (job ${tomado.jobId})`);
        }
      })
      .catch((err) => {
        console.error(`[campaign-worker] fallo procesando el job ${tomado.jobId}:`, err);
      })
      .finally(() => {
        estado.enVuelo -= 1;
      });
  }
}

async function mantenimiento(): Promise<void> {
  try {
    const { recuperadosSeguro, marcadosIndeterminado } = await rescatarHuerfanosDeCampana();
    if (recuperadosSeguro > 0 || marcadosIndeterminado > 0) {
      console.log(
        `[campaign-worker] recovery: ${recuperadosSeguro} recuperado(s) seguro(s), ` +
          `${marcadosIndeterminado} marcado(s) indeterminado (requieren revisión manual)`
      );
    }
  } catch (err) {
    console.error("[campaign-worker] rescate de huérfanos falló:", err);
  }
}
