import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * La cola de turnos del agente, sobre Postgres (fases 1 y 2 de
 * `docs/korexia/33-ESCALABILIDAD.md`, 8-ago-2026).
 *
 * Reemplaza el `Map` en memoria de `pipeline.ts`. Tres cosas cambian:
 *
 * 1. **Varias réplicas pueden convivir.** El reparto se hace con
 *    `FOR UPDATE SKIP LOCKED`, así que dos procesos nunca toman el mismo
 *    trabajo. Antes, dos réplicas respondían dos veces al mismo cliente.
 * 2. **Un reinicio ya no pierde turnos.** El trabajo está en la base, no en un
 *    `setTimeout`; si el proceso muere a mitad, `rescatarHuerfanos` lo devuelve
 *    a la cola.
 * 3. **Un fallo se reintenta** con espera creciente, en vez de perderse en un
 *    `console.error`.
 *
 * Lo que NO cambia es la semántica que ya se había afinado con clientes reales,
 * y que aquí se preserva a propósito: se espera un poco antes de responder para
 * agrupar los mensajes que el cliente manda en ráfaga, solo corre un turno a la
 * vez por conversación, y lo que llegue mientras ese turno corre se atiende
 * junto en el siguiente.
 */

/** Intentos totales antes de dar un trabajo por fallido. */
export const MAX_INTENTOS = 5;

/** Espera antes de cada reintento. El último valor se repite si hiciera falta. */
const ESPERA_REINTENTO_MS = [10_000, 60_000, 300_000, 900_000];

/**
 * Un trabajo `corriendo` cuyo proceso murió se recupera pasado este tiempo.
 * Tiene que ser holgadamente mayor que el turno más lento (el modelo puede
 * tardar decenas de segundos y hay reintentos dentro del propio pipeline):
 * rescatar demasiado pronto duplicaría una respuesta que todavía viene en
 * camino, que es justo lo que esta cola vino a evitar.
 */
export const HUERFANO_TRAS_MS = 5 * 60_000;

/**
 * Techo del aplazamiento. Cada mensaje nuevo empuja el turno hacia adelante
 * (eso es el debounce), pero sin tope un cliente que escriba sin parar podría
 * no ser atendido nunca. Pasado este tiempo desde que se encoló, el turno sale
 * aunque el cliente siga escribiendo.
 */
export const ESPERA_MAXIMA_MS = 45_000;

export type TrabajoTomado = {
  id: string;
  conversationId: string;
  organizationId: string;
  attempts: number;
};

/**
 * Encola (o aplaza) el turno de una conversación.
 *
 * El `ON CONFLICT` sobre el índice único parcial es la coalescencia: si ya hay
 * un turno pendiente para esta conversación, no se crea otro — se empuja su
 * hora. Equivale al `clearTimeout` + `setTimeout` de antes, pero compartido
 * entre todas las réplicas.
 *
 * Si hay un turno `corriendo`, el índice no lo cubre y sí se crea un pendiente
 * nuevo: es el `pending: true` del código viejo, o sea que los mensajes que
 * llegan a mitad de turno se atienden juntos en el siguiente.
 */
export async function encolarTurno(
  conversationId: string,
  opts?: { delayMs?: number; diagnostico?: { waMessageId?: string; camino: "immediate" | "debounce" } }
): Promise<void> {
  const db = getDb();
  const delay = Math.max(0, opts?.delayMs ?? 0);
  /**
   * `xmax = 0` es el truco estándar de Postgres para distinguir, en un
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, si la fila que vuelve es
   * la recién insertada o una que ya existía y se actualizó (coalescencia).
   * Puramente diagnóstico (docs/korexia auditoría Lashes Valen, patrón
   * F,F/F,F,T de saludos duplicados): no cambia qué fila queda ni cuándo
   * corre — solo permite ver, sin adivinar, si un mensaje generó un job
   * NUEVO o si se fusionó con uno pendiente ya existente.
   */
  const filas = (await db.execute(sql`
    INSERT INTO agent_job (id, organization_id, conversation_id, status, run_at)
    SELECT ${newId("agentJob")}, c.organization_id, c.id, 'pendiente',
           now() + make_interval(secs => ${delay} / 1000.0)
      FROM conversation c
     WHERE c.id = ${conversationId}
    ON CONFLICT (conversation_id) WHERE status = 'pendiente'
    DO UPDATE SET
      run_at = LEAST(
        EXCLUDED.run_at,
        agent_job.created_at + make_interval(secs => ${ESPERA_MAXIMA_MS} / 1000.0)
      ),
      updated_at = now()
    RETURNING agent_job.id, (xmax = 0) AS inserted
  `)) as unknown as Array<{ id: string; inserted: boolean }>;
  const resultado = filas[0];
  if (opts?.diagnostico && resultado) {
    console.info(
      `[diag-turno] encolar conv=${conversationId} job=${resultado.id} ` +
        `camino=${opts.diagnostico.camino} delayMs=${delay} ` +
        `resultado=${resultado.inserted ? "job_nuevo" : "coalescido_con_pendiente"} ` +
        `wamid=${opts.diagnostico.waMessageId ?? "-"}`
    );
  }
}

/**
 * Cuántos turnos puede tener UNA organización corriendo a la vez.
 *
 * Sin este tope, un cliente con mucho volumen ocupa los cuatro huecos del
 * worker en su hora pico y los demás negocios hacen cola detrás — sus clientes
 * esperando sin saber por qué. Con el tope, el grande usa como mucho la mitad
 * y siempre queda sitio para los otros.
 *
 * No es un límite de cuánto atiende cada cliente: es de cuánto atiende **a la
 * vez**. Lo que no entra ahora entra en el siguiente sondeo, un segundo
 * después.
 */
export const CONCURRENCIA_POR_ORG = 2;

/**
 * Toma un trabajo vencido y lo marca `corriendo`, o devuelve `null`.
 *
 * `SKIP LOCKED` deja que varios workers tiren de la misma cola sin bloquearse.
 * El primer `NOT EXISTS` es la regla de un turno a la vez por conversación: si
 * ya hay uno corriendo para esa conversación, este espera su vuelta. El conteo
 * por organización es el reparto justo entre negocios.
 */
export async function tomarTrabajo(
  worker: string
): Promise<TrabajoTomado | null> {
  const db = getDb();
  const filas = (await db.execute(sql`
    UPDATE agent_job
       SET status = 'corriendo',
           locked_at = now(),
           locked_by = ${worker},
           attempts = agent_job.attempts + 1,
           updated_at = now()
     WHERE agent_job.id = (
       SELECT c.id
         FROM agent_job c
        WHERE c.status = 'pendiente'
          AND c.run_at <= now()
          AND NOT EXISTS (
                SELECT 1 FROM agent_job r
                 WHERE r.conversation_id = c.conversation_id
                   AND r.status = 'corriendo'
              )
          AND (
                SELECT count(*) FROM agent_job o
                 WHERE o.organization_id = c.organization_id
                   AND o.status = 'corriendo'
              ) < ${CONCURRENCIA_POR_ORG}
        ORDER BY c.run_at
          FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING agent_job.id,
              agent_job.conversation_id,
              agent_job.organization_id,
              agent_job.attempts
  `)) as unknown as Array<{
    id: string;
    conversation_id: string;
    organization_id: string;
    attempts: number;
  }>;

  const f = filas[0];
  if (!f) return null;
  return {
    id: f.id,
    conversationId: f.conversation_id,
    organizationId: f.organization_id,
    attempts: Number(f.attempts),
  };
}

/** Turno cumplido: el trabajo desaparece. La tabla guarda pendientes, no historia. */
export async function completarTrabajo(id: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`DELETE FROM agent_job WHERE id = ${id}`);
}

/**
 * Turno fallido: se reprograma con espera creciente, o se marca `fallido` si ya
 * agotó los intentos (queda en la tabla, que es la única forma de enterarse).
 *
 * Si mientras corría se encoló otro turno para la misma conversación, este se
 * borra en vez de reprogramarse: aquel ya cubre los mismos mensajes, y dos
 * pendientes a la vez violarían el índice único.
 */
export async function fallarTrabajo(
  id: string,
  error: unknown,
  attempts: number
): Promise<{ reintenta: boolean }> {
  const db = getDb();
  const mensaje = error instanceof Error ? error.message : String(error);
  const recorte = mensaje.slice(0, 2000);

  if (attempts >= MAX_INTENTOS) {
    await db.execute(sql`
      UPDATE agent_job
         SET status = 'fallido',
             locked_at = NULL,
             locked_by = NULL,
             last_error = ${recorte},
             updated_at = now()
       WHERE id = ${id}
    `);
    return { reintenta: false };
  }

  const espera =
    ESPERA_REINTENTO_MS[
      Math.min(attempts - 1, ESPERA_REINTENTO_MS.length - 1)
    ] ?? ESPERA_REINTENTO_MS[0];

  const reprogramados = (await db.execute(sql`
    UPDATE agent_job
       SET status = 'pendiente',
           locked_at = NULL,
           locked_by = NULL,
           last_error = ${recorte},
           run_at = now() + make_interval(secs => ${espera} / 1000.0),
           updated_at = now()
     WHERE agent_job.id = ${id}
       AND NOT EXISTS (
             SELECT 1 FROM agent_job o
              WHERE o.conversation_id = agent_job.conversation_id
                AND o.status = 'pendiente'
           )
    RETURNING agent_job.id
  `)) as unknown as Array<{ id: string }>;

  if (reprogramados.length === 0) {
    // Ya hay otro turno pendiente para esta conversación: cubre los mismos
    // mensajes, así que este sobra (y dos pendientes violarían el índice).
    await completarTrabajo(id);
  }
  return { reintenta: true };
}

/**
 * Devuelve a la cola los trabajos que quedaron `corriendo` en un proceso que ya
 * no existe. Es lo que impide que un despliegue o un reinicio dejen a un
 * cliente esperando una respuesta que nadie va a mandar.
 *
 * Se llama al arrancar y periódicamente desde el worker.
 */
export async function rescatarHuerfanos(): Promise<number> {
  const db = getDb();

  // Los que ya tienen un pendiente equivalente no se reviven: se descartan.
  await db.execute(sql`
    DELETE FROM agent_job h
     WHERE h.status = 'corriendo'
       AND h.locked_at < now() - make_interval(secs => ${HUERFANO_TRAS_MS} / 1000.0)
       AND EXISTS (
             SELECT 1 FROM agent_job o
              WHERE o.conversation_id = h.conversation_id
                AND o.status = 'pendiente'
           )
  `);

  const revividos = (await db.execute(sql`
    UPDATE agent_job
       SET status = 'pendiente',
           locked_at = NULL,
           locked_by = NULL,
           run_at = now(),
           updated_at = now()
     WHERE agent_job.status = 'corriendo'
       AND agent_job.locked_at < now() - make_interval(secs => ${HUERFANO_TRAS_MS} / 1000.0)
    RETURNING agent_job.id
  `)) as unknown as Array<{ id: string }>;

  return revividos.length;
}

/** Para el panel y las pruebas: cuántos trabajos hay en cada estado. */
export async function estadoDeLaCola(): Promise<{
  pendientes: number;
  corriendo: number;
  fallidos: number;
}> {
  const db = getDb();
  const filas = (await db.execute(sql`
    SELECT status, count(*)::int AS n FROM agent_job GROUP BY status
  `)) as unknown as Array<{ status: string; n: number }>;
  const buscar = (s: string) =>
    Number(filas.find((f) => f.status === s)?.n ?? 0);
  return {
    pendientes: buscar("pendiente"),
    corriendo: buscar("corriendo"),
    fallidos: buscar("fallido"),
  };
}
