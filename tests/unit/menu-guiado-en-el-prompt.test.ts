import { describe, expect, it } from "vitest";
import { generarPerfil } from "@/server/ai/generador/generar";
import { idDeOpcionDeMenu, type FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * El menú guiado de WhatsApp (25-ago-2026) solo aparece en el prompt cuando
 * el negocio tiene `menu_mode='guiado'` (opciones.menuGuiado) Y declaró
 * opciones en `ficha.menu` — sin eso, el agente sigue saludando con texto
 * libre como siempre. Nace del incidente de Lis: un menú que el cliente TOCA
 * no depende de que el modelo interprete un sinónimo.
 */
function ficha(extra: Partial<FichaDelNegocio>): FichaDelNegocio {
  return {
    nombre: "Negocio de prueba",
    queVende: "Vende cosas.",
    ubicacion: "Una dirección",
    horario: { abre: "09:00", cierra: "18:00", dias: [1, 2, 3, 4, 5] },
    vertical: "pedidos",
    catalogo: "Algo — $10.000",
    entrega: { haceDomicilios: false },
    pago: { formas: "efectivo", compruebaUnaPersona: false },
    tono: "cercano",
    saludoInicial: "Hola",
    reglasPropias: [],
    preguntasFrecuentes: [],
    escalarSiempre: [],
    nuncaPrometer: [],
    ...extra,
  } as FichaDelNegocio;
}

const MENU = { opciones: [{ id: "pedido", etiqueta: "Hacer un pedido" }] };

describe("el menú guiado en el prompt", () => {
  it("con menu_mode='guiado' pero sin ficha.menu, no aparece nada", () => {
    const p = generarPerfil(ficha({}), { menuGuiado: true }).instructions;
    expect(p).not.toContain("send_menu");
  });

  it("con ficha.menu pero sin menu_mode='guiado', no aparece nada", () => {
    const p = generarPerfil(ficha({ menu: MENU })).instructions;
    expect(p).not.toContain("send_menu");
  });

  it("con las dos condiciones, instruye a usar send_menu", () => {
    const p = generarPerfil(ficha({ menu: MENU }), { menuGuiado: true }).instructions;
    expect(p).toContain("send_menu");
    expect(p).toMatch(/tipo: "intenciones"/);
    expect(p).toMatch(/tipo: "catalogo"/);
  });

  it("en citas nunca aparece, aunque las dos condiciones estén dadas", () => {
    const p = generarPerfil(ficha({ vertical: "citas", menu: MENU }), {
      menuGuiado: true,
      vertical: "citas",
    }).instructions;
    expect(p).not.toContain("send_menu");
  });
});

describe("idDeOpcionDeMenu", () => {
  it("deriva un id legible de la etiqueta, sin tildes ni espacios", () => {
    expect(idDeOpcionDeMenu("Preguntas Frecuentes", new Set())).toBe("preguntas_frecuentes");
  });

  it("evita chocar con ids ya usados", () => {
    const existentes = new Set(["hacer_un_pedido"]);
    expect(idDeOpcionDeMenu("Hacer un pedido", existentes)).toBe("hacer_un_pedido_2");
  });
});
