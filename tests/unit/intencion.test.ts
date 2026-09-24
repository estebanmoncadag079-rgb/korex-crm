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
import { leerIntencion, pedidoSigueVigente, planDelTurno } from "@/server/orders/intencion";

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
  grupos: [
    { id: `g${id}`, nombre: "SALSA", minimo: n, maximo: n, permiteRepeticion: true, opciones: SALSAS },
  ],
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

describe("lo que hace falta para que sirva a más de un negocio", () => {
  it('el "0" es la convención de La Churra, no una ley: se puede cambiar', () => {
    // Un negocio con listas numeradas tiene un "0" legítimo, y un reinicio
    // clavado en el código le borraría el pedido a mitad.
    const otroNegocio = leerIntencion("0", CARTA, ["empezar de nuevo", "cancelar"]);
    expect(otroNegocio.intencion).not.toBe("reinicio");
    expect(leerIntencion("cancelar", CARTA, ["cancelar"]).intencion).toBe("reinicio");
  });

  it("las presentaciones salen del catálogo, no de una lista escrita a mano", () => {
    // El día que un negocio venda "Combo Familiar", esto tiene que funcionar
    // sin tocar una línea de código.
    const otraCarta: ProductoDelCatalogo[] = [pres("x1", "COMBO FAMILIAR", 2)];
    expect(leerIntencion("quiero un combo familiar", otraCarta).intencion).toBe("pedido");
  });
});

describe("responder y retomar en el mismo mensaje (decisión del dueño)", () => {
  it("con pedido en curso: contesta la consulta Y sigue, sin gastar un mensaje de más", () => {
    const plan = planDelTurno(leerIntencion("cuanto sale el domi?", CARTA), true);
    expect(plan.responderPrimero).toBe("consulta_entrega");
    expect(plan.continuarEnElMismoMensaje).toBe(true);
    expect(plan.reiniciar).toBe(false);
  });

  it("sin pedido en curso: contesta y NO se pone a pedir datos", () => {
    const plan = planDelTurno(leerIntencion("¿Qué horario tienen?", CARTA), false);
    expect(plan.responderPrimero).toBe("consulta_horario");
    expect(plan.continuarEnElMismoMensaje).toBe(false);
  });

  it('el "0" manda sobre todo lo demás', () => {
    const plan = planDelTurno(leerIntencion("0", CARTA), true);
    expect(plan.reiniciar).toBe(true);
    expect(plan.continuarEnElMismoMensaje).toBe(false);
  });
});

describe("un pedido a medias vale hasta el final del día (decisión del dueño)", () => {
  // 22:00 en Colombia = 03:00 UTC del día siguiente. Es la franja de más
  // pedidos de una churrería, y en UTC parecería otro día.
  const nocheDelLunes = new Date("2026-08-11T03:00:00Z"); // 10-ago 22:00 en Bogotá
  it("se retoma el mismo día aunque en UTC ya sea otro", () => {
    const antes = new Date("2026-08-11T01:00:00Z"); // 10-ago 20:00 en Bogotá
    expect(pedidoSigueVigente(antes, nocheDelLunes)).toBe(true);
  });

  it("al día siguiente se empieza limpio", () => {
    const ayer = new Date("2026-08-10T18:00:00Z"); // 10-ago 13:00 en Bogotá
    const hoy = new Date("2026-08-11T18:00:00Z"); // 11-ago 13:00 en Bogotá
    expect(pedidoSigueVigente(ayer, hoy)).toBe(false);
  });
});

/**
 * El plan del turno, escrito para que lo lea el modelo.
 *
 * 24-sep-2026. Este módulo existía desde el 15-ago, con sus pruebas en verde,
 * y **no lo llamaba nadie**: el único fichero que lo importaba era este test.
 * Mientras tanto seguía pasando lo que vino a resolver — caso real de MALIA
 * (conv cv_zgm286k69bz1hmprf87a):
 *
 *     17:15:42  CLIENTE  Y que costo tiene el domicilio?
 *     17:15:58  BOT      Perfecto 😊 ¿Qué quieres y cuántos?
 *
 * Dieciséis segundos: no fue una carrera de turnos. Fue que la capa que decide
 * qué preguntar solo miraba qué le falta al pedido, nunca qué acaba de decir
 * el cliente.
 *
 * Esta función NO redacta la respuesta ni elige el producto: traduce el plan a
 * una instrucción que el modelo pueda seguir. Devuelve `null` cuando no hay
 * nada que priorizar — la inmensa mayoría de los turnos— para no meter ruido
 * en un prompt que el modelo lee entero cada vez.
 */
import { bloqueDelPlan } from "@/server/orders/intencion";

describe("bloqueDelPlan: la prioridad, dicha en palabras", () => {
  const plan = (m: string, hayPedido: boolean) => {
    const lectura = leerIntencion(m, CARTA);
    return { lectura, plan: planDelTurno(lectura, hayPedido) };
  };

  it("BUG REAL: una pregunta de domicilio manda contestarla primero", () => {
    const { lectura, plan: p } = plan("cuanto sale el domi?", true);
    const bloque = bloqueDelPlan(lectura, p);
    expect(bloque).toMatch(/PLAN DEL TURNO/);
    expect(bloque).toMatch(/CONTÉSTALE/);
    expect(bloque).toMatch(/entrega|domicilio/i);
  });

  it("con un pedido en curso, manda seguir en el MISMO mensaje", () => {
    const { lectura, plan: p } = plan("cuanto sale el domi?", true);
    expect(bloqueDelPlan(lectura, p)).toMatch(/MISMO mensaje/);
  });

  it("sin pedido en curso, NO manda empezar a pedir datos", () => {
    const { lectura, plan: p } = plan("¿Qué horario tienen?", false);
    const bloque = bloqueDelPlan(lectura, p)!;
    expect(bloque).toMatch(/horario/i);
    expect(bloque).not.toMatch(/MISMO mensaje/);
    expect(bloque).toMatch(/no empieces a pedirle/i);
  });

  it("los precios también cuentan como pregunta explícita", () => {
    const { lectura, plan: p } = plan("que precios tienen los churros?", true);
    expect(bloqueDelPlan(lectura, p)).toMatch(/precio/i);
  });

  it("un pedido normal NO genera bloque: no hay nada que priorizar", () => {
    const { lectura, plan: p } = plan("Quiero una churrita", true);
    expect(bloqueDelPlan(lectura, p)).toBeNull();
  });

  it("una opción suelta tampoco", () => {
    const { lectura, plan: p } = plan("Chocolate", true);
    expect(bloqueDelPlan(lectura, p)).toBeNull();
  });

  it("y un mensaje que no encaja en nada TAMPOCO inventa prioridad", () => {
    // `otra` sigue siendo válida: no se deduce una intención que no está.
    const { lectura, plan: p } = plan("Bueno, entonces hagamos eso", true);
    expect(lectura.intencion).toBe("otra");
    expect(bloqueDelPlan(lectura, p)).toBeNull();
  });

  it("el reinicio no genera bloque: de eso se encarga el pipeline, no el modelo", () => {
    const { lectura, plan: p } = plan("0", true);
    expect(p.reiniciar).toBe(true);
    expect(bloqueDelPlan(lectura, p)).toBeNull();
  });
});
