import { describe, expect, it } from "vitest";

/**
 * El 18-ago-2026 el agente de Lashes Valen le dijo a una clienta "te comparto
 * nuestro catálogo de pestañas" y no llegó nada: ni el PDF, ni el enlace. No
 * había emitido `send_image` — escribió `reply`, y el cliente leyó una promesa
 * que nadie cumplió.
 *
 * Medido en producción, corrigiendo primero un filtro propio demasiado
 * amplio (capturaba "te comparto nuestras delicias" de La Churra —un menú en
 * texto, sin ningún recurso de por medio— como si fuera el mismo fallo): con
 * el filtro exacto, el patrón apareció en 3 conversaciones de dos negocios, y
 * solo 1 de cada 6 promesas ejecutó de verdad la acción. Una de esas
 * conversaciones no era de pruebas: una clienta con una cita real agendada.
 *
 * Estas pruebas cubren la detección (`prometeRecurso`) — la barrera completa
 * vive en `pipeline.ts`, igual que el cierre falso y la cita fantasma.
 */

import { prometeRecurso } from "@/server/ai/anuncio-de-cierre";

const PROMESA_REAL =
  "¡Claro que sí, hermosa! Aquí te comparto nuestro catálogo de pestañas para que veas todas las opciones que tenemos disponibles para ti. ✨💖";

describe("prometeRecurso: detecta la promesa incumplida", () => {
  it("caza el mensaje exacto que salió a producción", () => {
    expect(prometeRecurso(PROMESA_REAL)).toBe(true);
  });

  it.each([
    "¡Hermosa! Te envío nuestro catálogo con todo el amor para que elijas.",
    "Para que te hagas una idea de cómo luce el Volumen Americano, te comparto nuestro catálogo de pestañas.",
    "Aquí tienes el catálogo, hermosa.",
    "Te muestro la foto del Volumen Ruso para que veas cómo queda.",
    "Aquí está la foto que pediste.",
    "Te adjunto el documento con los precios.",
    "Te mando el PDF ahora mismo.",
  ])("caza: %s", (texto) => {
    expect(prometeRecurso(texto)).toBe(true);
  });

  /**
   * Los falsos positivos silencian una respuesta correcta y, si se repiten,
   * mandan la conversación a una persona. Ninguno de estos casos promete un
   * archivo: son respuestas de texto legítimas.
   */
  it.each([
    // El falso positivo real que produjo un primer filtro más amplio: un menú
    // listado en texto, sin ningún recurso de por medio.
    "¡Claro que sí, Churr@! Con gusto te comparto nuestras delicias: Churrita $10.000, Besties $20.000.",
    // Una oferta, no una promesa ya cumplida.
    "¿Te envío el catálogo, o prefieres que te cuente los precios?",
    "¿Quieres que te comparta el catálogo?",
    // Menciona el recurso sin prometer un envío.
    "No tenemos catálogo en PDF todavía, pero te cuento los estilos que manejamos.",
    "El catálogo lo actualizamos la semana pasada con los nuevos precios.",
    "¡Hola, hermosa! ¿Cómo te puedo ayudar hoy? 😊",
    "El servicio Semipermanente cuesta $40.000 y dura 60 minutos.",
  ])("no se activa con: %s", (texto) => {
    expect(prometeRecurso(texto)).toBe(false);
  });

  it("no se cae con texto vacío ni nulo", () => {
    expect(prometeRecurso(null)).toBe(false);
    expect(prometeRecurso(undefined)).toBe(false);
    expect(prometeRecurso("")).toBe(false);
  });
});
