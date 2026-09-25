import { describe, expect, it } from "vitest";
import {
  resumenAplazado,
  CORRECCION_DE_RESUMEN_APLAZADO,
} from "@/server/ai/anuncio-de-cierre";

/**
 * El resumen APLAZADO (Bug 5, 24-sep-2026, MALIA).
 *
 * Con la hoja del pedido lista, el agente emite un `reply` que PROMETE el
 * resumen para más tarde en vez de mostrarlo en este mismo turno. Dos
 * consecuencias medidas en producción:
 *
 *  • **Diana Manrique** (cv_29uwlk2qobe4uv5sj4lg) — tras dar el celular:
 *    *"Ahora preparo el resumen actualizado para que lo confirmes."* La
 *    clienta no volvió a escribir y el pedido nunca se confirmó.
 *  • **aymara cruz** (cv_z8utc3enge1gzn3q1j0v) — *"Ahora preparo el resumen
 *    con domicilio…"* dos veces, hasta que un "está bien" cerró un pedido
 *    cuyo resumen la clienta nunca vio.
 *
 * Este detector es SOLO la mitad de texto: dice si el mensaje aplaza el
 * resumen. La otra mitad —si la hoja de verdad está lista para mostrarlo— la
 * decide el backend en `pipeline.ts` (el estado, no el texto). Un mensaje que
 * aplaza pero cuya hoja aún NO está lista es correcto y no debe rehacerse.
 */

describe("resumenAplazado: detecta que el agente promete el resumen y no lo muestra", () => {
  it("detecta el caso real de Diana", () => {
    expect(
      resumenAplazado(
        "Perfecto, guardé el celular 3145602573. Ahora preparo el resumen actualizado para que lo confirmes."
      )
    ).toBe(true);
  });

  it("detecta el caso real de aymara", () => {
    expect(
      resumenAplazado(
        "Perfecto, anoté tu nombre y celular: aymara cruz · 573164116589. Ahora preparo el resumen con domicilio y total para que lo confirmes."
      )
    ).toBe(true);
  });

  it("reconoce las variantes de la promesa", () => {
    for (const t of [
      "Voy a preparar el resumen de tu pedido.",
      "Enseguida te armo el resumen para confirmar.",
      "Dame un momento y preparo el resumen.",
    ]) {
      expect(resumenAplazado(t), t).toBe(true);
    }
  });
});

describe("resumenAplazado: no molesta cuando el resumen SÍ está o no aplica", () => {
  it("no salta si el mensaje YA trae el resumen con su total", () => {
    expect(
      resumenAplazado(
        "Aquí está el resumen de tu pedido:\n• 1 Pavé Cremoso 8 oz — $10.000\nTotal: $10.000\n¿Está todo correcto?"
      )
    ).toBe(false);
  });

  it("no salta en una oferta (pregunta), que no es una promesa", () => {
    expect(resumenAplazado("¿Quieres que te prepare el resumen del pedido?")).toBe(false);
  });

  it("no se mete en mensajes normales", () => {
    expect(resumenAplazado("¡Holaa! ¿Qué te gustaría pedir hoy?")).toBe(false);
    expect(resumenAplazado("El Pavé Cremoso 8 oz vale $10.000 😊")).toBe(false);
    expect(resumenAplazado(null)).toBe(false);
    expect(resumenAplazado("")).toBe(false);
  });
});

describe("CORRECCION_DE_RESUMEN_APLAZADO: le dice al modelo que lo muestre ya", () => {
  it("le exige mostrar el resumen ahora, con su total, en este mismo mensaje", () => {
    expect(CORRECCION_DE_RESUMEN_APLAZADO).toMatch(/resumen/i);
    expect(CORRECCION_DE_RESUMEN_APLAZADO).toMatch(/total/i);
    expect(CORRECCION_DE_RESUMEN_APLAZADO).toMatch(/Responde ÚNICAMENTE el objeto JSON\.$/);
  });
});
