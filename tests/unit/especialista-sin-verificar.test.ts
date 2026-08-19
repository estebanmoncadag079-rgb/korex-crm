import { describe, expect, it } from "vitest";

/**
 * El 19-ago-2026 un agente le dijo a una clienta "¡Perfecto! Un retoque de
 * Volumen Ruso con Hilary. ¿Para qué día y hora...?" — Hilary no atiende ese
 * servicio, y el modelo nunca llamó a `consult_availability` para
 * comprobarlo. El mismo día, otro caso peor: el agente dio horas concretas
 * para DOS especialistas distintas en el mismo mensaje, sin una sola
 * consulta de por medio.
 *
 * A diferencia de los guardarraíles anteriores, este no adivina por texto:
 * `afirmaConEspecialistaSinVerificar` solo detecta si la respuesta AFIRMA
 * (no pregunta) mencionando a una especialista real. La barrera real —que
 * `consultas === 0` en ese turno— vive en `pipeline.ts`, con acceso al
 * hecho, no al texto. Aquí se prueba la mitad que sí es pura: que la
 * función no confunda una promesa con una pregunta legítima.
 *
 * Los seis primeros casos son los mensajes REALES de la flota, medidos
 * antes de escribir el guardarraíl (docs/korexia/105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md).
 */

import { afirmaConEspecialistaSinVerificar } from "@/server/ai/anuncio-de-cierre";

const NOMBRES = ["Geimar", "Hilary", "Laura", "Valentina"];

describe("afirmaConEspecialistaSinVerificar: los casos reales de producción", () => {
  it("caza el mensaje exacto que salió a producción (Hilary/Volumen Ruso)", () => {
    expect(
      afirmaConEspecialistaSinVerificar(
        "¡Perfecto! Un retoque de Volumen Ruso con Hilary. ¿Para qué día y hora te gustaría agendar tu cita, hermosa? 💖",
        NOMBRES
      )
    ).toBe(true);
  });

  it("caza el caso más caro: dos especialistas y dos horas, sin una sola consulta", () => {
    const texto =
      "¡Perfecto, hermosa! Entendí tu idea. ✨\n\nPodríamos agendarte a ti el servicio Semipermanente (Uñas) para manos y pies con Geimar para el viernes 21 de agosto a las 3:30 p.m. 💅\n\nY a tu mami el servicio Semipermanente (Uñas) en manos con Laura, también el viernes 21 de agosto, podría ser a las 4:00 p.m. o 4:30 p.m. así llega contigo. ¿Qué te parece? 😊";
    expect(afirmaConEspecialistaSinVerificar(texto, NOMBRES)).toBe(true);
  });

  /*
   * El falso positivo que un regex de "frases de confirmación" habría
   * cometido: esta respuesta SÍ dice "Claro que sí" y SÍ nombra a Valentina,
   * pero no confirma nada — pregunta qué servicio quiere. Es exactamente el
   * flujo correcto tras resolver una ambigüedad (docs/korexia/104).
   */
  it("NO caza una pregunta legítima sobre qué servicio agendar", () => {
    expect(
      afirmaConEspecialistaSinVerificar(
        "¡Claro que sí, hermosa! 💖 ¿Qué tipo de servicio de pestañas te gustaría agendar con Valentina para mañana, jueves 20 de agosto? Así te confirmo la disponibilidad. ✨🎀",
        NOMBRES
      )
    ).toBe(false);
  });

  it("no cuenta si la única mención a la especialista está en una pregunta", () => {
    const soloPregunta =
      "¿Te gustaría agendar con Valentina o prefieres a otra especialista?";
    expect(afirmaConEspecialistaSinVerificar(soloPregunta, NOMBRES)).toBe(false);
  });

  it("sin ningún nombre real mencionado, no hay nada que cazar", () => {
    expect(
      afirmaConEspecialistaSinVerificar(
        "¡Perfecto! Tu retoque de Volumen Ruso quedó anotado. ¿Para qué día y hora te gustaría agendar?",
        NOMBRES
      )
    ).toBe(false);
  });

  it("un saludo inicial sin nada que confirmar no activa nada", () => {
    expect(
      afirmaConEspecialistaSinVerificar(
        "¡Hola hermosa! 👋 Soy el asistente de Lashes Valen. ¿En qué te puedo ayudar hoy? ✨💖",
        NOMBRES
      )
    ).toBe(false);
  });

  it("no se cae con texto vacío, nulo o sin nombres declarados", () => {
    expect(afirmaConEspecialistaSinVerificar(null, NOMBRES)).toBe(false);
    expect(afirmaConEspecialistaSinVerificar(undefined, NOMBRES)).toBe(false);
    expect(afirmaConEspecialistaSinVerificar("", NOMBRES)).toBe(false);
    expect(
      afirmaConEspecialistaSinVerificar("Perfecto, con Hilary a las 3pm.", [])
    ).toBe(false);
  });

  /*
   * Un nombre que aparece como PARTE de otra palabra no debe contar — la
   * comparación es por palabra completa, no por substring.
   */
  it("no confunde el nombre con una palabra que lo contiene", () => {
    // "Lauraceae" no es Laura. Caso sintético para blindar la comparación
    // por palabra completa, no por substring.
    expect(
      afirmaConEspecialistaSinVerificar("Perfecto, tu cita quedó con Lauraceae.", NOMBRES)
    ).toBe(false);
  });
});
