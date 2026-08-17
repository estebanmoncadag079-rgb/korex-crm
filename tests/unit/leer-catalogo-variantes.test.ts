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

  /*
   * 🔴 ESTA PRUEBA CAMBIÓ DE SENTIDO EL 17-AGO-2026, y merece explicación.
   *
   * Antes exigía `max 1`, y pasaba: el lector traía una lista de palabras
   * —`recubiert|azucar|cobertura`— que lo daba por hecho. Acertaba con este
   * negocio por casualidad de vocabulario, y decidía a ciegas para todos los
   * demás (regla 1 de 79-ARQUITECTURA-MULTIEMPRESA).
   *
   * Y la verdad incómoda es que **del texto no se deduce**: `RECUBIERTO:
   * Azúcar-canela · Azúcar sola · Ambas · Sin azúcar` no dice en ninguna parte
   * que se elija uno. Lo sabe quien conoce el negocio.
   *
   * Así que ahora no se adivina: se marca para que lo mire una persona, que es
   * exactamente para lo que existe este lector — no escribe nada por su cuenta.
   */
  it("el texto NO dice cuántas se eligen, así que no se adivina: se marca", () => {
    const g = leido().grupos.find((x) => x.nombre === "RECUBIERTO")!;
    expect(g.maximo).toBe(4); // todas, que es lo neutro
    expect(g.revisar).toContain("no dice cuántas");
  });

  it("y si el negocio SÍ lo escribe, se respeta el número", () => {
    const g = leerCatalogoDeTexto("", "RECUBIERTO (elige 1): Azúcar · Canela · Ambas")
      .grupos.find((x) => x.nombre === "RECUBIERTO")!;
    expect(g.minimo).toBe(1);
    expect(g.maximo).toBe(1);
    expect(g.revisar).toBeUndefined();
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

/*
 * ────────────────────────────────────────────────────────────────────────
 * EL LECTOR NO SABE DE COMIDA (paso 0 de 88-AUDITORIA-SELECCION-MULTIPLE).
 *
 * Este archivo es el sembrador de catálogos de TODA la plataforma. Hasta el
 * 17-ago decidía el mínimo y el máximo de los grupos de cualquier negocio con
 * las palabras de uno solo. Estas pruebas usan negocios que no venden nada de
 * comer: si alguna vuelve a rojo, es que el vocabulario de un sector se ha
 * metido otra vez en el núcleo.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("cualquier negocio, no solo uno de comida", () => {
  it("un taller: «Cobertura del seguro» NO se convierte en elección única", () => {
    // La palabra «cobertura» daba `max 1` a quien no lo había pedido.
    const g = leerCatalogoDeTexto("", "COBERTURA DEL SEGURO: Total · Parcial · Contra terceros")
      .grupos.find((x) => x.nombre === "COBERTURA DEL SEGURO")!;
    expect(g.maximo).toBe(3);
    expect(g.revisar).toBeDefined();
  });

  it("una papelería: «Extras» no queda opcional por llamarse así", () => {
    // `/adicion|extra/` ponía `minimo: 0` sin que el negocio dijera nada.
    const g = leerCatalogoDeTexto("", "EXTRAS: Anillado · Plastificado")
      .grupos.find((x) => x.nombre === "EXTRAS")!;
    expect(g.minimo).toBe(1);
  });

  it("pero «opcional», que es del idioma y no de un sector, sí se respeta", () => {
    const g = leerCatalogoDeTexto("", "GRABADO (opcional): Iniciales · Fecha").grupos[0]!;
    expect(g.minimo).toBe(0);
  });

  it("un salón: una lista de opciones en el bloque de productos no se toma por un producto", () => {
    // Antes solo se reconocía si empezaba por «adiciones».
    const r = leerCatalogoDeTexto("TONOS: Rubio · Castaño · Negro", "");
    expect(r.productos).toEqual([]);
    expect(r.sinInterpretar).toEqual(["TONOS: Rubio · Castaño · Negro"]);
  });

  it("y un producto de verdad con dos puntos en el nombre sigue siendo un producto", () => {
    const r = leerCatalogoDeTexto("Combo: familiar — $32.000", "");
    expect(r.productos.map((p) => p.nombre)).toEqual(["Combo: familiar"]);
  });
});
