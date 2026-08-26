import { describe, expect, it } from "vitest";
import { AgentAction } from "@/server/ai/actions";

/**
 * `send_menu` SIN `reply` es una acción VÁLIDA (docs/korexia/144) — al
 * revés de como nació el 25-ago-2026. Exigir `reply` en el esquema
 * convertía su ausencia intermitente en un turno perdido: en el camino de
 * la Fase 2 (`chatJsonConEstado`) no hay red de reintentos para esto —
 * validó "Hola, buenas noches" contra Lis y escaló el 71% de las veces.
 *
 * El dato tiene fallback determinista y seguro en cada uno de sus usos
 * reales (`armarMenuDeIntenciones`/`armarMenuDeCatalogo`/
 * `armarMenuDeCategoria`, y `pipeline.ts` en la degradación) — así que ya
 * no hace falta rechazar la acción entera por este campo.
 */
describe("send_menu: reply es opcional", () => {
  it("la acepta sin reply — el backend ya tiene un fallback seguro", () => {
    const r = AgentAction.safeParse({ action: "send_menu", tipo: "intenciones" });
    expect(r.success).toBe(true);
  });

  it("la acepta con reply y un tipo válido", () => {
    const r = AgentAction.safeParse({
      action: "send_menu",
      tipo: "catalogo",
      reply: "¡Claro! Aquí tienes nuestro menú 🍰",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza un tipo que no sea 'intenciones' ni 'catalogo'", () => {
    const r = AgentAction.safeParse({ action: "send_menu", tipo: "otro", reply: "hola" });
    expect(r.success).toBe(false);
  });

  it("acepta categoria (nivel 2, catálogos grandes) como opcional", () => {
    const r = AgentAction.safeParse({
      action: "send_menu",
      tipo: "catalogo",
      categoria: "Cremosos",
      reply: "¡Claro! Esto tenemos en cremosos 🍨",
    });
    expect(r.success).toBe(true);
  });
});
