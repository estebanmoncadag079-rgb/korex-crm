import { describe, expect, it } from "vitest";
import {
  correccionDeResumen,
  resumenMalArmado,
} from "@/server/ai/anuncio-de-cierre";

/**
 * El resumen mal armado (12-ago-2026).
 *
 * Dos casos reales de Lis Pastelería, el mismo día:
 *
 *  • **Gio** — el agente mandó el resumen completo y CORRECTO, pero le pegó al
 *    final el mensaje de despedida ("Marca 0 para volver a empezar"). Para él
 *    la conversación ya había terminado: cuando Gio escribió "Confirmo", no
 *    respondió nada y NUNCA mandó los datos de pago. La dueña los escribió a
 *    mano, y al hacerlo activó el relevo humano, que silencia al agente 2 h.
 *
 *  • **Leidy** — "Aquí tienes el resumen de tu pedido" … y ningún resumen.
 *    Sin productos, sin total, sin la línea del domicilio. La clienta contestó
 *    "Sí" a algo que nunca vio.
 *
 * Medido sobre los 24 resúmenes reales de Lis: 19 con cierre prematuro (79 %)
 * y 3 sin contenido (12 %). La Churra, con otro prompt: 0 de 12.
 */

/** El resumen bueno, tal cual sale del pipeline real tras arreglar el prompt. */
const RESUMEN_BUENO = `¡Gracias, Leidy! 💗 Aquí está el resumen de tu pedido:
• Producto(s): 2 Cremosos 16 oz — $44.000
• Topping(s): AREQUIPE, OREO, MILO y LULO, MANGO, MARACUYÁ
• Nombre: Leidy Cardenas
• Celular: 3137795864
• Entrega: Cll 29#32a 18 el jardin
🛵 *El domicilio se paga aparte, directo al repartidor cuando llega.*
💰 *Total: $44.000 (sin incluir domicilio)*

👉 *POR FAVOR, CONFIRMA TU PEDIDO* 👈
*¿Está todo correcto?* 😊`;

/** La despedida legítima: va DESPUÉS de que el cliente confirma. */
const DESPEDIDA_LEGITIMA = `¡Fantástico, Leidy! 🎉 Tu pedido ha sido confirmado.

💳 *Para el pago:*
🔑 *Llave:* 0089174299
🏦 *Bancolombia — Ahorros:* 51400008565

¡Gracias por elegirnos! Estamos preparando todo con mucho amor 💗🍰
*Marca 0 para volver a empezar.*`;

describe("resumenMalArmado: no molesta cuando todo está bien", () => {
  it("acepta el resumen correcto", () => {
    expect(resumenMalArmado(RESUMEN_BUENO)).toBeNull();
  });

  it("acepta la despedida legítima, que no pide confirmación", () => {
    expect(resumenMalArmado(DESPEDIDA_LEGITIMA)).toBeNull();
  });

  it("no se mete en mensajes normales de la conversación", () => {
    expect(resumenMalArmado("¡Hola! 💗 ¿Qué se te antoja hoy?")).toBeNull();
    expect(
      resumenMalArmado("El Cremoso de 16 oz vale $22.000 y lleva 3 toppings.")
    ).toBeNull();
    expect(resumenMalArmado(null)).toBeNull();
    expect(resumenMalArmado("")).toBeNull();
  });

  it("acepta un resumen aunque le falte alguna viñeta, si trae el total", () => {
    // Puede faltar la tarjeta o el regalo; lo que no puede faltar es la cifra.
    expect(
      resumenMalArmado(
        "Aquí está el resumen de tu pedido:\n• 1 Cremoso 7 oz\n💰 *Total: $12.000*\n¿Está todo correcto?"
      )
    ).toBeNull();
  });
});

describe("A · cierre prematuro: pide confirmar y ya se despide", () => {
  it("detecta el caso real de Gio (despedida pegada al resumen)", () => {
    const texto = `${RESUMEN_BUENO}\n\n¡Gracias por elegirnos! Estamos preparando todo con mucho amor 💗🍰\n*Marca 0 para volver a empezar.*`;
    expect(resumenMalArmado(texto)).toBe("cierre-prematuro");
  });

  it("detecta los datos de pago soltados antes de confirmar", () => {
    const texto = `${RESUMEN_BUENO}\n\n💳 *Para el pago:*\n🔑 *Llave:* 0089174299`;
    expect(resumenMalArmado(texto)).toBe("cierre-prematuro");
  });

  it("detecta 'ya lo estamos preparando' antes de que confirme", () => {
    expect(
      resumenMalArmado(
        "💰 *Total: $44.000*\n👉 CONFIRMA TU PEDIDO 👈\nEstamos preparando todo con mucho amor 💗"
      )
    ).toBe("cierre-prematuro");
  });
});

describe("B · sin contenido: anuncia un resumen que no existe", () => {
  it("detecta el caso real de Leidy", () => {
    expect(
      resumenMalArmado(
        "¡Gracias por elegirnos, Leidy! 💗 Aquí tienes el resumen de tu pedido, ya lo estamos preparando con mucho amor para ti. Una vez confirmes, te enviaré los datos de pago. 🍰\n\n*¿Está todo correcto?* 😊"
      )
    ).toBe("cierre-prematuro"); // gana el fallo más caro: también se despide
  });

  it("detecta el anuncio vacío sin rastro de despedida", () => {
    expect(
      resumenMalArmado("¡Gracias! Aquí está el resumen de tu pedido. ¿Todo bien?")
    ).toBe("sin-contenido");
  });

  it("reconoce el total escrito de varias formas", () => {
    const conTotal = (t: string) =>
      resumenMalArmado(`Aquí está el resumen de tu pedido: ${t}`);
    expect(conTotal("Total: $12.000")).toBeNull();
    expect(conTotal("💰 *Total: $ 44.000 (sin incluir domicilio)*")).toBeNull();
    expect(conTotal("total $1.250,50")).toBeNull();
  });
});

describe("correccionDeResumen: le dice al modelo qué hacer", () => {
  it("la del cierre prematuro le prohíbe despedirse y pedir el pago", () => {
    const c = correccionDeResumen("cierre-prematuro");
    expect(c).toMatch(/TERMINAR/i);
    expect(c).toMatch(/datos de pago/i);
    expect(c).toMatch(/Responde ÚNICAMENTE el objeto JSON\.$/);
  });

  it("la del resumen vacío le exige el detalle y el total", () => {
    const c = correccionDeResumen("sin-contenido");
    expect(c).toMatch(/total/i);
    expect(c).toMatch(/Responde ÚNICAMENTE el objeto JSON\.$/);
  });
});
