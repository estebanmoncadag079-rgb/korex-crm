import { describe, expect, it } from "vitest";
import { correccionDePropuestaRechazada } from "@/server/ai/anuncio-de-cierre";

/**
 * Fase 8J — incidente real (MALIA, 8-sep-2026, conv cv_2xfh67lig9a07xzief96).
 *
 * Una clienta pidió un "pavé de oblea". El backend rechazó el carrito CINCO
 * veces seguidas (`"Oblea" no está entre las opciones de Pavé Cremoso 8 oz`)
 * y cada rechazo se registraba en una métrica y se descartaba: el modelo
 * nunca se enteró, siguió armando el pedido con un ítem que el sistema jamás
 * iba a aceptar, le mostró un resumen de $36.000 a la clienta, y el error
 * solo salió al cerrar —con el carrito real en $18.000— en forma de
 * derivación a una persona diez minutos después. La clienta canceló.
 *
 * Medido en 3 h de producción: 21 de 95 propuestas rechazadas (22%), con una
 * cascada clara — un ítem sin resolver deja el carrito sin total, y de ahí en
 * adelante todo turno se rechaza con `confirmado sin total calculado`.
 */
describe("correccionDePropuestaRechazada", () => {
  it("le dice al modelo el motivo EXACTO que comprobó el backend, sin parafrasearlo", () => {
    const texto = correccionDePropuestaRechazada(
      ['"Oblea" no está entre las opciones de Pavé Cremoso 8 oz'],
      ["¿Cuál desea? Hay: Fresas con crema, Maracuyá, Arequipe"]
    );
    expect(texto).toContain('"Oblea" no está entre las opciones de Pavé Cremoso 8 oz');
    expect(texto).toContain("Fresas con crema, Maracuyá, Arequipe");
  });

  it("le ordena preguntar, no confirmar lo que el sistema rechazó", () => {
    const texto = correccionDePropuestaRechazada(
      ["confirmado sin total calculado"],
      ["¿Cuál desea? Hay: 8 oz, 16 oz"]
    );
    expect(texto).toMatch(/pregunt/i);
    expect(texto).toMatch(/No confirmes/i);
    expect(texto).toContain("JSON");
  });

  it("varios motivos y varias preguntas salen todos, sin recortar", () => {
    const texto = correccionDePropuestaRechazada(
      ["motivo uno", "motivo dos"],
      ["pregunta A", "pregunta B", "pregunta C"]
    );
    for (const t of ["motivo uno", "motivo dos", "pregunta A", "pregunta B", "pregunta C"]) {
      expect(texto).toContain(t);
    }
  });
});
