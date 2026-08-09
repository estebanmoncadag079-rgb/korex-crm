import { describe, expect, it } from "vitest";
import { conContextoDeRespuesta } from "@/server/inbox/ingest";
import { parseYcloudInbound } from "@/server/inbox/ycloud-webhook";

/**
 * A qué está respondiendo el cliente (9-ago-2026).
 *
 * Caso real que lo destapó: una clienta respondió a una historia de Lis con
 * "Qué es eso tan ricón?" y el agente, que no puede ver la historia, contestó
 * "te refieres a los cremosos, ¿verdad?" — era un latte frío. Karen tuvo que
 * corregirlo a mano.
 *
 * El webhook SÍ traía la señal (`context`) y se descartaba entera. Medido sobre
 * 489 entrantes reales: 40 citaban un mensaje del chat y 6 respondían a un
 * estado.
 */

describe("parseYcloudInbound: reconoce a qué responde el cliente", () => {
  const base = {
    id: "evt_1",
    wabaId: "waba_1",
    from: "+573167411649",
    to: "+573158339990",
    sendTime: "2026-08-08T21:48:43.000Z",
    type: "text",
    text: { body: "Qué es eso tan ricon?" },
  };

  it("respuesta a un ESTADO: hay contexto pero sin mensaje que citar", () => {
    // Payload real de producción (Dany B, 8-ago-2026).
    const parsed = parseYcloudInbound({
      whatsappInboundMessage: { ...base, context: { from: "573158339990" } },
    } as Parameters<typeof parseYcloudInbound>[0]);

    expect(parsed?.respondeAEstado).toBe(true);
    expect(parsed?.replyToWamid).toBeNull();
  });

  it("cita de un mensaje del chat: se queda con el wamid citado", () => {
    const parsed = parseYcloudInbound({
      whatsappInboundMessage: {
        ...base,
        context: { from: "573158339990", id: "wamid.CITADO" },
      },
    } as Parameters<typeof parseYcloudInbound>[0]);

    expect(parsed?.replyToWamid).toBe("wamid.CITADO");
    expect(parsed?.respondeAEstado).toBe(false);
  });

  it("mensaje normal: sin contexto, no se inventa ninguno", () => {
    const parsed = parseYcloudInbound({
      whatsappInboundMessage: base,
    } as Parameters<typeof parseYcloudInbound>[0]);

    expect(parsed?.replyToWamid).toBeNull();
    expect(parsed?.respondeAEstado).toBe(false);
  });
});

describe("conContextoDeRespuesta: qué acaba viendo el agente", () => {
  it("con un mensaje citado, se lo pone delante", () => {
    const texto = conContextoDeRespuesta("¿y este cuánto vale?", {
      citado: "Cremoso de 16 oz · $22.000",
    });
    expect(texto).toBe(
      '[RESPONDE A ESTE MENSAJE TUYO: "Cremoso de 16 oz · $22.000"]\n¿y este cuánto vale?'
    );
  });

  it("recorta una cita larguísima para no comerse el contexto", () => {
    const largo = "a".repeat(400);
    const texto = conContextoDeRespuesta("¿ese?", { citado: largo }) ?? "";
    expect(texto.length).toBeLessThan(260);
    expect(texto).toContain("…");
  });

  it("aplana los saltos de línea de la cita", () => {
    const texto = conContextoDeRespuesta("sí", {
      citado: "Cremoso\n\nde 16 oz",
    });
    expect(texto).toContain('"Cremoso de 16 oz"');
  });

  it("ante un ESTADO avisa de que NO puede saber qué había", () => {
    const texto = conContextoDeRespuesta("Qué es eso tan ricon?", {
      respondeAEstado: true,
    });
    expect(texto).toBe(
      "[RESPONDE A UNA PUBLICACIÓN DEL NEGOCIO — no sabes qué contenía]\nQué es eso tan ricon?"
    );
  });

  it("sin contexto, el mensaje pasa intacto", () => {
    expect(conContextoDeRespuesta("hola", {})).toBe("hola");
    expect(conContextoDeRespuesta(null, {})).toBeNull();
  });

  it("una reacción a un estado sin texto no queda como marca huérfana", () => {
    expect(conContextoDeRespuesta(null, { respondeAEstado: true })).toBe(
      "[RESPONDE A UNA PUBLICACIÓN DEL NEGOCIO — no sabes qué contenía]"
    );
  });
});
