import { createHash } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { notifyTeam } from "@/server/ai/notify-team";

/**
 * Fase 10N-A — idempotencia REAL de `notify_order`, a nivel de Postgres.
 * Ver el comentario de `orderConfirmation` en `schema.ts` para el porqué
 * (la ventana de carrera real y reconocida de `rescatarHuerfanos`).
 *
 * `notifyTeam()`/`appendLeadNote()` nunca deben ejecutarse dos veces para
 * el MISMO pedido de la MISMA conversación — pero un pedido genuinamente
 * distinto en esa misma conversación (otro día, otro contenido) sí debe
 * avisar.
 *
 * Fase 10N-D (revisión pre-commit) — corrección de un hallazgo real: la
 * primera versión de esta clave hasheaba `action.summary`, el texto LIBRE
 * que genera el modelo. En el escenario exacto que esto debe cubrir (dos
 * ejecuciones de `runAgentTurn` corriendo en paralelo para la misma
 * conversación, ver `rescatarHuerfanos`), las dos llamadas al modelo son
 * independientes y NO deterministas — podían producir dos resúmenes con
 * redacción ligeramente distinta para el MISMO pedido (otro orden de
 * líneas, otro formato de precio), con hashes distintos, y la protección
 * fallaba justo donde más falta hacía. La clave ahora se arma con los IDs
 * de los mensajes del cliente que disparan el cierre (`pendientes`, ya
 * filas reales de `message`) — esos SÍ son idénticos entre las dos
 * ejecuciones paralelas, porque ambas leen el mismo estado de la base
 * antes de que ninguna escriba nada.
 *
 * Fase 11-B — "pedido confirmado" (esta fila existe) y "el equipo recibió
 * el aviso" (el efecto externo real) eran, hasta ahora, la MISMA cosa: si
 * `registrarConfirmacionDePedido` devolvía `primeraVez: true` pero
 * `notifyTeam` fallaba, la idempotencia ya impedía cualquier reintento —
 * el pedido quedaba registrado, pero el equipo nunca se enteraba, y nada
 * en el sistema lo sabía. `notifyStatus` (columna nueva en
 * `orderConfirmation`, ver `schema.ts`) separa las dos cosas: el registro
 * del pedido es inmediato e incondicional; el estado del AVISO se rastrea
 * aparte, con reintento real (`reintentarNotificacionesPendientes`, que
 * corre desde `worker.ts` igual que `rescatarHuerfanos`).
 */

/** IDs de mensaje, ordenados y unidos, para que el orden de llegada no cambie la clave. */
export function claveDeConfirmacionDePedido(messageIds: string[]): string {
  const normalizado = [...messageIds].sort().join(",");
  return createHash("sha256").update(normalizado).digest("hex");
}

/**
 * Registra el intento de confirmación. `primeraVez: true` solo la primera
 * vez que este pedido (mismos mensajes disparadores, misma conversación)
 * se registra — el llamante debe usarlo para decidir si manda el WhatsApp
 * al equipo y anota la nota del pedido, o si ya se hizo y no hay que
 * repetirlo.
 *
 * Nunca lanza por un conflicto de duplicado (`onConflictDoNothing`): un
 * segundo intento simplemente devuelve `primeraVez: false`, no un error.
 *
 * Fase 11-B — `summary`/`customerPhone` se guardan en el momento del
 * registro: es el contenido EXACTO que un reintento posterior de la
 * notificación debe mandar, tal cual se decidió en este turno — nunca algo
 * recalculado ni vuelto a redactar (el modelo ya no participa en un
 * reintento).
 */
export async function registrarConfirmacionDePedido(input: {
  organizationId: string;
  conversationId: string;
  messageIds: string[];
  /**
   * Opcionales a propósito: el único llamador real (`pipeline.ts`) siempre
   * los trae, pero exigirlos aquí obligaría a cualquier prueba o script que
   * solo quiera probar la idempotencia en sí (sin que le importe el
   * reintento de notificación) a inventar un resumen — el registro del
   * pedido y el rastreo del aviso son responsabilidades separadas a
   * propósito (Fase 11-B).
   */
  summary?: string;
  customerPhone?: string | null;
}): Promise<{ primeraVez: boolean; id: string }> {
  const db = getDb();
  const idempotencyKey = claveDeConfirmacionDePedido(input.messageIds);
  const inserted = await db
    .insert(schema.orderConfirmation)
    .values({
      id: newId("orderConfirmation"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      idempotencyKey,
      summary: input.summary ?? null,
      customerPhone: input.customerPhone ?? null,
    })
    .onConflictDoNothing({
      target: [schema.orderConfirmation.conversationId, schema.orderConfirmation.idempotencyKey],
    })
    .returning({ id: schema.orderConfirmation.id });

  if (inserted.length > 0) {
    return { primeraVez: true, id: inserted[0]!.id };
  }
  // Ya existía: `onConflictDoNothing` no devuelve la fila en conflicto, hay
  // que leerla aparte para que el llamante sepa a qué fila referirse.
  const [existente] = await db
    .select({ id: schema.orderConfirmation.id })
    .from(schema.orderConfirmation)
    .where(
      and(
        eq(schema.orderConfirmation.conversationId, input.conversationId),
        eq(schema.orderConfirmation.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  // No puede faltar: si `onConflictDoNothing` disparó, la fila conflictiva
  // existe por definición. El `!` documenta esa garantía, no la esconde.
  return { primeraVez: false, id: existente!.id };
}

/**
 * Incidente real (5-sep-2026) — corregido: `registrarConfirmacionDePedido`
 * protege que el MISMO lote de mensajes disparadores no confirme dos veces
 * (Caso A: dos ejecuciones del mismo turno). No protege el Caso B, mucho más
 * dañino y confirmado en producción: un pedido YA confirmado y notificado, y
 * el cliente escribe algo DESPUÉS (una pregunta, un "gracias", cualquier
 * cosa) — ese mensaje nuevo genera un `pendientes`/`idempotencyKey`
 * DISTINTO, así que el `UNIQUE` no lo detecta, y si el modelo (por la razón
 * que sea: relevo automático por inactividad de `handoff-policy.ts` que
 * reintroduce todo el historial, o cualquier otra confusión) decide llamar
 * `notify_order` otra vez para ese mismo pedido, el backend lo dejaba pasar
 * sin más: doble aviso al equipo, doble "pedido confirmado" en el CRM.
 *
 * `notify_order` debe ser TERMINAL por pedido. Esta función es la mitad de
 * lectura de esa garantía (la otra mitad es el `if` en `pipeline.ts` que la
 * usa): da la ÚLTIMA confirmación real de esta conversación, para que el
 * backend —nunca el modelo— decida si lo que se le pide ahora es ese MISMO
 * pedido (bloquear) o uno genuinamente nuevo (dejarlo pasar).
 */
export async function ultimaConfirmacionDe(
  conversationId: string
): Promise<{ id: string; createdAt: Date } | null> {
  const db = getDb();
  const [fila] = await db
    .select({ id: schema.orderConfirmation.id, createdAt: schema.orderConfirmation.createdAt })
    .from(schema.orderConfirmation)
    .where(eq(schema.orderConfirmation.conversationId, conversationId))
    .orderBy(desc(schema.orderConfirmation.createdAt))
    .limit(1);
  return fila ?? null;
}

/**
 * Fase 10V, Hallazgo D (auditoría) — deshace el registro cuando el efecto
 * real ni siquiera llegó a INTENTARSE. Solo es seguro llamarla ANTES de que
 * `notifyTeam` se ejecute: `notifyTeam` está diseñado para nunca lanzar
 * (cada envío tiene su propio try/catch, ver `notify-team.ts`), así que el
 * único punto real donde algo puede fallar antes del aviso es
 * `contactPhoneOf`. Si el fallo ocurre DESPUÉS de `notifyTeam` (por ejemplo
 * en `appendLeadNote`), NUNCA se debe llamar esta función — el aviso real
 * ya salió, y deshacer la clave arriesgaría un reintento que lo duplique.
 */
export async function borrarConfirmacionDePedido(input: {
  conversationId: string;
  messageIds: string[];
}): Promise<void> {
  const db = getDb();
  const idempotencyKey = claveDeConfirmacionDePedido(input.messageIds);
  await db.delete(schema.orderConfirmation).where(
    and(
      eq(schema.orderConfirmation.conversationId, input.conversationId),
      eq(schema.orderConfirmation.idempotencyKey, idempotencyKey)
    )
  );
}

/**
 * Un intento en `enviando` cuyo proceso murió se recupera pasado este
 * tiempo — mismo criterio que `HUERFANO_TRAS_MS` de `cola.ts`: mayor que
 * cualquier intento real de `notifyTeam` (varios `fetch` secuenciales, uno
 * por número configurado), para no reintentar uno que en realidad sigue en
 * vuelo.
 */
const NOTIFY_ENVIANDO_HUERFANO_TRAS_MS = 5 * 60_000;

/** Intentos totales antes de dejar de reintentar solo (queda visible en `fallo_recuperable`). */
const NOTIFY_MAX_INTENTOS = 5;

/**
 * Fase urgente (4-sep-2026) — bug real corregido: la versión anterior de
 * esto era un `UPDATE` INCONDICIONAL (sin `WHERE notify_status IN (...)`),
 * llamado tanto por el primer intento (`pipeline.ts`, justo al cerrar el
 * pedido) como, indirectamente, por cada fila que reclamaba el barrido de
 * reintentos (`reintentarNotificacionesPendientes`) — dos code paths
 * DISTINTOS que podían procesar la MISMA fila sin que ninguno supiera del
 * otro: si el barrido reclamaba una fila recién insertada (todavía
 * `pendiente`) justo antes de que el propio turno que la creó llamara a
 * `intentarNotificarPedido`, las dos ejecuciones llamaban a `notifyTeam` —
 * el mismo pedido, avisado dos (o tres) veces al equipo.
 *
 * Ahora hay UNA sola autoridad para "quién tiene derecho a enviar": este
 * `UPDATE ... WHERE notify_status IN (...) RETURNING` — atómico en
 * Postgres por diseño (la fila queda bloqueada mientras se evalúa el
 * `WHERE`, así que una segunda ejecución concurrente del MISMO `UPDATE`
 * espera, y al aplicarse ve el estado ya cambiado a `'enviando'` — su
 * propio `WHERE` deja de calzar y no afecta ninguna fila). Se usa
 * IDÉNTICA, tanto desde el primer intento como desde cada candidato del
 * barrido — nunca dos lógicas de claim distintas.
 */
async function reclamarNotificacion(id: string): Promise<boolean> {
  const db = getDb();
  const filas = (await db.execute(sql`
    UPDATE order_confirmation
       SET notify_status = 'enviando',
           notify_attempts = notify_attempts + 1,
           updated_at = now()
     WHERE id = ${id}
       AND (
             notify_status IN ('pendiente', 'fallo_recuperable')
             OR (
                  notify_status = 'enviando'
                  AND updated_at < now() - make_interval(secs => ${NOTIFY_ENVIANDO_HUERFANO_TRAS_MS} / 1000.0)
                )
           )
       AND notify_attempts < ${NOTIFY_MAX_INTENTOS}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return filas.length > 0;
}

/**
 * `sent > 0` de `NotifyResult` — al menos un número ACEPTÓ el envío. Esto
 * es "aceptado por el proveedor", no "leído por la persona": la propia
 * `notifyTeam` ya lo documenta así (sin plantilla, WhatsApp puede rechazar
 * el mensaje después por la ventana de 24h) — este estado no inventa una
 * garantía de entrega que la API no ofrece.
 */
async function marcarNotificacionEnviada(id: string, detalle: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.orderConfirmation)
    .set({
      notifyStatus: "enviado",
      notifiedAt: new Date(),
      notifyDetail: detalle,
      updatedAt: new Date(),
    })
    .where(eq(schema.orderConfirmation.id, id));
}

async function marcarNotificacionFallida(id: string, error: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.orderConfirmation)
    .set({ notifyStatus: "fallo_recuperable", notifyDetail: error.slice(0, 2000), updatedAt: new Date() })
    .where(eq(schema.orderConfirmation.id, id));
}

/**
 * El intento REAL de notificación, con la máquina de estados aplicada.
 * Usada tanto por el cierre del turno (`pipeline.ts`, primer intento) como
 * por `reintentarNotificacionesPendientes` (reintentos posteriores) — el
 * MISMO código, con el MISMO claim atómico (`reclamarNotificacion`) para
 * ambos casos: nunca hay una lógica de claim en el pipeline y otra en el
 * worker.
 *
 * `estado: "ya_reclamado"` es el resultado cuando ESTE llamador perdió la
 * carrera (otro proceso ya tiene o ya completó el envío) — en ese caso NO
 * se llama a `notifyTeam` en absoluto. Nunca lanza: un fallo de
 * `notifyTeam` (que ya de por sí no lanza, ver `notify-team.ts`) o de esta
 * función se refleja en el estado guardado, no en una excepción.
 */
export async function intentarNotificarPedido(fila: {
  id: string;
  organizationId: string;
  summary: string;
  customerPhone: string | null;
}): Promise<{
  estado: "enviado" | "fallo_recuperable" | "ya_reclamado";
  sent: number;
  failed: number;
  detail: string;
}> {
  const reclamado = await reclamarNotificacion(fila.id);
  if (!reclamado) {
    return {
      estado: "ya_reclamado",
      sent: 0,
      failed: 0,
      detail: "otro proceso ya tiene o ya completó el envío de esta notificación",
    };
  }
  try {
    const resultado = await notifyTeam({
      organizationId: fila.organizationId,
      summary: fila.summary,
      customerPhone: fila.customerPhone,
    });
    if (resultado.sent > 0) {
      await marcarNotificacionEnviada(fila.id, resultado.detail);
      return { estado: "enviado", ...resultado };
    }
    await marcarNotificacionFallida(fila.id, resultado.detail);
    return { estado: "fallo_recuperable", ...resultado };
  } catch (err) {
    // `notifyTeam` no debería lanzar nunca (ver su propio comentario), pero
    // si algo inesperado lo hiciera, no se pierde el rastro: la fila queda
    // en `fallo_recuperable`, no en `enviando` para siempre.
    const mensaje = err instanceof Error ? err.message : String(err);
    await marcarNotificacionFallida(fila.id, mensaje);
    return { estado: "fallo_recuperable", sent: 0, failed: 1, detail: mensaje };
  }
}

/**
 * Barrido periódico (llamado desde `worker.ts`, igual que `rescatarHuerfanos`).
 *
 * Fase urgente (4-sep-2026) — a diferencia de la versión anterior, esto ya
 * NO reclama en bloque ("marcar muchas como `enviando`, luego procesar una
 * por una"): la `SELECT` de abajo es de solo lectura, ve candidatos sin
 * tocar nada, y el claim real ocurre uno por uno dentro de
 * `intentarNotificarPedido` — exactamente el mismo camino que usa el
 * primer intento. Si dos réplicas del worker corren este barrido a la vez
 * y ven el mismo candidato, ambas intentan reclamarlo, pero el `UPDATE`
 * atómico de `reclamarNotificacion` garantiza que solo una lo consiga; la
 * otra recibe `estado: "ya_reclamado"` y sigue con el siguiente candidato
 * sin haber llamado nunca a `notifyTeam`.
 *
 * Excluye a propósito las conversaciones de prueba (`conversation.is_test`):
 * el Laboratorio simula el aviso sin enviar nada (Constitución, sandbox),
 * así que sus filas se quedarían en `pendiente` para siempre sin que eso
 * sea un fallo — reintentarlas sería trabajo real sobre datos que nunca
 * debían salir.
 */
export async function reintentarNotificacionesPendientes(): Promise<number> {
  const db = getDb();
  const candidatos = (await db.execute(sql`
    SELECT oc.id, oc.organization_id, oc.summary, oc.customer_phone
      FROM order_confirmation oc
      JOIN conversation c ON c.id = oc.conversation_id
     WHERE c.is_test = false
       AND (
             oc.notify_status IN ('pendiente', 'fallo_recuperable')
             OR (
                  oc.notify_status = 'enviando'
                  AND oc.updated_at < now() - make_interval(secs => ${NOTIFY_ENVIANDO_HUERFANO_TRAS_MS} / 1000.0)
                )
           )
       AND oc.notify_attempts < ${NOTIFY_MAX_INTENTOS}
  `)) as unknown as Array<{
    id: string;
    organization_id: string;
    summary: string | null;
    customer_phone: string | null;
  }>;

  let procesadas = 0;
  for (const fila of candidatos) {
    const r = await intentarNotificarPedido({
      id: fila.id,
      organizationId: fila.organization_id,
      summary: fila.summary ?? "(pedido confirmado — sin resumen guardado)",
      customerPhone: fila.customer_phone,
    });
    if (r.estado !== "ya_reclamado") procesadas++;
  }
  return procesadas;
}
