import { describe, expect, it } from "vitest";

/**
 * Cuando el cliente edita un mensaje de texto reciente en WhatsApp, YCloud
 * manda `type: "edit"` con `text` vacío — el contenido nuevo viaja en
 * `edit.message.text.body`. Sin leer ese campo, el agente veía un marcador
 * "[mensaje no compatible: tipo edit...]" en vez del texto real, y podía
 * reaccionar sin sentido (caso real: ejecutó `handoff` al verlo, en Lis
 * Pastelería, 3-ago-2026). Payload verificado en producción el mismo día
 * reproduciendo el caso con una edición real.
 */

import { parseYcloudInbound } from "@/server/inbox/ycloud-webhook";

describe("edición de un mensaje de texto (type: edit)", () => {
  it("extrae el texto nuevo de edit.message.text.body y lo trata como texto normal", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "6a710f8eaff1a13d35b7c211",
        wabaId: "190143772066943",
        from: "+573046838172",
        customerProfile: {},
        to: "+573158339990",
        sendTime: "2026-08-03T22:00:45.000Z",
        type: "edit",
        edit: {
          originalMessageId:
            "wamid.HBgMNTczMDQ2ODM4MTcyFQIAEhgWM0VCMDJGQTQwRjY1M0E2NzE1QTZBNQA=",
          message: { type: "text", text: { body: "quiero un cremoso de 16 oz" } },
        },
      },
    });

    expect(parsed?.text).toBe("quiero un cremoso de 16 oz");
    // Normalizado a "text": se ve y se procesa como un mensaje de texto
    // normal, no como el marcador "no compatible" de un tipo sin contenido.
    expect(parsed?.type).toBe("text");
  });

  it("una edición sin edit.message (payload inesperado) no revienta: queda sin texto", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "wamid.raro",
        wabaId: "waba_a",
        from: "+573046838172",
        to: "+573155136091",
        sendTime: "2026-08-03T22:00:45.000Z",
        type: "edit",
      },
    });

    expect(parsed?.text).toBeNull();
    expect(parsed?.type).toBe("edit");
  });
});
