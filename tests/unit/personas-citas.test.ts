import { describe, expect, it } from "vitest";
import {
  concretarPersona,
  contextoDeCitas,
  personasPara,
  reglasDe,
  type ServicioDelCatalogo,
} from "@/server/lab/personas";

/**
 * La clienta simulada de un salón pide servicios REALES, por su nombre.
 *
 * Nadie entra a un salón diciendo "deme lo más pedido": va por las uñas o por
 * las pestañas, y lo dice. Con guiones genéricos el agente nunca tenía que
 * reconocer un servicio dentro de una frase, que es la mitad de su trabajo.
 */

const CATALOGO: ServicioDelCatalogo[] = [
  { name: "Volumen Ruso", category: "Pestañas", priceCents: 13500000 },
  { name: "Semipermanente", category: "Uñas", priceCents: 4000000 },
  { name: "Cejas en Henna", category: "Cejas", priceCents: 3000000 },
];

const citas = personasPara("citas");
const decidido = citas.find((p) => p.key === "comprador_decidido")!;

describe("guiones de salón", () => {
  it("la clienta pide un servicio real del catálogo, no una intención vaga", () => {
    const p = concretarPersona(decidido, CATALOGO);
    expect(p.script[1]).toBe("Quiero agendar Volumen Ruso");
  });

  it("el que compara precios nombra el caro y el barato", () => {
    const pregunton = citas.find((p) => p.key === "pregunton_precios")!;
    const p = concretarPersona(pregunton, CATALOGO);
    expect(p.script[0]).toContain("Volumen Ruso");
    expect(p.script[1]).toContain("Cejas en Henna");
  });

  it("usa la categoría real cuando el guion habla de un tipo de servicio", () => {
    const humano = citas.find((p) => p.key === "pide_humano")!;
    const p = concretarPersona(humano, CATALOGO);
    expect(p.script[1]).toContain("pestañas");
  });

  /**
   * Lo que no puede pasar nunca: que una clienta escriba "{SERVICIO}" en el
   * chat. Sería un fallo del banco de pruebas leído como fallo del agente.
   */
  it("ningún marcador sobrevive a la sustitución, en ningún guion", () => {
    for (const persona of citas) {
      const p = concretarPersona(persona, CATALOGO);
      const textos = [
        ...p.script,
        ...reglasDe(p, CATALOGO).map((r) => r.responde),
      ];
      for (const t of textos) {
        expect(t, `en el guion "${persona.key}"`).not.toMatch(/\{[A-Z_]+\}/);
      }
    }
  });

  it("sin catálogo cargado el guion sigue siendo una frase legible", () => {
    const p = concretarPersona(decidido, []);
    expect(p.script[1]).toBe("Quiero agendar una cita");
    for (const linea of p.script) expect(linea).not.toMatch(/\{[A-Z_]+\}/);
  });

  it("con un solo servicio, el caro y el barato son el mismo (no se inventa otro)", () => {
    const ctx = contextoDeCitas([CATALOGO[0]!]);
    expect(ctx.SERVICIO).toBe("Volumen Ruso");
    expect(ctx.SERVICIO_BARATO).toBe("Volumen Ruso");
  });

  /** El Laboratorio no puede cambiar de resultado entre corridas iguales. */
  it("con precios empatados elige siempre el mismo, por nombre", () => {
    const empate: ServicioDelCatalogo[] = [
      { name: "Zafiro", category: "Uñas", priceCents: 5000000 },
      { name: "Ámbar", category: "Uñas", priceCents: 5000000 },
    ];
    expect(contextoDeCitas(empate).SERVICIO).toBe(
      contextoDeCitas([...empate].reverse()).SERVICIO
    );
  });

  it("los guiones de pedidos NO se tocan: ahí el catálogo lo recita el agente", () => {
    const pedidos = personasPara("pedidos")[0]!;
    expect(concretarPersona(pedidos, CATALOGO)).toBe(pedidos);
  });
});
