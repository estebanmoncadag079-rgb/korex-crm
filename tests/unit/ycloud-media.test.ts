import { describe, expect, it } from "vitest";

/**
 * Adjuntos entrantes: el caso que importa es el comprobante de pago. Si el
 * enlace del medio no se extrae, el negocio ve "Imagen" y no puede verificar
 * la transferencia.
 */

import { parseYcloudInbound } from "@/server/inbox/ycloud-webhook";

const base = {
  id: "wamid.1",
  wabaId: "waba_a",
  from: "+573046838172",
  to: "+573155136091",
  customerProfile: { name: "Cliente" },
  sendTime: "2026-07-27T05:00:00Z",
};

describe("adjuntos de mensajes entrantes", () => {
  it("extrae el enlace, el id y el tipo de una imagen", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        ...base,
        type: "image",
        image: {
          id: "media_1",
          link: "https://api.ycloud.com/v2/whatsapp/media/download/abc",
          mime_type: "image/jpeg",
        },
      },
    });
    expect(parsed?.type).toBe("image");
    expect(parsed?.mediaUrl).toBe(
      "https://api.ycloud.com/v2/whatsapp/media/download/abc"
    );
    expect(parsed?.mediaId).toBe("media_1");
    expect(parsed?.mimeType).toBe("image/jpeg");
  });

  it("usa el pie de foto como texto del mensaje", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        ...base,
        type: "image",
        image: { id: "m", link: "https://x/y", caption: "ahí va el pago" },
      },
    });
    expect(parsed?.text).toBe("ahí va el pago");
  });

  it("acepta documentos y usa el nombre del archivo cuando no hay pie", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        ...base,
        type: "document",
        document: {
          id: "m2",
          link: "https://x/doc",
          filename: "comprobante.pdf",
          mimeType: "application/pdf",
        },
      },
    });
    expect(parsed?.text).toBe("comprobante.pdf");
    expect(parsed?.mimeType).toBe("application/pdf");
    expect(parsed?.mediaUrl).toBe("https://x/doc");
  });

  it("un mensaje de texto normal sigue sin adjunto", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: { ...base, type: "text", text: { body: "hola" } },
    });
    expect(parsed?.text).toBe("hola");
    expect(parsed?.mediaUrl).toBeNull();
    expect(parsed?.mediaId).toBeNull();
  });

  it("un audio sin enlace no revienta el parseo", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: { ...base, type: "audio", audio: { id: "a1" } },
    });
    expect(parsed?.type).toBe("audio");
    expect(parsed?.mediaId).toBe("a1");
    expect(parsed?.mediaUrl).toBeNull();
  });
});
