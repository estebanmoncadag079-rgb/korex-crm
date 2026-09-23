import { describe, expect, it } from "vitest";
import { primerTextoDegenerado, textoDegenerado } from "@/server/ai/integridad-de-salida";

/**
 * La última barrera antes de WhatsApp (22-sep-2026, MALIA con GPT-5 mini).
 *
 * Una respuesta salió con `}]}]}` pegado y restos del formato interno del
 * modelo, y llegó al cliente. La causa de que llegara NO es que el modelo
 * fallara —eso va a pasar siempre—, es que **nada miraba el texto**: el
 * adaptador comprueba que la respuesta sea JSON (`extractJson`) y que cumpla
 * el contrato (Zod), y las dos cosas son ciertas de un objeto perfectamente
 * formado cuyo campo `reply` trae basura dentro de las comillas. La
 * validación estructural no dice nada sobre si el TEXTO se puede leer.
 *
 * El detector es deliberadamente corto de manga: un falso positivo no es un
 * mensaje feo, es un cliente que recibe "te paso con una persona" en vez de
 * su respuesta. Por eso solo reconoce lo que ningún mensaje de WhatsApp de
 * verdad contiene, y por eso el bloque de falsos positivos de abajo pesa
 * tanto como el de detección.
 */
describe("textoDegenerado: lo que NO puede salir", () => {
  it("el caso real: restos estructurales del formato de respuesta", () => {
    const caso = "Perfecto, te confirmo el pedido 😊 }]}]}";
    expect(textoDegenerado(caso)?.motivo).toBe("resto-estructural");
  });

  it("una cola de cierres sin nada que cierren, aunque venga sola", () => {
    expect(textoDegenerado('"}]}')?.motivo).toBe("resto-estructural");
  });

  it("texto interno del modelo: el nombre del formato de respuesta", () => {
    const caso = "Claro, aquí tienes. response_format: json_schema";
    expect(textoDegenerado(caso)?.motivo).toBe("texto-interno");
  });

  it("texto interno del modelo: el contrato de acciones colándose en el reply", () => {
    const caso = 'Listo 😊 {"action": "reply", "text": "Listo"}';
    expect(textoDegenerado(caso)?.motivo).toBe("texto-interno");
  });

  it("una respuesta que el proveedor cortó por longitud se marca como truncada", () => {
    const caso = "Tu pedido lleva dos unidades y el total es de";
    expect(textoDegenerado(caso, { finishReason: "length" })?.motivo).toBe("truncado");
  });

  it("un texto vacío no es una respuesta", () => {
    expect(textoDegenerado("   \n  ")?.motivo).toBe("vacio");
  });

  it("dice por qué, con la evidencia recortada, para que el log sirva", () => {
    const d = textoDegenerado("Listo }]}]}");
    expect(d?.evidencia).toContain("}]}]}");
  });
});

/**
 * CA-08. Cada uno de estos es una respuesta que hoy sale y tiene que seguir
 * saliendo. Si alguna de estas pruebas se pone roja, el detector está
 * costando ventas, no evitándolas.
 */
describe("textoDegenerado: lo que SÍ puede salir (falsos positivos)", () => {
  const LEGITIMAS: [string, string][] = [
    [
      "un catálogo entero con viñetas, precios y emojis",
      [
        "¡Hola! 😊 Te cuento lo que tenemos hoy:",
        "",
        "*CREMOSOS*",
        "• Cremoso 7 oz — $12.000 (elige 1 topping)",
        "• Cremoso 12 oz — $18.000 (elige 2 toppings)",
        "• Cremoso 16 oz — $22.000",
        "",
        "Y los toppings que puedes elegir:",
        "• MILO",
        "• OREO",
        "• AREQUIPE",
        "",
        "¿Cuál te provoca? 🍰",
      ].join("\n"),
    ],
    ["signos y paréntesis anidados", "El total (con domicilio incluido) es $32.000 :) ¿Te lo confirmo?"],
    ["corchetes de verdad en el texto", "Te dejo la nota [urgente] para el equipo."],
    ["JSON mencionado como texto, bien formado", 'Te lo paso así: {"producto": "Torta", "cantidad": 2}'],
    ["JSON anidado, que termina en varios cierres pero cuadra", 'Queda {"pedido": {"items": [1, 2]}} listo.'],
    ["una carita con paréntesis repetidos", "Muchas gracias!!! :))) Nos vemos 😊"],
    ["guiones largos, comillas y acentos", "Perfecto —te lo dejo apartado—, «con mucho cariño» ✨"],
    ["un total con separadores de miles", "Son 3 unidades × $12.000 = $36.000 + $8.000 de domicilio."],
    ["un enlace", "Aquí está el catálogo: https://ejemplo.com/menu?id=7&ref=wa"],
    ["una respuesta larga sin nada raro", "Claro que sí. ".repeat(60)],
  ];

  for (const [nombre, texto] of LEGITIMAS) {
    it(`no bloquea: ${nombre}`, () => {
      expect(textoDegenerado(texto)).toBeNull();
    });
  }

  it("finish_reason normal no marca nada", () => {
    expect(textoDegenerado("Listo, ya quedó 😊", { finishReason: "stop" })).toBeNull();
  });
});

/**
 * Una acción puede llevar más de un texto al cliente: `notify_order` manda el
 * resumen al equipo y la despedida al cliente. Si uno de los dos está roto, el
 * turno no sirve — mandar solo la mitad buena de un cierre deja al cliente
 * creyendo que su pedido existe.
 */
describe("primerTextoDegenerado: basta con que UNO esté roto", () => {
  it("encuentra el roto aunque venga después de uno sano", () => {
    const d = primerTextoDegenerado(["Pedido de Yuli, 2 unidades, $24.000", "Gracias! }]}]}"]);
    expect(d?.motivo).toBe("resto-estructural");
  });

  it("devuelve null cuando todos se pueden enviar", () => {
    expect(primerTextoDegenerado(["Resumen del pedido", "¡Gracias! 😊"])).toBeNull();
  });

  it("una lista vacía no es un fallo: hay acciones que no le escriben al cliente", () => {
    expect(primerTextoDegenerado([])).toBeNull();
  });

  it("propaga el finish_reason a cada texto", () => {
    const d = primerTextoDegenerado(["Tu total es de"], { finishReason: "length" });
    expect(d?.motivo).toBe("truncado");
  });
});
