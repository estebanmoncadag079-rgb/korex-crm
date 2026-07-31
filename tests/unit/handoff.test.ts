import { describe, expect, it } from "vitest";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { isReturnToAgentPhrase } from "@/server/inbox/handoff-policy";

describe("patrón de respaldo de handoff (FR-022 / SC-006)", () => {
  it.each([
    "quiero hablar con un humano",
    "¿puedo hablar con un asesor?",
    "necesito comunicarme con alguien",
    "quiero contactar a una persona real",
    "quiero hablar con alguien por favor",
    "me pasas a un asesor",
    "prefiero atención humana",
    "atencion humana por favor",
  ])("dispara: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(true);
  });

  it.each([
    "somos 4 personas", // el caso canónico que NO debe disparar
    "somos cuatro personas y queremos reservar",
    "¿tienen taladros?",
    "la persona que me atendió ayer fue amable",
    "mi humano favorito es mi hijo",
    "el asesor fiscal ya me cobró", // sin verbo de contacto ni "un asesor"
  ])("NO dispara: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(false);
  });
});

/**
 * Frases naturales para devolverle el turno al agente.
 *
 * Escribir "#bot" desde el celular se lo traga el cliente y queda rarísimo en
 * su chat, así que el dueño pidió (31-jul-2026) que frases de negocio normales
 * hagan lo mismo. Lo delicado es el equilibrio: deben reconocerse las formas
 * de decirlo que usa el equipo, sin dispararse con una frase cualquiera.
 */
describe("frases naturales que devuelven el turno", () => {
  const devuelven = [
    "te dejo con el agente para terminar tu pedido",
    "te dejo con un encargado para continuar tu pedido",
    "Te dejo con el asistente",
    "los dejo con el encargado",
    "te paso con el encargado",
    "te comunico con un asistente",
    "sigue con el bot",
    "continúa el asistente",
    "te atiende el encargado",
    "ya viene el encargado",
  ];
  for (const frase of devuelven) {
    it(`devuelve el turno: "${frase}"`, () => {
      expect(isReturnToAgentPhrase(frase)).toBe(true);
    });
  }

  /**
   * Lo que NO puede activarlo. Un falso positivo es peor que un falso
   * negativo: deja hablando al agente en medio de algo que estaba atendiendo
   * una persona, delante del cliente.
   */
  const noDevuelven = [
    "te dejo la dirección",
    "te dejo el número de cuenta",
    "ya te paso el total",
    "sigue lloviendo",
    "el pedido continúa en preparación",
    "te dejo con Juan",
    "dame un momento",
  ];
  for (const frase of noDevuelven) {
    it(`NO lo activa: "${frase}"`, () => {
      expect(isReturnToAgentPhrase(frase)).toBe(false);
    });
  }
});
