/**
 * La prueba obligatoria que fijó el dueño el 15-ago-2026, tal cual la escribió,
 * al revisar las extracciones reales:
 *
 * | Mensaje del cliente          | Resultado esperado           |
 * |------------------------------|------------------------------|
 * | 0                            | Reiniciar                    |
 * | Hola                         | No reactivar pedidos anteriores |
 * | ¿Qué horario tienen?         | Responder el horario         |
 * | ¿Me entregan mañana a las 8? | Responder sobre la entrega   |
 * | Quiero una churrita          | Reactivar el flujo de compra |
 * | Chocolate                    | Añadir la salsa              |
 *
 * El problema que fija: **el estado del pedido no puede tener prioridad
 * absoluta sobre la intención más reciente del cliente.**
 */
import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { leerIntencion } from "@/server/orders/intencion";

const SALSAS = [
  { id: "o1", nombre: "chocolate negro", precioExtraCents: 0 },
  { id: "o2", nombre: "arequipe", precioExtraCents: 0 },
  { id: "o3", nombre: "lechera", precioExtraCents: 0 },
  { id: "o4", nombre: "chocolate blanco", precioExtraCents: 0 },
];
const pres = (id: string, nombre: string, n: number): ProductoDelCatalogo => ({
  id,
  nombre,
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [{ id: `g${id}`, nombre: "SALSA", minimo: n, maximo: n, opciones: SALSAS }],
});
const CARTA = [
  pres("p1", "CHURRITA", 1),
  pres("p2", "BESTIES", 2),
  pres("p3", "FAMILY BOX", 3),
  pres("p4", "MEGA BOX", 5),
];

describe("la tabla obligatoria del dueño", () => {
  it('"0" reinicia', () => {
    expect(leerIntencion("0", CARTA).intencion).toBe("reinicio");
  });

  it('"Hola" NO reactiva un pedido anterior', () => {
    const r = leerIntencion("Hola", CARTA);
    expect(r.intencion).toBe("saludo");
    expect(r.intencion).not.toBe("pedido");
  });

  it('"¿Qué horario tienen?" espera que le respondan el horario', () => {
    const r = leerIntencion("¿Qué horario tienen?", CARTA);
    expect(r.intencion).toBe("consulta_horario");
    expect(r.esperaRespuesta).toBe(true);
  });

  it('"¿Me entregan mañana a las 8?" espera respuesta sobre la entrega', () => {
    const r = leerIntencion("¿Me entregan mañana a las 8?", CARTA);
    expect(r.intencion).toBe("consulta_entrega");
    expect(r.esperaRespuesta).toBe(true);
  });

  it('"Quiero una churrita" reactiva la compra', () => {
    expect(leerIntencion("Quiero una churrita", CARTA).intencion).toBe("pedido");
  });

  it('"Chocolate" añade la salsa', () => {
    expect(leerIntencion("Chocolate", CARTA).intencion).toBe("opcion");
  });
});

describe("cómo escribe la gente de verdad", () => {
  it("el caso real que destapó el problema: pide Y pregunta a la vez", () => {
    // «seria el besties cuanto sale el domi?» — el sistema respondía "¿cuáles
    // salsas desea?" sin contestar el domicilio.
    const r = leerIntencion("seria el besties cuanto sale el domi?", CARTA);
    expect(r.intencion).toBe("pedido");
  });

  it("un saludo con consulta detrás es consulta, no saludo", () => {
    const r = leerIntencion("hola, hasta que hora atienden?", CARTA);
    expect(r.intencion).toBe("consulta_horario");
    expect(r.esperaRespuesta).toBe(true);
  });

  it("sin tildes, con mayúsculas y en plural sigue siendo lo mismo", () => {
    expect(leerIntencion("QUIERO DOS CHURRITAS", CARTA).intencion).toBe("pedido");
    expect(leerIntencion("Que horario tienen", CARTA).intencion).toBe("consulta_horario");
  });

  it("preguntar el precio sin elegir NO es un pedido", () => {
    const r = leerIntencion("que precios tienen los churros?", CARTA);
    expect(r.intencion).toBe("consulta_precio");
    expect(r.esperaRespuesta).toBe(true);
  });

  it("lo que no encaja se marca como tal en vez de forzarlo", () => {
    expect(leerIntencion("gracias, muy amable", CARTA).intencion).toBe("otra");
  });
});
