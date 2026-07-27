import { describe, expect, it } from "vitest";

/**
 * Ecos de la app del celular (coexistencia): sin esto, cuando el dueño
 * responde desde su teléfono el CRM no se entera y el agente le contesta
 * encima al mismo cliente.
 */

import { parseYcloudEcho } from "@/server/inbox/ycloud-webhook";

describe("mensajes enviados desde el celular del negocio", () => {
  it("extrae quién envía, a quién y el texto (que llega plano)", () => {
    const echo = parseYcloudEcho({
      type: "whatsapp.smb.message.echoes",
      whatsappMessage: {
        wamid: "wamid.eco.1",
        wabaId: "waba_a",
        from: "+573155136091",
        to: "+573046838172",
        sendTime: "2026-07-27T07:00:00Z",
        type: "text",
        text: "Ya te lo despacho, dame 10 minutos",
      },
    });
    expect(echo?.businessPhone).toBe("573155136091");
    expect(echo?.customerPhone).toBe("573046838172");
    expect(echo?.text).toBe("Ya te lo despacho, dame 10 minutos");
    expect(echo?.waMessageId).toBe("wamid.eco.1");
  });

  it("acepta también el texto en objeto, como el entrante", () => {
    const echo = parseYcloudEcho({
      type: "whatsapp.smb.message.echoes",
      whatsappMessage: {
        wamid: "wamid.eco.2",
        from: "+573155136091",
        to: "+573046838172",
        type: "text",
        text: { body: "listo" },
      },
    });
    expect(echo?.text).toBe("listo");
  });

  it("recoge las fotos que manda el negocio", () => {
    const echo = parseYcloudEcho({
      type: "whatsapp.smb.message.echoes",
      whatsappMessage: {
        wamid: "wamid.eco.3",
        from: "+573155136091",
        to: "+573046838172",
        type: "image",
        image: { id: "m1", link: "https://x/y", mime_type: "image/jpeg" },
      },
    });
    expect(echo?.type).toBe("image");
    expect(echo?.mediaUrl).toBe("https://x/y");
  });

  it("un eco sin destinatario no se procesa", () => {
    expect(
      parseYcloudEcho({
        type: "whatsapp.smb.message.echoes",
        whatsappMessage: { wamid: "x", from: "+573155136091" },
      })
    ).toBeNull();
  });

  it("un evento que no es eco devuelve null", () => {
    expect(parseYcloudEcho({ type: "whatsapp.inbound_message.received" })).toBeNull();
  });
});
