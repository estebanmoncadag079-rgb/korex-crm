import { describe, expect, it } from "vitest";
import {
  MAX_RESPUESTAS_REACTIVAS,
  hechoTelefonoConocido,
  siguientePasoDelCliente,
} from "@/server/lab/runner";
import { PERSONAS_PEDIDOS, reglasDe } from "@/server/lab/personas";

/**
 * Incidente real (28-ago-2026): en la prueba profunda de un cliente nuevo, el
 * escenario "cliente decidido" terminó sin cerrar el pedido. El bot SÍ había
 * preguntado "¿Confirmas el pedido...?" y el guion SÍ tenía programada una
 * respuesta de cierre para eso — pero el simulador cortaba la conversación en
 * cuanto se acababan las líneas fijas del guion, sin darle a esa reactiva la
 * oportunidad de sonar. El rojo era del banco de pruebas, no del agente.
 *
 * `siguientePasoDelCliente` es la decisión (guion vs. reactiva vs. "ya no hay
 * nada más que decir") separada de la base de datos y del LLM, para poder
 * probar exactamente esto sin levantar ninguno de los dos.
 */

const decidido = PERSONAS_PEDIDOS.find((p) => p.key === "comprador_decidido")!;
const reglas = reglasDe(decidido);

describe("siguientePasoDelCliente: la reactiva de cierre no se pierde", () => {
  it("con el guion agotado, si la última respuesta del agente pide confirmar, la toma", () => {
    const paso = siguientePasoDelCliente(decidido, reglas, {
      siguienteLinea: decidido.script.length, // guion YA agotado, como en el incidente
      reactivas: 0,
      usadas: new Set(),
      ultimaDelAgente: "¿Confirmas el pedido para que lo agendemos y lo pagues en efectivo al recibir?",
    });
    expect(paso?.tipo).toBe("reactiva");
    expect(paso?.texto.toLowerCase()).toMatch(/confirmo|as[ií] est[aá]/);
  });

  it("con el guion agotado y SIN nada que contestar, no hay más pasos (termina, no se cuelga)", () => {
    const paso = siguientePasoDelCliente(decidido, reglas, {
      siguienteLinea: decidido.script.length,
      reactivas: 0,
      usadas: new Set(),
      ultimaDelAgente: "¿Te gustaría ver nuestras fotos en Instagram?",
    });
    expect(paso).toBeNull();
  });

  it("agotado el cupo de reactivas, tampoco sigue aunque la última pregunta calce", () => {
    const paso = siguientePasoDelCliente(decidido, reglas, {
      siguienteLinea: decidido.script.length,
      reactivas: MAX_RESPUESTAS_REACTIVAS,
      usadas: new Set(),
      ultimaDelAgente: "¿Confirmas el pedido?",
    });
    expect(paso).toBeNull();
  });

  it("una reactiva ya usada no se repite, y sin nada más el turno termina", () => {
    const primera = siguientePasoDelCliente(decidido, reglas, {
      siguienteLinea: decidido.script.length,
      reactivas: 0,
      usadas: new Set(),
      ultimaDelAgente: "¿Confirmas el pedido?",
    });
    expect(primera?.tipo).toBe("reactiva");
    const usadas = new Set([(primera as { indice: number }).indice]);

    const segunda = siguientePasoDelCliente(decidido, reglas, {
      siguienteLinea: decidido.script.length,
      reactivas: 1,
      usadas,
      ultimaDelAgente: "¿Confirmas el pedido?", // el agente insiste con lo mismo
    });
    expect(segunda).toBeNull(); // no hay bucle: sin guion y sin reactiva nueva, se acabó
  });

  it("con guion pendiente, sigue el guion aunque la respuesta del agente calce una reactiva de otra persona", () => {
    // No debe "adelantarse": una reactiva solo compite cuando el agente
    // pregunta algo que el guion no iba a decir de todos modos. Aquí solo
    // confirmamos que con guion pendiente y sin pregunta previa, se manda la
    // siguiente línea fija.
    const paso = siguientePasoDelCliente(decidido, reglas, {
      siguienteLinea: 0,
      reactivas: 0,
      usadas: new Set(),
      ultimaDelAgente: null,
    });
    expect(paso).toEqual({ tipo: "script", texto: decidido.script[0] });
  });
});

/**
 * Incidente relacionado: el mismo escenario marcó "alucinación" un teléfono
 * que el agente nunca inventó — es el dato REAL del contacto de prueba, que
 * el agente recibe como hecho conocido (igual que en producción, donde ya
 * viene del número de WhatsApp que escribe). El juez no tenía forma de
 * distinguir esto de un dato inventado porque nunca se le decía. Corrección:
 * el juez, no el agente.
 */
describe("hechoTelefonoConocido: el juez sabe que el teléfono no es un invento", () => {
  it("nombra el teléfono exacto de la persona y aclara que no es alucinación", () => {
    const texto = hechoTelefonoConocido("5210000000001");
    expect(texto).toContain("5210000000001");
    expect(texto.toLowerCase()).toContain("no es una alucinación");
  });
});
