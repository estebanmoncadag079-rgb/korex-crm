import { describe, expect, it } from "vitest";

/**
 * Los guiones del Laboratorio arrastraron meses siendo de una ferretería
 * mexicana mientras los clientes reales vendían comida: el reporte evaluaba al
 * agente con preguntas que su negocio no podía responder.
 *
 * Estas pruebas fijan las dos reglas que evitan que vuelva a pasar: nada de
 * catálogos ajenos, y nada de productos concretos — el Laboratorio lo corre
 * cada cliente contra SU conocimiento.
 */

import { PERSONAS, PERSONA_LABELS } from "@/server/lab/personas";

const guiones = PERSONAS.flatMap((p) => p.script).join(" \n ").toLowerCase();

describe("estructura de las personas", () => {
  it("son seis y sus claves no chocan", () => {
    expect(PERSONAS).toHaveLength(6);
    expect(new Set(PERSONAS.map((p) => p.key)).size).toBe(6);
  });

  it("cada persona tiene su teléfono sintético propio", () => {
    const phones = PERSONAS.map((p) => p.phone);
    expect(new Set(phones).size).toBe(phones.length);
    // Bloque reservado: ningún número real termina en tantos ceros seguidos.
    for (const phone of phones) expect(phone).toMatch(/0{8}\d$/);
  });

  it("ninguna se queda sin guión", () => {
    for (const p of PERSONAS) expect(p.script.length).toBeGreaterThanOrEqual(4);
  });

  it("el reporte sabe nombrar todas las personas", () => {
    for (const p of PERSONAS) expect(PERSONA_LABELS[p.key]).toBe(p.label);
  });
});

describe("los guiones no traen catálogos ajenos", () => {
  it("no queda rastro de la ferretería", () => {
    for (const palabra of [
      "taladro",
      "martillo",
      "desarmador",
      "clavos",
      "lijadora",
      "pintura",
      "tiner",
      "cemento",
      "mxn",
      "spei",
    ]) {
      expect(guiones).not.toContain(palabra);
    }
  });

  it("no nombra productos de un negocio concreto", () => {
    // Un guión que pida "una Besties" hace fallar a la pastelería por no tener
    // algo que nunca vendió: el juez lo marca rojo y el reporte miente.
    for (const producto of ["besties", "churrit", "family box", "torta de"]) {
      expect(guiones).not.toContain(producto);
    }
  });
});

describe("el comprador decidido puede llegar a cerrar el pedido", () => {
  const decidido = PERSONAS.find((p) => p.key === "comprador_decidido")!;
  const texto = decidido.script.join(" ").toLowerCase();

  it("da los datos que el agente necesita para avisar al equipo", () => {
    // Sin dirección ni forma de pago el agente no puede emitir notify_order, y
    // el escenario más importante del Laboratorio se quedaría a medias.
    expect(texto).toMatch(/carrera|calle|apartamento/);
    expect(texto).toMatch(/efectivo|transferencia|tarjeta/);
    expect(texto).toMatch(/domicilio|recoger/);
  });
});
