import { describe, expect, it } from "vitest";

/**
 * WhatsApp lanzó "nombres de usuario" en 2026: el cliente puede ocultar su
 * teléfono al negocio, y YCloud manda `fromUserId`/`toUserId` en vez de
 * `from`/`to`. Verificado en vivo el 2-ago-2026 en Lis y La Churra — sin este
 * parseo el mensaje se descartaba en silencio (FR: nunca perder un mensaje).
 */

import { parseYcloudEcho, parseYcloudInbound } from "@/server/inbox/ycloud-webhook";

describe("mensajes entrantes de un cliente con nombre de usuario (sin teléfono)", () => {
  it("usa fromUserId cuando no viene from, y deja from en null", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "wamid.1",
        wabaId: "waba_a",
        fromUserId: "CO.1364549445033644",
        to: "+573155136091",
        customerProfile: { name: "Cliente", username: "cliente123" },
        sendTime: "2026-08-02T05:00:00Z",
        type: "text",
        text: { body: "hola" },
      },
    });
    expect(parsed?.from).toBeNull();
    expect(parsed?.waUserId).toBe("CO.1364549445033644");
    expect(parsed?.text).toBe("hola");
  });

  it("sin fromUserId en el evento, waUserId queda en null", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "wamid.2",
        wabaId: "waba_a",
        from: "+573046838172",
        to: "+573155136091",
        type: "text",
        text: { body: "hola" },
      },
    });
    expect(parsed?.from).toBe("573046838172");
    expect(parsed?.waUserId).toBeNull();
  });

  /**
   * El caso NORMAL, contra lo que se creía: 98 de 99 eventos reales traen las
   * dos señales (medido el 5-ago-2026 sobre `webhook_event`). Payload real de
   * Heidy Chinguad, Lis Pastelería, 4-ago-2026. Guardar solo el teléfono era
   * lo que dejaba al contacto listo para duplicarse.
   */
  it("cuando vienen from Y fromUserId, conserva LAS DOS señales", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "6a7214dc4223092dfcffb074",
        wabaId: "190143772066943",
        from: "+573165345762",
        fromUserId: "CO.1031124232991481",
        to: "+573158339990",
        customerProfile: { name: "Heidy Chinguad", username: "HeidyChinguad" },
        type: "text",
        text: { body: "hola" },
      },
    });
    expect(parsed?.from).toBe("573165345762");
    expect(parsed?.waUserId).toBe("CO.1031124232991481");
  });

  it("sin from ni fromUserId, no hay nada procesable → null", () => {
    expect(
      parseYcloudInbound({
        type: "whatsapp.inbound_message.received",
        whatsappInboundMessage: {
          id: "wamid.3",
          wabaId: "waba_a",
          to: "+573155136091",
          type: "text",
          text: { body: "hola" },
        },
      })
    ).toBeNull();
  });
});

describe("ecos hacia un cliente con nombre de usuario (sin teléfono)", () => {
  it("usa toUserId cuando no viene to, y deja customerPhone en null", () => {
    const echo = parseYcloudEcho({
      type: "whatsapp.smb.message.echoes",
      whatsappMessage: {
        wamid: "wamid.eco.1",
        wabaId: "waba_a",
        from: "+573155136091",
        toUserId: "CO.1364549445033644",
        type: "text",
        text: "Con gusto, ¿para cuándo la cita?",
      },
    });
    expect(echo?.customerPhone).toBeNull();
    expect(echo?.customerWaUserId).toBe("CO.1364549445033644");
  });

  it("sin toUserId en el evento, customerWaUserId queda en null", () => {
    const echo = parseYcloudEcho({
      type: "whatsapp.smb.message.echoes",
      whatsappMessage: {
        wamid: "wamid.eco.2",
        wabaId: "waba_a",
        from: "+573155136091",
        to: "+573046838172",
        type: "text",
        text: "listo",
      },
    });
    expect(echo?.customerPhone).toBe("573046838172");
    expect(echo?.customerWaUserId).toBeNull();
  });

  it("cuando vienen to Y toUserId, conserva las dos señales", () => {
    const echo = parseYcloudEcho({
      type: "whatsapp.smb.message.echoes",
      whatsappMessage: {
        wamid: "wamid.eco.3",
        wabaId: "waba_a",
        from: "+573155136091",
        to: "+573046838172",
        toUserId: "CO.1364549445033644",
        type: "text",
        text: "listo",
      },
    });
    expect(echo?.customerPhone).toBe("573046838172");
    expect(echo?.customerWaUserId).toBe("CO.1364549445033644");
  });

  it("sin to ni toUserId, no se procesa", () => {
    expect(
      parseYcloudEcho({
        type: "whatsapp.smb.message.echoes",
        whatsappMessage: { wamid: "x", from: "+573155136091" },
      })
    ).toBeNull();
  });
});
