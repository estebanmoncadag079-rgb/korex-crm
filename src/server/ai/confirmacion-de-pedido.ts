import { createHash } from "node:crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

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
 */
export async function registrarConfirmacionDePedido(input: {
  organizationId: string;
  conversationId: string;
  messageIds: string[];
}): Promise<{ primeraVez: boolean }> {
  const db = getDb();
  const idempotencyKey = claveDeConfirmacionDePedido(input.messageIds);
  const inserted = await db
    .insert(schema.orderConfirmation)
    .values({
      id: newId("orderConfirmation"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      idempotencyKey,
    })
    .onConflictDoNothing({
      target: [schema.orderConfirmation.conversationId, schema.orderConfirmation.idempotencyKey],
    })
    .returning();
  return { primeraVez: inserted.length > 0 };
}
