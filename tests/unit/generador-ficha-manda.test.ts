import { describe, expect, it } from "vitest";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import { generarPerfil } from "@/server/ai/generador/generar";

/**
 * Doc 200 (26-sep-2026): lo que decide cada negocio sale de SU ficha, no de una
 * regla común fija. Auditoría del doc 199:
 *  - El orden del pedido era un guion numerado igual para todos. Ahora: una meta
 *    y "lo que necesitas para cerrar", armado desde la ficha.
 *  - Tres órdenes contradictorias sobre cuándo dar la cuenta (Lis: "nunca antes
 *    de confirmar"; la común: "si preguntan, dásela").
 *  - "Espera el total con el domicilio antes de transferir" se le decía también
 *    a MALIA, que cobra el domicilio en el total.
 *  - Las reglas propias decían "mandan sobre todo lo anterior" pero iban ANTES
 *    del cierre y de las prohibiciones.
 */
const BASE: FichaDelNegocio = {
  nombre: "Pastelería Prueba",
  queVende: "Vendemos cremosos y tortas artesanales.",
  ubicacion: "Cali",
  horario: { dias: [1, 2, 3, 4, 5, 6], abre: "10:00", cierra: "19:00" },
  vertical: "pedidos",
  catalogo: "Cremoso 7 oz — $12.000",
  entrega: {
    haceDomicilios: true,
    como: "Por Yango, 1 hora.",
    quienPagaElDomicilio: "El domicilio se paga aparte, al repartidor.",
    recogerEnLocal: "Sí, en el local.",
  },
  pago: { formas: "transferencia", datosDeCuenta: "Bancolombia 123", compruebaUnaPersona: true },
  tono: "Dulce y cercano, con emojis.",
  regalos: "Sí, con tarjeta.",
  preguntasFrecuentes: [],
  escalarSiempre: ["Reclamos"],
  nuncaPrometer: ["Hora exacta"],
  reglasPropias: ["REGLA PROPIA DE PRUEBA"],
  cierre: {
    requisitos: [
      { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
      { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
    ],
  },
};

const prompt = (f: Partial<FichaDelNegocio> = {}, o?: Parameters<typeof generarPerfil>[1]) =>
  generarPerfil({ ...BASE, ...f }, o).instructions;

describe("sin orden fijo: una meta y lo que necesitas para cerrar", () => {
  it("no hay guion numerado de preguntas", () => {
    const p = prompt();
    expect(p).not.toContain("El orden en que preguntas");
    expect(p).not.toMatch(/^1\. \*\*Qué quiere/m);
    expect(p).toContain("Lo que necesitas para cerrar");
  });

  it("la lista sale de la ficha: los datos que el negocio pide", () => {
    const p = prompt();
    expect(p).toContain("el nombre de quien lo pide");
    expect(p).toContain("el celular de contacto");
  });

  it("el regalo solo aparece si el negocio hace regalos", () => {
    expect(prompt()).toMatch(/regalo/i);
    expect(prompt({ regalos: "" })).not.toMatch(/Si es para él o es un regalo/);
  });

  it("regla por defecto: los datos de contacto y de entrega van JUNTOS, sin mezclarlos con elegir productos", () => {
    const p = prompt();
    expect(p).toMatch(/datos de contacto y de entrega\*\*[\s\S]{0,200}juntos/i);
    expect(p).toMatch(/no mezcles/i);
  });

  it("en citas tampoco hay guion numerado", () => {
    const p = prompt({ vertical: "citas" }, { vertical: "citas" });
    expect(p).not.toContain("El orden en que preguntas");
    expect(p).toContain("Lo que necesitas para cerrar");
  });
});

describe("la cuenta y el domicilio en el cierre, según el negocio", () => {
  it("por defecto: si preguntan cómo pagar, se les contesta con la cuenta", () => {
    expect(prompt()).toMatch(/Si te preguntan cómo pagar, contesta/);
  });

  it("'nunca antes de confirmar' (Lis): la cuenta solo después de que confirme", () => {
    const p = prompt({ pago: { ...BASE.pago, cuentaAntesDeConfirmar: "nunca" } });
    expect(p).not.toMatch(/Si te preguntan cómo pagar, contesta/);
    expect(p).toMatch(/datos de la\s+cuenta se dan solo cuando el cliente confirme/i);
  });

  it("'espera el total con el domicilio' solo donde el domicilio se cotiza aparte", () => {
    expect(prompt()).toMatch(/total con el domicilio antes de transferir/);
    expect(prompt({}, { domicilioEnTabla: true })).not.toMatch(/total con el domicilio antes de transferir/);
  });
});

describe("fuera de horario, según el negocio", () => {
  it("por defecto se toma el pedido y se coordina al abrir", () => {
    expect(prompt()).toMatch(/Si está CERRADO\*\*, no rechaces el pedido/);
  });

  it("si el negocio NO toma pedidos cerrado, no se toman", () => {
    const p = prompt({ fueraDeHorario: { tomaPedidos: false } });
    expect(p).toMatch(/no tomes el\s+pedido/i);
    expect(p).not.toMatch(/te tomo el pedido ahora mismo/);
  });

  it("el mensaje propio del negocio va tal cual", () => {
    const p = prompt({ mensajes: { fueraDeHorario: "MENSAJE PROPIO DE CERRADO" } });
    expect(p).toContain("«MENSAJE PROPIO DE CERRADO»");
  });
});

describe("las reglas del negocio mandan de verdad", () => {
  it("las reglas propias van al FINAL, después del cierre y de las prohibiciones", () => {
    const p = prompt();
    const reglas = p.indexOf("REGLA PROPIA DE PRUEBA");
    expect(reglas).toBeGreaterThan(p.indexOf("# El cierre"));
    expect(reglas).toBeGreaterThan(p.indexOf("# Nunca"));
  });

  it("respuestas a publicaciones: 'pasar_al_equipo' se dice explícitamente", () => {
    expect(prompt({ respuestaAPublicaciones: "pasar_al_equipo" })).toMatch(
      /RESPONDE A UNA PUBLICACIÓN[^\n]*pasa la conversación/i
    );
  });

  it("citas: la política de cancelación va tal cual", () => {
    const p = prompt(
      { vertical: "citas", politicaDeCancelacion: "Cambios con 24 horas" },
      { vertical: "citas" }
    );
    expect(p).toContain("«Cambios con 24 horas»");
  });
});
