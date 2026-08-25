import { describe, expect, it } from "vitest";
import { parseYcloudInbound } from "@/server/inbox/ycloud-webhook";

/**
 * Cuando el cliente TOCA una opción de un menú guiado (25-ago-2026), YCloud
 * manda `type: "interactive"` con el título elegido en `list_reply`/
 * `button_reply` — no en `text`. Se convierte en un mensaje de texto normal
 * con ese título, igual que ya se hace con una edición (`ycloud-edit.test.ts`):
 * el resto del pipeline no necesita saber que el cliente tocó en vez de
 * escribir.
 */
describe("el cliente toca una opción del menú guiado (type: interactive)", () => {
  it("una fila de lista (list_reply) se convierte en el texto del mensaje", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "wamid.lista1",
        wabaId: "waba_a",
        from: "+573046838172",
        to: "+573158339990",
        sendTime: "2026-08-25T22:00:45.000Z",
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: { id: "prod_x0iwpqqhvvojice10bts", title: "Porción Chocolate" },
        },
      },
    });

    expect(parsed?.text).toBe("Porción Chocolate");
    expect(parsed?.type).toBe("text");
  });

  it("un botón (button_reply) se convierte en el texto del mensaje", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "wamid.boton1",
        wabaId: "waba_a",
        from: "+573046838172",
        to: "+573158339990",
        sendTime: "2026-08-25T22:00:45.000Z",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "pedido", title: "Hacer un pedido" },
        },
      },
    });

    expect(parsed?.text).toBe("Hacer un pedido");
    expect(parsed?.type).toBe("text");
  });

  it("un interactive sin list_reply ni button_reply (payload inesperado) no revienta: queda sin texto", () => {
    const parsed = parseYcloudInbound({
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: "wamid.raro",
        wabaId: "waba_a",
        from: "+573046838172",
        to: "+573158339990",
        sendTime: "2026-08-25T22:00:45.000Z",
        type: "interactive",
      },
    });

    expect(parsed?.text).toBeNull();
    expect(parsed?.type).toBe("interactive");
  });
});
