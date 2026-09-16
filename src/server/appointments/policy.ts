/**
 * T018 (feature 003-backend-como-autoridad, Principio 7) — el equivalente de
 * `orders/policy.ts` (`puedeConfirmarPedido`, T017) para citas: antes de
 * agendar de verdad (`book_appointment`, `pipeline.ts`), exige que la HOJA
 * guardada (`EstadoDelPedido`, ya resuelta por el motor de operaciones,
 * `appointments/operaciones.ts` T008-T010) tenga servicio resuelto, un
 * horario que el backend ya verificó, y los requisitos obligatorios
 * cubiertos — no el texto libre que traiga la acción del modelo.
 *
 * A diferencia de pedidos, citas NO necesita el chequeo de "¿ya se confirmó
 * antes y el cliente solo comenta?": la idempotencia de una reserva ya la
 * resuelve `registrarConfirmacionDeCita` por lote de mensajes disparadores
 * (`appointment_booking_confirmation`, `claveDeConfirmacionDeCita`,
 * `confirmacion-de-cita.ts`) — un mecanismo distinto, ya suficiente, y este
 * archivo no lo toca ni lo duplica.
 *
 * Síncrona a propósito, a diferencia de `puedeConfirmarPedido`: no consulta
 * la base — todo lo que necesita ya viene resuelto en `EstadoDelPedido`.
 *
 * `estadoGuardado` ausente/`null` = `state_source !== 'backend'` (el caso
 * real de todos los negocios de citas hoy): no se exige nada nuevo, y
 * `book_appointment` sigue exactamente como está.
 */
import type { EstadoDelPedido } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";

export type VeredictoDeCita = { ok: true } | { ok: false; motivo: string; correccion: string };

export function puedeConfirmarCita(input: {
  estadoGuardado?: EstadoDelPedido | null;
  requisitos?: Requisito[];
}): VeredictoDeCita {
  if (!input.estadoGuardado) return { ok: true };
  const estado = input.estadoGuardado;

  if (estado.items.length === 0) {
    return {
      ok: false,
      motivo: "la reserva no tiene ningún servicio resuelto",
      correccion:
        "[SISTEMA] Todavía no se ha elegido ningún servicio para esta cita — pregúntale al cliente cuál quiere antes de agendar.",
    };
  }
  if (!estado.reserva?.fecha || !estado.reserva?.hora) {
    return {
      ok: false,
      motivo: "la reserva no tiene un horario verificado por el backend",
      correccion:
        "[SISTEMA] Todavía no hay una fecha y hora que el sistema haya verificado — no agendes con un horario que no hayas confirmado con consult_availability.",
    };
  }
  const faltantes = (input.requisitos ?? []).filter(
    (r) => r.obligatorio && !estado.datos[r.id]?.trim()
  );
  if (faltantes.length > 0) {
    return {
      ok: false,
      motivo: `faltan requisitos obligatorios: ${faltantes.map((r) => r.id).join(", ")}`,
      correccion: `[SISTEMA] Todavía falta antes de agendar: ${faltantes.map((r) => r.etiqueta).join(", ")}. Pregúntaselo al cliente.`,
    };
  }
  return { ok: true };
}
