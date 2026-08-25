import { describe, expect, it } from "vitest";
import { AgentAction } from "@/server/ai/actions";

/**
 * `send_menu` degrada a `reply` cuando el menú no cabe en los límites de
 * WhatsApp o no hay ficha.menu/catálogo (ver pipeline.ts). Sin `reply` de
 * respaldo esa degradación deja al cliente sin una sola palabra — el mismo
 * fallo que ya cerró el guardarraíl del turno mudo
 * (docs/korexia/133-TURNO-MUDO-SIN-REPLY.md), aquí evitado desde el esquema.
 */
describe("send_menu: sin reply no es una acción válida", () => {
  it("la rechaza cuando no trae reply", () => {
    const r = AgentAction.safeParse({ action: "send_menu", tipo: "intenciones" });
    expect(r.success).toBe(false);
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
});
