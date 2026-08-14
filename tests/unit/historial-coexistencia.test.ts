import { describe, expect, it } from "vitest";
import { parseYcloudHistory } from "@/server/inbox/ycloud-webhook";

/**
 * El historial que sincroniza la coexistencia.
 *
 * Al conectar un número, WhatsApp manda hasta 6 meses de chats anteriores y
 * YCloud los reenvía como `whatsapp.smb.history`. Hasta el 14-ago-2026 caían en
 * el "evento ignorado" y se perdían: con ellos, todo lo que el negocio ya le
 * había contestado a sus clientas durante meses — el mejor material que existe
 * para su conocimiento.
 *
 * Un evento trae UNO de los dos lados, nunca los dos.
 */

const ENTRANTE = {
  type: "whatsapp.smb.history",
  whatsappInboundMessage: {
    id: "wamid.HIST_IN_1",
    wabaId: "waba_1",
    from: "573001112233",
    to: "+573009998877",
    type: "text",
    text: { body: "Hola, ¿tienen cita para el sábado?" },
    sendTime: "2026-03-02T14:30:00Z",
    customerProfile: { name: "Andrea" },
  },
};

const SALIENTE = {
  type: "whatsapp.smb.history",
  whatsappMessage: {
    wamid: "wamid.HIST_OUT_1",
    wabaId: "waba_1",
    from: "+573009998877",
    to: "573001112233",
    type: "text",
    text: { body: "¡Claro! El sábado tenemos a las 10 y a las 3 🌸" },
    sendTime: "2026-03-02T14:35:00Z",
  },
};

describe("parseYcloudHistory", () => {
  it("lee lo que escribió la clienta, con su fecha real", () => {
    const m = parseYcloudHistory(ENTRANTE)!;
    expect(m.direction).toBe("in");
    expect(m.customerPhone).toBe("573001112233");
    expect(m.businessPhone).toBe("573009998877"); // sin el "+"
    expect(m.text).toBe("Hola, ¿tienen cita para el sábado?");
    expect(m.profileName).toBe("Andrea");
    // Marzo de 2026, no "ahora": de eso depende que se lea en orden.
    expect(new Date(Number(m.unixTs) * 1000).toISOString()).toBe(
      "2026-03-02T14:30:00.000Z"
    );
  });

  it("lee lo que respondió el negocio desde su celular", () => {
    const m = parseYcloudHistory(SALIENTE)!;
    expect(m.direction).toBe("out");
    // En el saliente los papeles se invierten: `from` es el negocio.
    expect(m.businessPhone).toBe("573009998877");
    expect(m.customerPhone).toBe("573001112233");
    expect(m.text).toContain("El sábado tenemos");
  });

  /** Una clienta con nombre de usuario de WhatsApp no expone su teléfono. */
  it("acepta el identificador de usuario cuando no hay teléfono", () => {
    const m = parseYcloudHistory({
      type: "whatsapp.smb.history",
      whatsappInboundMessage: {
        id: "wamid.HIST_IN_2",
        wabaId: "waba_1",
        fromUserId: "CO.1234567890",
        to: "+573009998877",
        type: "text",
        text: { body: "buenas" },
        sendTime: "2026-04-01T10:00:00Z",
      },
    })!;
    expect(m.customerPhone).toBeNull();
    expect(m.customerWaUserId).toBe("CO.1234567890");
  });

  it("descarta un evento sin los datos mínimos en vez de inventarlos", () => {
    expect(parseYcloudHistory({ type: "whatsapp.smb.history" })).toBeNull();
    expect(
      parseYcloudHistory({
        type: "whatsapp.smb.history",
        whatsappInboundMessage: { id: "wamid.X", wabaId: "waba_1", to: "+57300" },
      })
    ).toBeNull();
  });
});

/* ============================================================
 * Lo que de verdad no puede pasar
 * ============================================================ */

/**
 * Un mensaje del historial NO puede entrar por el camino de un mensaje nuevo.
 *
 * Si entrara, `ingestInboundMessage` despertaría al agente y el negocio
 * amanecería con el bot respondiendo a decenas de clientas sobre pedidos de
 * hace meses — a algunas, varias veces. Es el peor estreno posible para un
 * cliente que acaba de conectar su número.
 */
describe("un chat viejo no despierta al agente", () => {
  it("el historial va a su propia puerta, no a la de los mensajes nuevos", async () => {
    const { vi } = await import("vitest");

    const ingestHistoryMessage = vi.fn().mockResolvedValue({ guardado: true });
    const ingestInboundMessage = vi.fn();
    const ingestOutboundEcho = vi.fn();

    vi.doMock("@/server/inbox/ingest", () => ({
      ingestHistoryMessage,
      ingestInboundMessage,
      ingestOutboundEcho,
    }));
    vi.doMock("@/server/inbox/ycloud-routing", () => ({
      resolveRoute: () => Promise.resolve({ organizationId: "org_1" }),
      resolveInboundRoute: () => Promise.resolve({ organizationId: "org_1" }),
    }));
    vi.doMock("@/server/ai/notify-team", () => ({ notifyTeam: vi.fn() }));

    vi.resetModules();
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");
    const res = await handleYcloudEvent(ENTRANTE);

    expect(res.organizationId).toBe("org_1");
    expect(ingestHistoryMessage).toHaveBeenCalledTimes(1);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
    expect(ingestOutboundEcho).not.toHaveBeenCalled();

    vi.doUnmock("@/server/inbox/ingest");
    vi.doUnmock("@/server/inbox/ycloud-routing");
    vi.doUnmock("@/server/ai/notify-team");
    vi.resetModules();
  });
});
