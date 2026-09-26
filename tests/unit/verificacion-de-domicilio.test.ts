import { describe, expect, it } from "vitest";
import { verificarDomicilio } from "@/server/delivery/verificacion";
import type { ZonaDeEntrega } from "@/server/delivery/zonas";

/**
 * Una sola función decide qué pasa con el domicilio, tanto en la búsqueda
 * normal como en la corrección antes de cerrar (25-sep-2026). Antes eran dos
 * copias del mismo bloque en `pipeline.ts`, y la segunda ya se había quedado
 * atrás (no sabía pedir el barrio).
 */

const ZONAS: ZonaDeEntrega[] = [
  { id: "z1", nombre: "Floralia", feeCents: 1000000 },
  { id: "z2", nombre: "El Refugio", feeCents: 800000 },
];

const BASE = {
  zonas: ZONAS,
  hayTablaDeZonas: true,
  direccionDelCliente: "Calle 72 # 3n 45 barrio floralia",
  entregaPrevia: null,
  subtotalCents: 2000000,
  mensajeId: "msg_2",
};

describe("verificarDomicilio", () => {
  it("zona encontrada → cobra, y el hecho ya trae productos + domicilio = total", () => {
    const r = verificarDomicilio({ ...BASE, consulta: { zona: "Calle 72 # 3n 45 barrio floralia" } });
    expect(r.paso).toBe("cobrar");
    expect(r.entrega).toMatchObject({ tipo: "domicilio", feeCents: 1000000, direccion: BASE.direccionDelCliente });
    expect(r.infoZona).toMatch(/\$20\.000/);
    expect(r.infoZona).toMatch(/\$10\.000/);
    expect(r.infoZona).toMatch(/\$30\.000/);
  });

  it("no está en la tabla, primera vez → pide el barrio y lo deja anotado", () => {
    const r = verificarDomicilio({ ...BASE, consulta: { zona: "Edificio Colombia, Centro, Cali" } });
    expect(r.paso).toBe("pedir-barrio");
    expect(r.entrega).toMatchObject({ tipo: "domicilio", feeCents: null, barrioPedido: true });
    expect(r.infoZona).toMatch(/dime el barrio/i);
  });

  it("ya se pidió el barrio y el cliente da un lugar NUEVO que tampoco está → pasar al equipo", () => {
    const r = verificarDomicilio({
      ...BASE,
      consulta: { zona: "por el centro" },
      entregaPrevia: {
        tipo: "domicilio",
        zonaId: null,
        zonaNombre: null,
        feeCents: null,
        verificadoEnMensajeId: "msg_1",
        verificadoEn: "2026-09-25T15:00:00.000Z",
        barrioPedido: true,
      },
    });
    expect(r.paso).toBe("pasar-al-equipo");
  });

  /*
   * Medido con el modelo real (25-sep-2026): se pidió el barrio, la clienta
   * contestó con su nombre y teléfono, y el modelo volvió a consultar LA MISMA
   * dirección. Eso no es "no quiso dar el barrio": derivaba demasiado pronto.
   */
  const pendiente = {
    tipo: "domicilio" as const,
    zonaId: null,
    zonaNombre: null,
    feeCents: null,
    verificadoEnMensajeId: "msg_1",
    verificadoEn: "2026-09-25T15:00:00.000Z",
    direccion: "Edificio Colombia, Centro, Cali",
    barrioPedido: true,
  };

  it("repetir la MISMA búsqueda que ya falló (el cliente contestó otra cosa) → se vuelve a pedir, no se deriva", () => {
    const r = verificarDomicilio({
      ...BASE,
      direccionDelCliente: "Edificio Colombia, Centro, Cali",
      consulta: { zona: "Edificio Colombia, Centro, Cali" },
      entregaPrevia: pendiente,
    });
    expect(r.paso).toBe("pedir-barrio");
    expect(r.entrega.vecesPedidoBarrio).toBe(2);
  });

  it("ya se pidió dos veces y sigue sin barrio → pasar al equipo", () => {
    const r = verificarDomicilio({
      ...BASE,
      direccionDelCliente: "Edificio Colombia, Centro, Cali",
      consulta: { zona: "Edificio Colombia, Centro, Cali" },
      entregaPrevia: { ...pendiente, vecesPedidoBarrio: 2 },
    });
    expect(r.paso).toBe("pasar-al-equipo");
  });

  it("la pregunta del barrio es de ESTE MISMO mensaje → todavía no cuenta: se vuelve a pedir, no se deriva", () => {
    const r = verificarDomicilio({
      ...BASE,
      consulta: { zona: "centro" },
      entregaPrevia: {
        tipo: "domicilio",
        zonaId: null,
        zonaNombre: null,
        feeCents: null,
        verificadoEnMensajeId: "msg_2",
        verificadoEn: "2026-09-25T15:00:00.000Z",
        barrioPedido: true,
      },
    });
    expect(r.paso).toBe("pedir-barrio");
  });

  it("el cliente ya había dado el barrio (zona encontrada antes) y luego una dirección sin barrio → se conserva esa zona, no se le vuelve a preguntar", () => {
    const r = verificarDomicilio({
      ...BASE,
      direccionDelCliente: "Calle 72 # 3n 45",
      consulta: { zona: "Calle 72 # 3n 45" },
      entregaPrevia: {
        tipo: "domicilio",
        zonaId: "z1",
        zonaNombre: "Floralia",
        feeCents: 1000000,
        verificadoEnMensajeId: "msg_1",
        verificadoEn: "2026-09-25T15:00:00.000Z",
      },
    });
    expect(r.paso).toBe("cobrar");
    expect(r.entrega).toMatchObject({ zonaNombre: "Floralia", feeCents: 1000000, direccion: "Calle 72 # 3n 45" });
    expect(r.infoZona).toMatch(/\$30\.000/);
  });

  it("recogida → sin domicilio", () => {
    const r = verificarDomicilio({ ...BASE, consulta: { zona: "recogida", recogida: true } });
    expect(r.paso).toBe("recogida");
    expect(r.entrega).toMatchObject({ tipo: "recogida", feeCents: null });
  });

  it("negocio sin tabla: comportamiento de siempre (nunca pide barrio ni deriva por esto)", () => {
    const r = verificarDomicilio({ ...BASE, zonas: [], hayTablaDeZonas: false, consulta: { zona: "Floralia" } });
    expect(r.paso).toBe("sin-tabla");
    expect(r.entrega.barrioPedido).toBeUndefined();
  });
});

describe("doc 200: la pregunta del barrio es la del negocio, si la escribió", () => {
  it("usa el mensaje propio en la instrucción para el modelo", () => {
    const r = verificarDomicilio({
      ...BASE,
      consulta: { zona: "Centro, Cali" },
      mensajePedirBarrio: "¿Me regalas el barrio, porfa? 💕",
    });
    expect(r.paso).toBe("pedir-barrio");
    expect(r.infoZona).toContain("¿Me regalas el barrio, porfa? 💕");
  });
});

/*
 * E2E 26-sep-2026 (MALIA): tras pedir el barrio, la clienta respondió "barrio San
 * Antonio" y el modelo guardó la dirección como "San Antonio" — se perdió la
 * calle. La instrucción del barrio pide guardar la dirección COMPLETA.
 */
describe("al recibir el barrio, la dirección se completa, no se reemplaza", () => {
  it("la instrucción pide guardar la dirección que ya tenía más el barrio", () => {
    const r = verificarDomicilio({ ...BASE, consulta: { zona: "Carrera 5 # 12-30, Centro, Cali" } });
    expect(r.infoZona).toMatch(/dirección COMPLETA/);
  });
});
