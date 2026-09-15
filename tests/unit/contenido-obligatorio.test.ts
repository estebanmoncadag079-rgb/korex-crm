import { describe, expect, it } from "vitest";
import {
  agregarContenidoFaltante,
  correccionDeContenidoFaltante,
  disparadoPor,
  extraerContenidoObligatorio,
} from "@/server/ai/contenido-obligatorio";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import type { AgentActionType } from "@/server/ai/actions";

/**
 * 23-ago-2026: Maricel escribió a Lis Pastelería "¡Hola! Quiero hacer un
 * pedido" y el agente contestó "te comparto nuestro catálogo" SIN el enlace
 * — un asesor tuvo que pegarlo a mano 23 segundos después.
 *
 * Medido con el pipeline real: la regla ya escrita por el dueño ("SIEMPRE
 * que el cliente pregunte por los productos envíale el link del catálogo")
 * fallaba 1 de cada 3 veces incluso corregida — no por un dato perdido, por
 * ser texto libre que el modelo puede o no seguir. Estas pruebas cubren la
 * garantía que no depende de que el modelo obedezca (docs/korexia/125).
 */

const ENLACE = "https://drive.google.com/file/d/1t3z5C1EMkGCzkSEX_CkCQMpZlaVmM8P7/view";

const FICHA_LIS = {
  reglasPropias: [
    "Tenes domicilios por rappi, este es el link para hacer tu pedido: https://rappi.app.link/Lis_Pasteleria",
    `SIEMPRE que el cliente pregunte por los productos O diga que quiere hacer un pedido, envíale ESTE link con las fotos y precios del catálogo: ${ENLACE} — eso es lo primero que tienes que hacer, antes de enviarle la lista de los productos en texto. Envíaselo con un mensaje bonito y cordial.`,
  ],
} as Pick<FichaDelNegocio, "reglasPropias">;

const KB_LIS = [
  {
    id: "kb_lispasteleria0010",
    kind: "qa",
    question: "¿Tienen redes sociales? ¿Dónde veo fotos?",
    answer: "Nos encuentran como @lispasteleriacali en Facebook, Instagram y TikTok.",
    content: null,
  },
  {
    id: "kb_szpybwdzki2fplmlombh",
    kind: "qa",
    question: "¿Tienen catálogo o fotos del menú para ver antes de pedir?",
    answer: `Sí, aquí puedes ver todas las fotos y precios: ${ENLACE}`,
    content: null,
  },
] as const;

describe("extraerContenidoObligatorio: qué cuenta como literal verificable", () => {
  it("saca el enlace de una regla propia con disparador (SIEMPRE que...) + URL", () => {
    const resultado = extraerContenidoObligatorio(FICHA_LIS, []);
    expect(resultado.map((r) => r.literal)).toContain(ENLACE);
  });

  /**
   * 24-ago-2026, encontrado midiendo en vivo: la regla de Rappi de Lis
   * ("Tenes domicilios por rappi... el link para hacer tu pedido: <url>")
   * NO tiene un disparador condicional — es una afirmación, no un "cuando
   * pase X". Sacar palabras clave de la frase entera le hacía compartir
   * "pedido" con la regla del catálogo, y el enlace de Rappi se colaba en
   * CUALQUIER mensaje que mencionara un pedido, sin que nadie preguntara
   * por domicilios. Una regla sin marcador se EXCLUYE por completo: es más
   * seguro no proteger una regla ambigua que proteger la equivocada.
   */
  it("una regla propia SIN disparador condicional (afirmación llana) no se extrae, aunque tenga URL", () => {
    const ficha = {
      reglasPropias: [
        "Tenes domicilios por rappi, este es el link para hacer tu pedido: https://rappi.app.link/Lis_Pasteleria",
      ],
    } as Pick<FichaDelNegocio, "reglasPropias">;
    expect(extraerContenidoObligatorio(ficha, [])).toEqual([]);
  });

  it("la MISMA regla, redactada con un disparador explícito, sí se extrae y con raíces limpias", () => {
    const ficha = {
      reglasPropias: [
        "SIEMPRE que el cliente pregunte por domicilios o por Rappi, envíale este link: https://rappi.app.link/Lis_Pasteleria",
      ],
    } as Pick<FichaDelNegocio, "reglasPropias">;
    const [rappi] = extraerContenidoObligatorio(ficha, []);
    expect(rappi?.literal).toBe("https://rappi.app.link/Lis_Pasteleria");
    // "pedido" NO debe colarse: no está en la cláusula del disparador.
    expect(rappi?.raices).not.toContain("pedi");
    expect(disparadoPor(["¿tienen domicilio?"], rappi!)).toBe(true);
    expect(disparadoPor(["Hola! Quiero hacer un pedido"], rappi!)).toBe(false);
  });

  it("saca el enlace de una entrada de conocimiento con URL", () => {
    const resultado = extraerContenidoObligatorio(undefined, KB_LIS);
    expect(resultado.some((r) => r.literal === ENLACE && r.fuente === "conocimiento")).toBe(true);
  });

  it("una entrada de conocimiento SIN URL no genera nada que verificar", () => {
    const resultado = extraerContenidoObligatorio(undefined, [KB_LIS[0]]);
    expect(resultado).toEqual([]);
  });

  it("una regla propia sin URL (tono, tamaño de respuesta) no genera nada", () => {
    const ficha = {
      reglasPropias: ["Nesito que las respuestas las des estructuradas, no todo junto en un solo mensaje."],
    } as Pick<FichaDelNegocio, "reglasPropias">;
    expect(extraerContenidoObligatorio(ficha, [])).toEqual([]);
  });

  it("sin ficha ni conocimiento, no revienta", () => {
    expect(extraerContenidoObligatorio(null, [])).toEqual([]);
  });
});

/**
 * 24-ago-2026 (docs/korexia/130): el mismo mecanismo cubre cualquier literal
 * INCONFUNDIBLE por su forma, no solo enlaces. Un correo y un teléfono con
 * prefijo internacional lo son; un número "pelado", un precio o un @usuario de
 * redes NO, y forzar la cifra equivocada sería peor que no forzar nada — por
 * eso quedan fuera a propósito (esperan al editor de literales declarados).
 */
describe("extraerContenidoObligatorio: literales verificables más allá del enlace", () => {
  it("saca un correo de una entrada de conocimiento", () => {
    const kb = [
      {
        id: "kb_correo",
        kind: "qa",
        question: "¿Cuál es su correo de contacto?",
        answer: "Escríbenos a ventas@negocio.com y te respondemos.",
        content: null,
      },
    ] as const;
    const resultado = extraerContenidoObligatorio(undefined, kb);
    expect(resultado.map((r) => r.literal)).toContain("ventas@negocio.com");
    expect(disparadoPor(["¿tienen correo?"], resultado[0]!)).toBe(true);
  });

  it("saca un correo de una regla propia con disparador condicional", () => {
    const ficha = {
      reglasPropias: [
        "SIEMPRE que el cliente pregunte por facturación, escríbele a facturacion@negocio.com.co",
      ],
    } as Pick<FichaDelNegocio, "reglasPropias">;
    const [regla] = extraerContenidoObligatorio(ficha, []);
    expect(regla?.literal).toBe("facturacion@negocio.com.co");
  });

  it("saca un teléfono CON prefijo internacional, con sus espacios tal cual", () => {
    const kb = [
      {
        id: "kb_tel",
        kind: "qa",
        question: "¿Cuál es su número de WhatsApp?",
        answer: "Escríbenos al +57 300 123 4567 en horario de oficina.",
        content: null,
      },
    ] as const;
    const resultado = extraerContenidoObligatorio(undefined, kb);
    expect(resultado.map((r) => r.literal)).toContain("+57 300 123 4567");
  });

  it("un teléfono LOCAL sin prefijo (dígitos sueltos) NO se extrae: choca con precios y cantidades", () => {
    const ficha = {
      reglasPropias: [
        "SIEMPRE que pregunten por el teléfono, dales el 3001234567 para que llamen.",
      ],
    } as Pick<FichaDelNegocio, "reglasPropias">;
    expect(extraerContenidoObligatorio(ficha, [])).toEqual([]);
  });

  it("un precio con signo (+50000) NO se confunde con un teléfono", () => {
    const ficha = {
      reglasPropias: [
        "SIEMPRE que pregunten el precio del domicilio, di que cuesta +50000 pesos.",
      ],
    } as Pick<FichaDelNegocio, "reglasPropias">;
    expect(extraerContenidoObligatorio(ficha, [])).toEqual([]);
  });

  it("un @usuario de redes (sin dominio) NO se confunde con un correo", () => {
    const kb = [
      {
        id: "kb_redes",
        kind: "qa",
        question: "¿Dónde los sigo?",
        answer: "Somos @negocio en Instagram y TikTok.",
        content: null,
      },
    ] as const;
    expect(extraerContenidoObligatorio(undefined, kb)).toEqual([]);
  });
});

describe("disparadoPor: el caso real de Maricel", () => {
  it("'quiero hacer un pedido' dispara la regla propia (pedir → pedido, por raíz)", () => {
    const [contenido] = extraerContenidoObligatorio(FICHA_LIS, []).filter(
      (c) => c.literal === ENLACE
    );
    expect(disparadoPor(["¡Hola! Quiero hacer un pedido"], contenido!)).toBe(true);
  });

  it("dispara también la entrada de conocimiento dedicada", () => {
    const [contenido] = extraerContenidoObligatorio(undefined, KB_LIS).filter(
      (c) => c.literal === ENLACE
    );
    expect(disparadoPor(["¡Hola! Quiero hacer un pedido"], contenido!)).toBe(true);
  });

  it("'¿qué productos tienen?' también dispara", () => {
    const [contenido] = extraerContenidoObligatorio(FICHA_LIS, []).filter(
      (c) => c.literal === ENLACE
    );
    expect(disparadoPor(["¿qué productos tienen?"], contenido!)).toBe(true);
  });

  it("un saludo suelto NO dispara", () => {
    const [contenido] = extraerContenidoObligatorio(FICHA_LIS, []).filter(
      (c) => c.literal === ENLACE
    );
    expect(disparadoPor(["Hola buenas tardes"], contenido!)).toBe(false);
  });

  it("preguntar por el domicilio NO dispara el enlace del catálogo", () => {
    const [contenido] = extraerContenidoObligatorio(FICHA_LIS, []).filter(
      (c) => c.literal === ENLACE
    );
    expect(disparadoPor(["¿hacen domicilio?"], contenido!)).toBe(false);
  });

});

describe("agregarContenidoFaltante: la última red, por tipo de acción", () => {
  const faltante = [{ id: "x", fuente: "reglaPropia" as const, raices: ["pedi"], literal: ENLACE }];

  it("a un reply le añade el enlace al final", () => {
    const action: AgentActionType = { action: "reply", text: "¡Hola! ¿Qué te gustaría pedir?" };
    const resultado = agregarContenidoFaltante(action, faltante) as { text: string };
    expect(resultado.text).toContain("¡Hola! ¿Qué te gustaría pedir?");
    expect(resultado.text).toContain(ENLACE);
  });

  it("a un update_lead sin reply previo, se lo crea", () => {
    const action: AgentActionType = { action: "update_lead", note: "pidió cremoso" };
    const resultado = agregarContenidoFaltante(action, faltante) as { reply?: string };
    expect(resultado.reply).toBe(ENLACE);
  });

  it("a un handoff con farewell, se lo añade sin perderlo", () => {
    const action: AgentActionType = { action: "handoff", farewell: "Ya te comunico con el equipo." };
    const resultado = agregarContenidoFaltante(action, faltante) as { farewell?: string };
    expect(resultado.farewell).toContain("Ya te comunico con el equipo.");
    expect(resultado.farewell).toContain(ENLACE);
  });

  it("a 'none' lo convierte en un reply con el enlace", () => {
    const action: AgentActionType = { action: "none" };
    const resultado = agregarContenidoFaltante(action, faltante);
    expect(resultado).toEqual({ action: "reply", text: ENLACE });
  });

  it("sin faltantes, no toca la acción", () => {
    const action: AgentActionType = { action: "reply", text: "listo" };
    expect(agregarContenidoFaltante(action, [])).toEqual(action);
  });

  it("si el enlace YA está, disparadoPor sigue viendo el turno como cumplido (no se duplica)", () => {
    // La comprobación de "qué falta" vive en pipeline.ts (textosAlCliente +
    // includes); aquí solo se prueba que agregar es idempotente en intención:
    // agregar dos veces seguidas simplemente concatena, así que quien llama
    // debe filtrar antes — lo hace pipeline.ts con `faltaDespues`.
    const action: AgentActionType = { action: "reply", text: `Aquí tienes: ${ENLACE}` };
    const resultado = agregarContenidoFaltante(action, faltante) as { text: string };
    expect((resultado.text.match(new RegExp(ENLACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length).toBe(2);
  });
});

describe("correccionDeContenidoFaltante: nombra lo que falta, nunca dice 'algo'", () => {
  it("incluye el enlace exacto en el texto de corrección", () => {
    const texto = correccionDeContenidoFaltante([
      { id: "x", fuente: "reglaPropia", raices: [], literal: ENLACE },
    ]);
    expect(texto).toContain(ENLACE);
    expect(texto.toLowerCase()).not.toContain("algo que falta");
  });
});

/**
 * INCIDENTE REAL (Lis Pastelería, 15-sep-2026, `cv_qe4v3mxc9txnxitfcgnm`).
 *
 * La MISMA raíz `pedi` que salva el caso de Maricel (arriba) causaba un
 * bucle a mitad de pedido. Sofi ya tenía el Cremoso Franui en su carrito:
 *
 *     CLIENTE  "Si me gustaría añadirlo a mi pedido"  → disparaba el catálogo
 *     BOT      [reenviaba la oferta completa con el link]
 *     CLIENTE  "Quiero añadirlo a mi pedido"          → disparaba otra vez
 *     BOT      [la misma frase, palabra por palabra]
 *
 * Tres veces, hasta que la atendió una persona. La distinción no es la
 * palabra sino el momento: con el carrito vacío "pedido" significa *quiero
 * empezar*; con algo dentro, *lo que ya estamos armando*.
 */
describe("el bucle de Sofi: 'pedido' a mitad de un pedido en curso", () => {
  const catalogoDeLis = extraerContenidoObligatorio(undefined, KB_LIS).filter(
    (c) => c.literal === ENLACE
  )[0]!;

  it("EL INCIDENTE: con el carrito lleno, 'añadirlo a mi pedido' ya NO pide el catálogo", () => {
    expect(disparadoPor(["Quiero añadirlo a mi pedido"], catalogoDeLis, true)).toBe(false);
    expect(disparadoPor(["Si me gustaría añadirlo a mi pedido"], catalogoDeLis, true)).toBe(false);
  });

  it("el caso de Maricel sigue intacto: con el carrito VACÍO sí lo pide", () => {
    expect(disparadoPor(["¡Hola! Quiero hacer un pedido"], catalogoDeLis, false)).toBe(true);
  });

  it("preguntar por el catálogo a mitad del pedido SÍ lo sigue enviando", () => {
    expect(disparadoPor(["¿tienen fotos del menú?"], catalogoDeLis, true)).toBe(true);
    expect(disparadoPor(["me pasas el catálogo?"], catalogoDeLis, true)).toBe(true);
  });

  it("sin el parámetro, se comporta como siempre (retrocompatible)", () => {
    expect(disparadoPor(["Quiero añadirlo a mi pedido"], catalogoDeLis)).toBe(true);
  });
});
