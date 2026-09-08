import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { notifyTeam } from "@/server/ai/notify-team";

/**
 * Programa de mejora integral, Prioridad 5 — idempotencia REAL de
 * `book_appointment`, a nivel de Postgres. Mismo patrón EXACTO que
 * `confirmacion-de-pedido.ts` (Fase 10N-A/D) — no se generaliza esa tabla ni
 * esa función para no tocar un camino ya probado en producción; se clona el
 * diseño en su propia tabla.
 *
 * El riesgo real (auditoría 10U): un turno vivo puede tardar más que
 * `HUERFANO_TRAS_MS` (guardarraíles encadenados, cada uno con su propio
 * reintento de `chatJson` — ver el comentario en `cola.ts`), así que
 * `rescatarHuerfanos` puede reasignar un turno que en realidad sigue vivo
 * (Fase 10Q ya protege que ambos NO puedan `completarTrabajo`/`fallarTrabajo`
 * el mismo `agent_job`, pero eso no impide que el worker "huérfano", si
 * sigue vivo, YA haya ejecutado `crearCitaMultiple` antes de perder la
 * carrera). Si el turno se reintenta desde cero (`runAgentTurn` completo) y
 * el segundo intento pide un horario DISTINTO al ya reservado, el `EXCLUDE`
 * de `appointment_resource` no lo detecta — sería una segunda cita real,
 * duplicada en intención. Esta idempotencia cierra esa ventana: el mismo
 * lote de mensajes del cliente nunca dispara una segunda ejecución de
 * `crearCitaMultiple` para las mismas reservas.
 *
 * Fase 6B (auditoría de reconciliación) — hasta ahora "la cita quedó
 * registrada" (esta fila existe) y "el equipo recibió el aviso" (la llamada
 * a `notifyTeam`, dentro de `avisarYConfirmar` en `pipeline.ts`) eran, otra
 * vez, la MISMA cosa — exactamente el defecto que `confirmacion-de-pedido.ts`
 * ya había cerrado para pedidos (Fase 11-B) pero que esta tabla, clonada
 * ANTES de esa corrección, nunca replicó: si `notifyTeam` fallaba después de
 * `registrarConfirmacionDeCita`, la cita quedaba agendada de verdad, pero el
 * aviso se perdía en silencio y sin ningún reintento. `notifyStatus` (mismas
 * columnas que `orderConfirmation`, ver `schema.ts`) cierra esa misma
 * ventana aquí, con el mismo mecanismo de reintento
 * (`reintentarNotificacionesDeCitaPendientes`, corre desde `worker.ts`).
 *
 * Fase 8A (auditoría funcional transversal) — `reschedule_appointment` y
 * `cancel_appointment` reutilizan exactamente este mismo mecanismo (mismo
 * `UNIQUE(conversationId, idempotencyKey)`, mismo `notifyStatus`, mismo
 * `intentarNotificarCita`/reintento) en vez de clonar una tabla nueva: antes
 * de esta fase usaban `notifyTeam` directo en `pipeline.ts`, sin registro ni
 * reintento — si fallaba, la cita quedaba reprogramada/cancelada de verdad,
 * pero el equipo nunca se enteraba. `kind` (ver `schema.ts`) distingue de
 * qué operación es cada fila; no participa en la clave de unicidad, que ya
 * distingue cada lote de mensajes disparadores por sí solo.
 */

/** IDs de mensaje, ordenados y unidos, para que el orden de llegada no cambie la clave. */
export function claveDeConfirmacionDeCita(messageIds: string[]): string {
  const normalizado = [...messageIds].sort().join(",");
  return createHash("sha256").update(normalizado).digest("hex");
}

/**
 * Registra el intento de agendar. `primeraVez: true` solo la primera vez
 * que este lote de mensajes disparadores, en esta conversación, se registra
 * — el llamante debe usarlo para decidir si de verdad intenta crear las
 * citas, o si ya se hizo y no hay que repetirlo.
 *
 * Nunca lanza por un conflicto de duplicado (`onConflictDoNothing`): un
 * segundo intento simplemente devuelve `primeraVez: false`, no un error.
 *
 * Fase 6B — `summary`/`customerPhone` se guardan en el momento del registro,
 * igual que `registrarConfirmacionDePedido`: es el contenido EXACTO que un
 * reintento posterior del aviso debe mandar, nunca algo recalculado.
 * Opcionales por el mismo motivo que en pedidos: una prueba que solo quiera
 * probar la idempotencia en sí no debería tener que inventar un resumen.
 */
export async function registrarConfirmacionDeCita(input: {
  organizationId: string;
  conversationId: string;
  messageIds: string[];
  /** Fase 8A — qué operación es. Default `"reserva"`: ningún llamador existente cambia de comportamiento. */
  kind?: "reserva" | "reprogramacion" | "cancelacion";
  summary?: string;
  customerPhone?: string | null;
}): Promise<{ primeraVez: boolean; id: string }> {
  const db = getDb();
  const idempotencyKey = claveDeConfirmacionDeCita(input.messageIds);
  const inserted = await db
    .insert(schema.appointmentBookingConfirmation)
    .values({
      id: newId("appointmentBookingConfirmation"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      idempotencyKey,
      kind: input.kind ?? "reserva",
      summary: input.summary ?? null,
      customerPhone: input.customerPhone ?? null,
    })
    .onConflictDoNothing({
      target: [
        schema.appointmentBookingConfirmation.conversationId,
        schema.appointmentBookingConfirmation.idempotencyKey,
      ],
    })
    .returning({ id: schema.appointmentBookingConfirmation.id });

  if (inserted.length > 0) {
    return { primeraVez: true, id: inserted[0]!.id };
  }
  // Ya existía: `onConflictDoNothing` no devuelve la fila en conflicto, hay
  // que leerla aparte para que el llamante sepa a qué fila referirse.
  const [existente] = await db
    .select({ id: schema.appointmentBookingConfirmation.id })
    .from(schema.appointmentBookingConfirmation)
    .where(
      and(
        eq(schema.appointmentBookingConfirmation.conversationId, input.conversationId),
        eq(schema.appointmentBookingConfirmation.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  // No puede faltar: si `onConflictDoNothing` disparó, la fila conflictiva
  // existe por definición.
  return { primeraVez: false, id: existente!.id };
}

/**
 * Fase 6B — el `summary`/`customerPhone` del aviso no se conocen todavía en
 * `registrarConfirmacionDeCita` (se arman DESPUÉS, con el resultado real de
 * `crearCitaMultiple` — cuáles servicios quedaron agendados, con quién, a
 * qué hora). Esto los guarda en la fila una sola vez, justo antes de
 * intentar el primer aviso, para que un reintento posterior
 * (`reintentarNotificacionesDeCitaPendientes`, que los lee DE la fila) mande
 * exactamente el mismo contenido — nunca algo recalculado.
 */
export async function guardarContenidoDeCita(
  id: string,
  summary: string,
  customerPhone: string | null
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.appointmentBookingConfirmation)
    .set({ summary, customerPhone })
    .where(eq(schema.appointmentBookingConfirmation.id, id));
}

/**
 * Fase 10V, Hallazgo D (auditoría) — deshace un registro de idempotencia
 * cuando el efecto real NUNCA llegó a intentarse de verdad (una excepción
 * genuina, no un rechazo normal como "sin_cupo"/"fuera_de_horario", que ya
 * se reporta como `fallidas` sin lanzar). Sin esto, la ventana real era:
 * `registrarConfirmacionDeCita` deja `primeraVez:true` → `crearCitaMultiple`
 * lanza un error inesperado (no el `EXCLUDE` manejado, algo distinto — una
 * caída real de conexión, por ejemplo) → el job se reintenta (Fase 10Q) →
 * el reintento ve `primeraVez:false` (la clave YA está tomada) → nunca
 * vuelve a intentar crear la cita, PARA SIEMPRE — el cliente se queda sin
 * cita y sin ningún reintento posible.
 *
 * Solo se usa cuando NINGUNA reserva del lote llegó a crearse (ver el
 * llamador): si alguna sí se creó antes de que otra fallara, deshacer la
 * clave arriesgaría una creación duplicada de la que SÍ tuvo éxito en el
 * reintento — ahí se prefiere dejar esa reserva puntual sin reintento
 * automático (documentado como riesgo residual, no corregido aquí: exige
 * saber qué reserva específica del lote falló, un cambio mayor que esta
 * fase no improvisa).
 */
export async function borrarConfirmacionDeCita(input: {
  conversationId: string;
  messageIds: string[];
}): Promise<void> {
  const db = getDb();
  const idempotencyKey = claveDeConfirmacionDeCita(input.messageIds);
  await db
    .delete(schema.appointmentBookingConfirmation)
    .where(
      and(
        eq(schema.appointmentBookingConfirmation.conversationId, input.conversationId),
        eq(schema.appointmentBookingConfirmation.idempotencyKey, idempotencyKey)
      )
    );
}

/**
 * Fase 6B — mismas constantes que `confirmacion-de-pedido.ts` (mismo
 * criterio: mayor que cualquier intento real de `notifyTeam`, para no
 * reintentar uno que en realidad sigue en vuelo).
 */
const NOTIFY_ENVIANDO_HUERFANO_TRAS_MS = 5 * 60_000;
const NOTIFY_MAX_INTENTOS = 5;

/**
 * Mismo mecanismo de claim atómico que `reclamarNotificacion` (pedidos):
 * una sola autoridad para "quién tiene derecho a enviar", vía
 * `UPDATE ... WHERE notify_status IN (...) RETURNING`, para que el primer
 * intento (desde `pipeline.ts`) y el barrido de reintentos nunca puedan
 * llamar a `notifyTeam` dos veces para la misma fila.
 */
async function reclamarNotificacionDeCita(id: string): Promise<boolean> {
  const db = getDb();
  const filas = (await db.execute(sql`
    UPDATE appointment_booking_confirmation
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

async function marcarNotificacionDeCitaEnviada(id: string, detalle: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.appointmentBookingConfirmation)
    .set({
      notifyStatus: "enviado",
      notifiedAt: new Date(),
      notifyDetail: detalle,
      updatedAt: new Date(),
    })
    .where(eq(schema.appointmentBookingConfirmation.id, id));
}

async function marcarNotificacionDeCitaFallida(id: string, error: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.appointmentBookingConfirmation)
    .set({ notifyStatus: "fallo_recuperable", notifyDetail: error.slice(0, 2000), updatedAt: new Date() })
    .where(eq(schema.appointmentBookingConfirmation.id, id));
}

/**
 * El intento REAL de aviso al equipo, con la máquina de estados aplicada —
 * mismo diseño que `intentarNotificarPedido`. Usada tanto por el cierre del
 * turno (`pipeline.ts`, primer intento tras crear la cita) como por
 * `reintentarNotificacionesDeCitaPendientes` (reintentos posteriores): el
 * MISMO código, con el MISMO claim atómico para ambos casos.
 *
 * `estado: "ya_reclamado"` es el resultado cuando ESTE llamador perdió la
 * carrera — en ese caso NO se llama a `notifyTeam` en absoluto. Nunca lanza:
 * un fallo de `notifyTeam` o de esta función se refleja en el estado
 * guardado, no en una excepción — la cita ya está agendada de verdad, no
 * hay ninguna razón para tumbar el turno por esto.
 */
export async function intentarNotificarCita(fila: {
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
  const reclamado = await reclamarNotificacionDeCita(fila.id);
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
      await marcarNotificacionDeCitaEnviada(fila.id, resultado.detail);
      return { estado: "enviado", ...resultado };
    }
    await marcarNotificacionDeCitaFallida(fila.id, resultado.detail);
    return { estado: "fallo_recuperable", ...resultado };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await marcarNotificacionDeCitaFallida(fila.id, mensaje);
    return { estado: "fallo_recuperable", sent: 0, failed: 1, detail: mensaje };
  }
}

/**
 * Barrido periódico (llamado desde `worker.ts`, igual que
 * `reintentarNotificacionesPendientes` de pedidos). Misma exclusión de
 * conversaciones de prueba: el Laboratorio simula el aviso sin enviar nada.
 */
export async function reintentarNotificacionesDeCitaPendientes(): Promise<number> {
  const db = getDb();
  const candidatos = (await db.execute(sql`
    SELECT abc.id, abc.organization_id, abc.summary, abc.customer_phone
      FROM appointment_booking_confirmation abc
      JOIN conversation c ON c.id = abc.conversation_id
     WHERE c.is_test = false
       AND (
             abc.notify_status IN ('pendiente', 'fallo_recuperable')
             OR (
                  abc.notify_status = 'enviando'
                  AND abc.updated_at < now() - make_interval(secs => ${NOTIFY_ENVIANDO_HUERFANO_TRAS_MS} / 1000.0)
                )
           )
       AND abc.notify_attempts < ${NOTIFY_MAX_INTENTOS}
  `)) as unknown as Array<{
    id: string;
    organization_id: string;
    summary: string | null;
    customer_phone: string | null;
  }>;

  let procesadas = 0;
  for (const fila of candidatos) {
    const r = await intentarNotificarCita({
      id: fila.id,
      organizationId: fila.organization_id,
      summary: fila.summary ?? "(cita agendada — sin resumen guardado)",
      customerPhone: fila.customer_phone,
    });
    if (r.estado !== "ya_reclamado") procesadas++;
  }
  return procesadas;
}
