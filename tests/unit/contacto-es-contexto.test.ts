import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

type Profile = Parameters<typeof buildAgentSystemPrompt>[0]["profile"];

/**
 * El perfil de WhatsApp es CONTEXTO del canal, no un dato del pedido.
 *
 * Mitad de prompt de la defensa que empezó en `nombre-de-perfil-no-es-dato`.
 * El texto que salía hasta el 24-sep-2026 decía, literalmente:
 *
 *     FICHA DEL CLIENTE (ya la tienes: no la preguntes):
 *     - Teléfono de WhatsApp: …
 *     - Nombre guardado: Luisa Duque
 *     Úsala para completar el resumen del pedido.
 *
 * Dos órdenes, las dos equivocadas: **no la preguntes** y **úsala para el
 * resumen**. Con eso, un contacto llamado "Luisa Duque" acababa siendo el
 * nombre del pedido de alguien que nunca dijo cómo se llamaba — y peor, en
 * `estado.datos.nombre`, dando por cumplido un requisito de cierre.
 *
 * El teléfono es distinto y se conserva: lo da el canal, es verificable y es
 * el mismo número con el que escribe. El NOMBRE de un perfil de WhatsApp lo
 * elige su dueño y no lo confirma nadie.
 */
const perfil = {
  name: "Negocio de prueba",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  hoursOpen: null,
  hoursClose: null,
  hoursDays: null,
  hoursOpenSunday: null,
  hoursCloseSunday: null,
} as unknown as Profile;

const prompt = (contact: { name: string | null; phone: string | null }) =>
  buildAgentSystemPrompt({ profile: perfil, kb: [], stages: [{ name: "Nuevo" }], contact });

describe("el nombre del perfil de WhatsApp no es un dato del pedido", () => {
  const CON_NOMBRE = { name: "Luisa Duque", phone: "573001112233" };

  it("BUG REAL: ya no se ordena usarlo para completar el pedido", () => {
    expect(prompt(CON_NOMBRE)).not.toMatch(/para completar el resumen del pedido/i);
  });

  it("ya no se le dice que NO pregunte el nombre", () => {
    expect(prompt(CON_NOMBRE)).not.toMatch(/ya la tienes: no la preguntes/i);
  });

  it("se rotula como CONTEXTO y se dice que no confirma nada", () => {
    const t = prompt(CON_NOMBRE);
    expect(t).toMatch(/CONTEXTO DEL CONTACTO/);
    expect(t).toMatch(/no confirma/i);
  });

  it("dice explícitamente que hay que preguntarlo si el negocio lo necesita", () => {
    expect(prompt(CON_NOMBRE)).toMatch(/pregúntaselo|pregúntalo/i);
  });

  it("el nombre sigue estando, para poder tratar al cliente por él", () => {
    // Degradarlo no es esconderlo: saludar por su nombre es lo normal.
    expect(prompt(CON_NOMBRE)).toContain("Luisa Duque");
  });

  it("REGRESIÓN: el teléfono del canal sigue siendo utilizable", () => {
    // Lo da el canal y es verificable, a diferencia del nombre de perfil.
    expect(prompt(CON_NOMBRE)).toContain("573001112233");
  });

  it("REGRESIÓN: sin teléfono visible, sigue el aviso de no inventarlo", () => {
    const t = prompt({ name: "Luisa Duque", phone: null });
    expect(t).toMatch(/no.{0,20}inventes|sin teléfono/i);
  });

  it("sin contacto, no aparece la sección", () => {
    // Se comprueba la CABECERA de la sección, no la frase suelta: el contrato
    // de acciones la menciona siempre para decir qué se puede usar y qué no.
    const t = buildAgentSystemPrompt({ profile: perfil, kb: [], stages: [{ name: "Nuevo" }] });
    expect(t).not.toContain("CONTEXTO DEL CONTACTO (de dónde escribe");
    expect(t).not.toMatch(/FICHA DEL CLIENTE \(/);
  });
});
