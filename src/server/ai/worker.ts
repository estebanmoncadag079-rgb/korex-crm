import { randomUUID } from "node:crypto";
import { getEnv, isAiConfigured } from "@/lib/env";
import { limpiarRateLimit } from "@/lib/rate-limit";
import {
  completarTrabajo,
  fallarTrabajo,
  rescatarHuerfanos,
  tomarTrabajo,
  type TrabajoTomado,
} from "@/server/ai/cola";
import { runAgentTurn } from "@/server/ai/pipeline";
import { enfriarLeadsDeTodasLasOrganizaciones } from "@/server/inbox/lead-activity";
import { reprocesarWebhooksFallidos } from "@/server/inbox/webhook-event-log";

/**
 * El worker que vacía la cola de turnos del agente (8-ago-2026).
 *
 * Vive DENTRO del proceso de la app a propósito: con 10-25 clientes, un
 * proceso aparte sería una pieza más que desplegar, vigilar y reiniciar sin
 * ganar nada. Lo que importa no es dónde corre, sino que el trabajo esté en la
 * base: por eso ahora se pueden levantar varias réplicas y todas tiran de la
 * misma cola sin pisarse (`FOR UPDATE SKIP LOCKED`).
 *
 * Sondea en vez de escuchar `NOTIFY` porque la latencia que añade (un segundo
 * como mucho) es despreciable al lado de lo que tarda el modelo, y a cambio no
 * hay que mantener viva una conexión dedicada ni reconectarla al reiniciar.
 */

const CONCURRENCIA_MAX = 4;
const SONDEO_MS = 1_000;
/** Cada cuánto se buscan trabajos huérfanos y webhooks por reprocesar. */
const MANTENIMIENTO_MS = 60_000;
/** Cada cuánto se bajan a "por recuperar" las tarjetas sin respuesta. */
const ENFRIAMIENTO_MS = 10 * 60_000;
let ultimoEnfriamiento = 0;

type EstadoWorker = {
  id: string;
  timerSondeo: ReturnType<typeof setInterval> | null;
  timerMantenimiento: ReturnType<typeof setInterval> | null;
  enVuelo: number;
  parando: boolean;
};

const globalForWorker = globalThis as unknown as {
  __agentWorker?: EstadoWorker;
};

/**
 * Arranca el worker. Idempotente: si Next recarga módulos en dev, o si algo lo
 * llama dos veces, sigue habiendo un solo bucle.
 */
export function arrancarWorker(): void {
  if (globalForWorker.__agentWorker) return;
  if (!isAiConfigured()) {
    console.log("[worker] IA sin configurar: no se arranca la cola de turnos");
    return;
  }
  if (getEnv().AGENT_WORKER_ENABLED === false) {
    console.log("[worker] desactivado por AGENT_WORKER_ENABLED=0");
    return;
  }

  const estado: EstadoWorker = {
    id: `${process.pid}-${randomUUID().slice(0, 8)}`,
    timerSondeo: null,
    timerMantenimiento: null,
    enVuelo: 0,
    parando: false,
  };
  globalForWorker.__agentWorker = estado;

  estado.timerSondeo = setInterval(() => void sondear(estado), SONDEO_MS);
  estado.timerMantenimiento = setInterval(
    () => void mantenimiento(),
    MANTENIMIENTO_MS
  );
  // `unref` para no impedir que el proceso termine cuando toque.
  estado.timerSondeo.unref?.();
  estado.timerMantenimiento.unref?.();

  console.log(`[worker] cola de turnos arrancada (${estado.id})`);
  void mantenimiento();

  for (const señal of ["SIGTERM", "SIGINT"] as const) {
    process.once(señal, () => {
      estado.parando = true;
      if (estado.timerSondeo) clearInterval(estado.timerSondeo);
      if (estado.timerMantenimiento) clearInterval(estado.timerMantenimiento);
      console.log("[worker] parando; los turnos en vuelo terminan solos");
    });
  }
}

/**
 * Toma tantos trabajos como quepan bajo el límite de concurrencia.
 *
 * El límite importa: sin él, una ráfaga de varios clientes a la vez lanzaría
 * decenas de llamadas al modelo en paralelo desde un VPS de un núcleo.
 */
async function sondear(estado: EstadoWorker): Promise<void> {
  if (estado.parando) return;
  while (estado.enVuelo < CONCURRENCIA_MAX) {
    let trabajo: TrabajoTomado | null;
    try {
      trabajo = await tomarTrabajo(estado.id);
    } catch (err) {
      console.error("[worker] no se pudo leer la cola:", err);
      return;
    }
    if (!trabajo) return;

    estado.enVuelo += 1;
    void ejecutar(trabajo).finally(() => {
      estado.enVuelo -= 1;
    });
  }
}

async function ejecutar(trabajo: TrabajoTomado): Promise<void> {
  try {
    await runAgentTurn(trabajo.conversationId);
    await completarTrabajo(trabajo.id);
  } catch (err) {
    console.error(
      `[worker] turno falló (conversación ${trabajo.conversationId}, intento ${trabajo.attempts}):`,
      err
    );
    try {
      const { reintenta } = await fallarTrabajo(
        trabajo.id,
        err,
        trabajo.attempts
      );
      if (!reintenta) {
        console.error(
          `[worker] turno AGOTADO tras ${trabajo.attempts} intentos — ` +
            `conversación ${trabajo.conversationId} sin respuesta. Queda en agent_job como 'fallido'.`
        );
      }
    } catch (err2) {
      console.error("[worker] tampoco se pudo marcar el fallo:", err2);
    }
  }
}

/**
 * Tareas periódicas: devolver a la cola lo que quedó colgado de un proceso
 * muerto, y reintentar los webhooks que fallaron al procesarse.
 */
async function mantenimiento(): Promise<void> {
  try {
    const revividos = await rescatarHuerfanos();
    if (revividos > 0) {
      console.log(`[worker] ${revividos} turno(s) huérfano(s) devuelto(s) a la cola`);
    }
  } catch (err) {
    console.error("[worker] rescate de huérfanos falló:", err);
  }

  try {
    const reprocesados = await reprocesarWebhooksFallidos();
    if (reprocesados > 0) {
      console.log(`[worker] ${reprocesados} webhook(s) fallido(s) reprocesado(s)`);
    }
  } catch (err) {
    console.error("[worker] reproceso de webhooks falló:", err);
  }

  try {
    await limpiarRateLimit();
  } catch (err) {
    console.error("[worker] limpieza del rate-limit falló:", err);
  }

  /*
   * Las tarjetas frías no se revisan en cada vuelta: quien lleva dos días
   * callado puede esperar diez minutos más, y esto recorre TODAS las
   * organizaciones en un servidor de un solo núcleo.
   */
  if (Date.now() - ultimoEnfriamiento >= ENFRIAMIENTO_MS) {
    ultimoEnfriamiento = Date.now();
    try {
      const enfriadas = await enfriarLeadsDeTodasLasOrganizaciones();
      if (enfriadas > 0) {
        console.log(`[worker] ${enfriadas} tarjeta(s) movida(s) por enfriamiento`);
      }
    } catch (err) {
      console.error("[worker] enfriamiento de leads falló:", err);
    }
  }
}
