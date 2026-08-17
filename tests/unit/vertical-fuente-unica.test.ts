/**
 * El vertical tiene UNA fuente de verdad (17-ago-2026).
 *
 * Hasta hoy había dos —`agent_profile.appointments_enabled` y `ficha.vertical`—
 * y podían contradecirse. Existía un aviso para cuando pasaba, y ese aviso era
 * la señal del problema: un negocio con la ficha de citas y la columna en
 * `false` tendría un agente prometiendo *"te agendo"* mientras la API rechaza
 * la reserva con un 403.
 */
import { describe, expect, it } from "vitest";
import { contrataCitas, verticalDe, type Vertical } from "@/server/vertical";
import { generarPerfil } from "@/server/ai/generador/generar";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

const FICHA: FichaDelNegocio = {
  nombre: "Negocio de prueba",
  vertical: "pedidos",
  queVende: "lo que sea",
  // Con catálogo: en pedidos es obligatorio y en citas se ignora, así que el
  // mismo fixture sirve para los dos verticales.
  catalogo: "COSA — $10.000",
  tono: "cercano",
  horario: { abre: "9:00 AM", cierra: "6:00 PM", dias: [1, 2, 3, 4, 5, 6] },
  // Sin domicilios: así el fixture no depende de los datos de reparto, que son
  // del vertical de pedidos y no de lo que aquí se prueba.
  entrega: { haceDomicilios: false },
  pago: { formas: "efectivo", compruebaUnaPersona: true },
  saludoInicial: "Hola",
  preguntasFrecuentes: [],
  escalarSiempre: [],
  nuncaPrometer: [],
};

describe("la columna manda, la ficha es una copia", () => {
  it("traduce lo contratado a un vertical", () => {
    expect(verticalDe(true)).toBe("citas");
    expect(verticalDe(false)).toBe("pedidos");
    expect(verticalDe(null)).toBe("pedidos");
    expect(verticalDe(undefined)).toBe("pedidos");
  });

  it("y la vuelta, para escribir la columna", () => {
    expect(contrataCitas("citas")).toBe(true);
    expect(contrataCitas("pedidos")).toBe(false);
  });

  /*
   * EL CASO QUE MOTIVA TODO: la ficha dice una cosa y el negocio contrató otra.
   * Antes ganaba la ficha (con un aviso); ahora gana lo contratado.
   */
  it("con la ficha en 'pedidos' y citas contratado, el prompt es de CITAS", () => {
    const perfil = generarPerfil(FICHA, { vertical: "citas" });
    // El cierre de citas no habla de cocina ni de totales: habla de agendar.
    expect(perfil.instructions).toContain("Cómo se cierra una cita");
    expect(perfil.instructions).not.toContain("Cómo se cierra un pedido");
  });

  it("y al revés: ficha de citas, pedidos contratado → prompt de PEDIDOS", () => {
    const deCitas = { ...FICHA, vertical: "citas" as Vertical };
    const perfil = generarPerfil(deCitas, { vertical: "pedidos" });
    expect(perfil.instructions).not.toContain("Cómo se cierra una cita");
  });

  it("sin vertical explícito cae a la ficha: es el modo de las herramientas", () => {
    // `simular:ficha` y `regenerar:flota` no tienen la columna a mano. El
    // fallback existe para ellos, y por eso está documentado en la firma.
    const deCitas = { ...FICHA, vertical: "citas" as Vertical };
    expect(generarPerfil(deCitas).instructions).toContain("Cómo se cierra una cita");
    expect(generarPerfil(FICHA).instructions).not.toContain("Cómo se cierra una cita");
  });

  it("un vertical nuevo no rompe nada: el tipo lo impide antes de correr", () => {
    // `Vertical` es una unión cerrada a propósito: el día que entre un tercero,
    // el compilador señala TODOS los sitios que hay que revisar.
    const verticales: Vertical[] = ["pedidos", "citas"];
    expect(verticales.map(contrataCitas)).toEqual([false, true]);
  });
});
