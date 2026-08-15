/**
 * El lector de variantes, contra el texto REAL de la ficha de La Churra.
 *
 * No es un texto inventado: está copiado tal cual de `agent_profile.ficha`,
 * con sus emojis, sus paréntesis explicativos y la frase que se pega al último
 * elemento. Un parser que funciona con un ejemplo limpio y falla con este no
 * sirve de nada.
 */
import { describe, expect, it } from "vitest";
import { leerCatalogoDeTexto } from "@/server/catalog/sembrar";

const VARIANTES_REALES = [
  "SALSAS (los nombres van SIEMPRE en MAYÚSCULAS): 🍯 AREQUIPE · 🍫 CHOCOLATE · 🐄 LECHERA · 🤍 CHOCOLATE BLANCO. Cada presentación incluye un número de salsas: la Churrita 1, la Besties 2, el Family Box 3 y el Mega Box 5.",
  "RECUBIERTO: ✨ Azúcar-canela · ✨ Azúcar sola · ✨ Ambas · ✨ Sin azúcar.",
  "ADICIONES (opcionales, se cobran aparte): 🍫 Salsa de CHOCOLATE $2.000 · 🐄 LECHERA $1.500 · 🍯 AREQUIPE $1.500 · 🤍 CHOCOLATE BLANCO $2.000 · 💧 Botella de agua $2.000.",
].join("\n");

const leido = () => leerCatalogoDeTexto("🥨 Churrita — $10.000 (6 churros · 1 salsa)", VARIANTES_REALES);

describe("SALSAS", () => {
  it("extrae las cuatro, sin emojis", () => {
    const g = leido().grupos.find((x) => x.nombre === "SALSAS")!;
    expect(g.opciones.map((o) => o.nombre)).toEqual([
      "AREQUIPE",
      "CHOCOLATE",
      "LECHERA",
      "CHOCOLATE BLANCO",
    ]);
  });

  it("la frase explicativa NO se cuela en la última salsa", () => {
    // Sin cortar por el punto, la última se llamaría "CHOCOLATE BLANCO. Cada
    // presentación incluye…" y el agente se la ofrecería al cliente así.
    const g = leido().grupos.find((x) => x.nombre === "SALSAS")!;
    expect(g.opciones.at(-1)!.nombre).toBe("CHOCOLATE BLANCO");
    expect(g.opciones.at(-1)!.nombre).not.toContain("presentación");
  });

  it("las salsas no cuestan aparte", () => {
    const g = leido().grupos.find((x) => x.nombre === "SALSAS")!;
    expect(g.opciones.every((o) => o.precioExtraCents === 0)).toBe(true);
  });
});

describe("RECUBIERTO", () => {
  it("se extrae como grupo propio", () => {
    const g = leido().grupos.find((x) => x.nombre === "RECUBIERTO");
    expect(g).toBeDefined();
    expect(g!.opciones.map((o) => o.nombre)).toEqual([
      "Azúcar-canela",
      "Azúcar sola",
      "Ambas",
      "Sin azúcar",
    ]);
  });

  it("es UNO, no cuatro: min 1 y max 1", () => {
    const g = leido().grupos.find((x) => x.nombre === "RECUBIERTO")!;
    expect(g.minimo).toBe(1);
    expect(g.maximo).toBe(1);
  });

  it("el punto final no se queda pegado", () => {
    const g = leido().grupos.find((x) => x.nombre === "RECUBIERTO")!;
    expect(g.opciones.at(-1)!.nombre).toBe("Sin azúcar");
  });
});

describe("ADICIONES", () => {
  it("se extraen las cinco con su precio", () => {
    const g = leido().grupos.find((x) => x.nombre === "ADICIONES")!;
    expect(g.opciones).toEqual([
      { nombre: "Salsa de CHOCOLATE", precioExtraCents: 200000 },
      { nombre: "LECHERA", precioExtraCents: 150000 },
      { nombre: "AREQUIPE", precioExtraCents: 150000 },
      { nombre: "CHOCOLATE BLANCO", precioExtraCents: 200000 },
      { nombre: "Botella de agua", precioExtraCents: 200000 },
    ]);
  });

  it("son opcionales: min 0", () => {
    const g = leido().grupos.find((x) => x.nombre === "ADICIONES")!;
    expect(g.minimo).toBe(0);
    expect(g.maximo).toBe(5);
  });

  it("$2.000 son 200.000 centavos, no 2.000", () => {
    const g = leido().grupos.find((x) => x.nombre === "ADICIONES")!;
    const agua = g.opciones.find((o) => o.nombre === "Botella de agua")!;
    expect(agua.precioExtraCents).toBe(200000);
  });
});

describe("nada se pierde por el camino", () => {
  it("los tres grupos se interpretan", () => {
    const r = leido();
    expect(r.grupos.map((g) => g.nombre).sort()).toEqual(["ADICIONES", "RECUBIERTO", "SALSAS"]);
    expect(r.sinInterpretar).toEqual([]);
  });
});
