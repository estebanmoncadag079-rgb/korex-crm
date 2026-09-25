import { describe, expect, it } from "vitest";
import { pedidoQuedoAbandonado, HORAS_PARA_DAR_POR_ABANDONADO } from "@/server/orders/intencion";

/**
 * Reinicio por abandono (Bug 2, 25-sep-2026, decisión del dueño).
 *
 * Un pedido viejo se reinicia SOLO si se dan las DOS condiciones: es de otro
 * día (hora de Colombia) Y lleva varias horas sin actividad. Así nunca se le
 * borra el carrito a quien sigue pidiendo pasada la medianoche (pide 11:50pm,
 * sigue 12:10am), y sí se limpia lo que quedó realmente abandonado de ayer.
 *
 * Colombia es UTC-5 fijo (sin horario de verano): la conversión UTC→Bogotá es
 * restar 5 horas.
 */

describe("pedidoQuedoAbandonado: otro día Y varias horas sin actividad", () => {
  it("mismo día, aunque haya pasado horas: NO se reinicia (el cliente puede volver)", () => {
    const ultima = new Date("2026-09-24T15:00:00Z"); // 10:00 Bogotá, día 24
    const ahora = new Date("2026-09-24T22:00:00Z"); //  17:00 Bogotá, día 24 (7h)
    expect(pedidoQuedoAbandonado(ultima, ahora)).toBe(false);
  });

  it("cruza la medianoche pero sigue activo (20 min): NO se reinicia", () => {
    const ultima = new Date("2026-09-25T04:50:00Z"); // 23:50 Bogotá, día 24
    const ahora = new Date("2026-09-25T05:10:00Z"); //  00:10 Bogotá, día 25 (20 min)
    expect(pedidoQuedoAbandonado(ultima, ahora)).toBe(false);
  });

  it("otro día y varias horas sin actividad: SÍ se reinicia", () => {
    const ultima = new Date("2026-09-24T20:00:00Z"); // 15:00 Bogotá, día 24
    const ahora = new Date("2026-09-25T13:00:00Z"); //  08:00 Bogotá, día 25 (17h)
    expect(pedidoQuedoAbandonado(ultima, ahora)).toBe(true);
  });

  it("otro día pero por debajo del umbral de horas: NO se reinicia todavía", () => {
    const ultima = new Date("2026-09-25T02:00:00Z"); // 21:00 Bogotá, día 24
    const ahora = new Date("2026-09-25T07:00:00Z"); //  02:00 Bogotá, día 25 (5h)
    expect(pedidoQuedoAbandonado(ultima, ahora)).toBe(false);
  });

  it("justo en el umbral, otro día: se reinicia", () => {
    const ultima = new Date("2026-09-25T02:00:00Z"); // 21:00 Bogotá, día 24
    const ahora = new Date(ultima.getTime() + HORAS_PARA_DAR_POR_ABANDONADO * 3_600_000);
    // ese +Nh cae en el día 25 en Bogotá (21:00 + 6h = 03:00 del día siguiente)
    expect(pedidoQuedoAbandonado(ultima, ahora)).toBe(true);
  });
});
