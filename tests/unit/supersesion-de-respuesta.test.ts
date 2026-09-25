import { describe, expect, it } from "vitest";
import { debeSuprimirRespuesta, entrantesNoProcesados } from "@/server/ai/pipeline";

/**
 * Supersesión de la respuesta (Bug 3) — SEGUNDA versión, por IDs (25-sep-2026).
 *
 * La primera versión (PR #18, revertida en PR #20) comparaba `created_at`
 * (microsegundos en Postgres) contra la marca del turno (Date de JS,
 * milisegundos): el propio mensaje procesado salía "más nuevo" que la marca,
 * cada reply se suprimía a sí mismo y el bot quedó MUDO en todos los negocios
 * ~3,5 h. Ahora "nuevo" se decide por IDENTIDAD: un entrante es nuevo si NO
 * está entre los que este turno procesó. La hora solo acota la consulta
 * (inclusiva), nunca decide.
 */

const T = new Date("2026-09-25T15:17:00.420Z"); // la marca, truncada a ms

describe("entrantesNoProcesados: nuevo = no procesado por este turno, por ID", () => {
  it("EL CASO QUE SILENCIÓ AL BOT: el propio mensaje, aunque la base lo devuelva con microsegundos 'más tarde', NO es nuevo", () => {
    // La base guardó .420650 µs; la marca es .420 ms. Por hora parecía nuevo.
    const mismo = { id: "msg_marian", createdAt: new Date("2026-09-25T15:17:00.421Z") };
    expect(entrantesNoProcesados([mismo], new Set(["msg_marian"]))).toEqual([]);
  });

  it("un mensaje que llegó mientras el turno pensaba SÍ es nuevo", () => {
    const procesado = { id: "msg_1", createdAt: T };
    const llegoDespues = { id: "msg_2", createdAt: new Date("2026-09-25T15:17:09.000Z") };
    expect(entrantesNoProcesados([procesado, llegoDespues], new Set(["msg_1"]))).toEqual([llegoDespues]);
  });

  it("una ráfaga ya procesada entera no deja nada nuevo", () => {
    const rafaga = ["a", "b", "c", "d"].map((id) => ({ id, createdAt: T }));
    expect(entrantesNoProcesados(rafaga, new Set(["a", "b", "c", "d"]))).toEqual([]);
  });
});

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
