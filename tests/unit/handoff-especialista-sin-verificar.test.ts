import { describe, expect, it } from "vitest";
import { handoffPorHechoDeEspecialistaSinVerificar } from "@/server/ai/anuncio-de-cierre";

/**
 * Tercera cara de `afirmaConEspecialistaSinVerificar`/`niegaDisponibilidadSinVerificar`
 * (ver `especialista-sin-verificar.test.ts` y `niega-disponibilidad-sin-verificar.test.ts`):
 * el modelo puede escalar a una persona en vez de responder, cuando el
 * motivo interno del handoff (`action.reason`, la nota que lee el equipo,
 * NUNCA el cliente) depende de si un especialista real existe, atiende
 * cierto servicio, o tiene cupo — sin haberlo consultado contra el backend.
 *
 * Caso real que motivó esto (Lashes Valen, 30-ago-2026, conv
 * cv_p5k7bbyvh09pr4f4de72): especialista archivado 5 días antes, el modelo
 * escaló con reason="Confirmar si Laura existe, si puede atender esos
 * servicios y su disponibilidad para lunes por la tarde" sin haber llamado
 * nunca a `consult_availability`.
 *
 * Igual que las dos funciones hermanas: esta SOLO mira el texto del motivo,
 * nunca decide por sí sola — la barrera real (`consultas === 0` en ese
 * turno) vive en `pipeline.ts`, con acceso al hecho.
 */

const NOMBRES = ["Geimar", "Hilary", "Laura", "Valentina"];

describe("handoffPorHechoDeEspecialistaSinVerificar", () => {
  it("caza el mensaje exacto que salió a producción (Laura archivada, sin consultar)", () => {
    const reason =
      "Cliente (Ana Torres, +573000000101) solicita cita con Laura para 'manos y pies' el lunes en horas de la tarde. No especificó qué servicio del catálogo quiere para cada uno. Confirmar si Laura existe, si puede atender esos servicios y su disponibilidad para lunes por la tarde.";
    expect(handoffPorHechoDeEspecialistaSinVerificar(reason, NOMBRES)).toBe(true);
  });

  it("caza una negación categórica sin verificar en el motivo (no solo dudas)", () => {
    const reason = "Laura no atiende ese servicio y no hay cupo con ella esta semana.";
    expect(handoffPorHechoDeEspecialistaSinVerificar(reason, NOMBRES)).toBe(true);
  });

  it("NO caza un handoff porque el cliente pidió explícitamente hablar con una persona", () => {
    const reason = "El cliente pidió explícitamente hablar con alguien del equipo.";
    expect(handoffPorHechoDeEspecialistaSinVerificar(reason, NOMBRES)).toBe(false);
  });

  it("NO caza un handoff por un motivo del negocio que no depende de disponibilidad", () => {
    const reason =
      "Pregunta sobre alergias/irritación de piel: según las reglas de este negocio, siempre lo atiende una persona.";
    expect(handoffPorHechoDeEspecialistaSinVerificar(reason, NOMBRES)).toBe(false);
  });

  it("NO caza un handoff por fuera de horario", () => {
    const reason = "El negocio está cerrado en este momento; se retoma mañana.";
    expect(handoffPorHechoDeEspecialistaSinVerificar(reason, NOMBRES)).toBe(false);
  });

  it("NO caza si el motivo menciona a la especialista pero no depende de un hecho verificable", () => {
    // Nombra a Laura, pero la razón de escalar es otra (una queja), no su
    // existencia/atención/disponibilidad.
    const reason = "Laura atendió a la clienta pero hubo una queja sobre el resultado del servicio.";
    expect(handoffPorHechoDeEspecialistaSinVerificar(reason, NOMBRES)).toBe(false);
  });

  it("no se cae con motivo vacío, nulo o sin nombres declarados", () => {
    expect(handoffPorHechoDeEspecialistaSinVerificar(null, NOMBRES)).toBe(false);
    expect(handoffPorHechoDeEspecialistaSinVerificar(undefined, NOMBRES)).toBe(false);
    expect(handoffPorHechoDeEspecialistaSinVerificar("", NOMBRES)).toBe(false);
    expect(
      handoffPorHechoDeEspecialistaSinVerificar("Confirmar si Laura tiene disponibilidad.", [])
    ).toBe(false);
  });

  it("no confunde el nombre con una palabra que lo contiene", () => {
    expect(
      handoffPorHechoDeEspecialistaSinVerificar(
        "Confirmar si Lauraceae tiene disponibilidad.",
        NOMBRES
      )
    ).toBe(false);
  });
});
