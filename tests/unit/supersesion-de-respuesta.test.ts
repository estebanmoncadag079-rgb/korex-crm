import { describe, expect, it } from "vitest";
import { debeSuprimirRespuesta } from "@/server/ai/pipeline";

/**
 * Supersesión de la respuesta (Bug 3, 25-sep-2026).
 *
 * El cliente escribe en ráfaga; el modelo tarda 15-30 s. Un mensaje que llega
 * MIENTRAS el turno piensa se vuelve un turno aparte y genera una segunda
 * respuesta casi idéntica (caso real Tatiana, 17-sep: dos veces "¿San Judas I
 * o II?" con 8 s de diferencia).
 *
 * Arreglo: justo antes de enviar, si llegaron mensajes nuevos sin responder,
 * NO se envía esta respuesta —ya nació incompleta— y contesta el turno que la
 * cola ya encoló para esos mensajes, una sola vez. Solo se suprime un `reply`
 * (respuesta conversacional): las acciones con efecto (cierre, cita, handoff…)
 * nunca se suprimen. No aumenta el costo: la misma cantidad de turnos corre;
 * solo se dejan de enviar las respuestas redundantes.
 */

describe("debeSuprimirRespuesta: solo un reply, y solo si llegaron mensajes nuevos", () => {
  it("suprime un reply cuando llegaron mensajes nuevos", () => {
    expect(debeSuprimirRespuesta({ action: "reply", hayEntrantesNuevos: true })).toBe(true);
  });

  it("no suprime un reply si no llegó nada nuevo", () => {
    expect(debeSuprimirRespuesta({ action: "reply", hayEntrantesNuevos: false })).toBe(false);
  });

  it("NUNCA suprime una acción con efecto, aunque lleguen mensajes nuevos", () => {
    for (const action of ["notify_order", "book_appointment", "handoff", "move_stage", "update_lead"]) {
      expect(debeSuprimirRespuesta({ action, hayEntrantesNuevos: true }), action).toBe(false);
    }
  });
});
