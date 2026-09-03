import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10H — delivery status de YCloud (`whatsapp.message.updated`):
 * parseo puro, resolución de organización por mensaje, aislamiento
 * multi-tenant, y la escritura extendida en `applyStatusUpdate()` que
 * ahora también anota `campaignRecipient.deliveredAt`/`readAt`.
 */

const applyStatusUpdateMock = vi.fn();
const organizationIdDeMensajeMock = vi.fn();
vi.mock("@/server/inbox/status", () => ({
  applyStatusUpdate: (...args: unknown[]) => applyStatusUpdateMock(...args),
  organizationIdDeMensaje: (...args: unknown[]) => organizationIdDeMensajeMock(...args),
  isUpgrade: vi.fn(),
}));
vi.mock("@/server/inbox/ingest", () => ({
  ingestInboundMessage: vi.fn(),
  ingestHistoryMessage: vi.fn(),
  ingestOutboundEcho: vi.fn(),
}));
vi.mock("@/server/inbox/ycloud-routing", () => ({
  resolveInboundRoute: vi.fn(),
  resolveRoute: vi.fn(),
}));
vi.mock("@/server/ai/notify-team", () => ({ notifyTeam: vi.fn() }));
vi.mock("@/server/whatsapp/credentials", () => ({ captureMetaWabaId: vi.fn() }));

describe("parseYcloudMessageStatus (puro, sin DB)", () => {
  it("A: sent — parsea id/status/timestamp, sin errores", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    const resultado = parseYcloudMessageStatus({
      type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "wamid.abc", status: "sent", sendTime: "2026-09-03T12:00:00.000Z" },
    });
    expect(resultado).toMatchObject({ id: "wamid.abc", status: "sent" });
    expect(resultado?.errors).toBeUndefined();
  });

  it("B: delivered — parsea correctamente", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    const resultado = parseYcloudMessageStatus({
      whatsappMessage: { wamid: "wamid.abc", status: "delivered" },
    });
    expect(resultado?.status).toBe("delivered");
  });

  it("C: read — parsea correctamente", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    const resultado = parseYcloudMessageStatus({
      whatsappMessage: { wamid: "wamid.abc", status: "read" },
    });
    expect(resultado?.status).toBe("read");
  });

  it("D: failed — arma el objeto de error desde whatsappApiError.message", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    const resultado = parseYcloudMessageStatus({
      whatsappMessage: {
        wamid: "wamid.abc",
        status: "failed",
        errorCode: "131047",
        whatsappApiError: { message: "Message failed to send because more than 24 hours have passed", type: "OAuthException", code: "131047" },
      },
    });
    expect(resultado?.status).toBe("failed");
    expect(resultado?.errors?.[0]?.message).toMatch(/24 hours/);
    expect(resultado?.errors?.[0]?.code).toBe(131047);
  });

  it("D.2: failed sin whatsappApiError, con errorMessage como respaldo", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    const resultado = parseYcloudMessageStatus({
      whatsappMessage: { wamid: "wamid.abc", status: "failed", errorMessage: "Parameter Invalid" },
    });
    expect(resultado?.errors?.[0]?.message).toBe("Parameter Invalid");
  });

  it("E: sin wamid → null (dato mínimo faltante)", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    expect(parseYcloudMessageStatus({ whatsappMessage: { status: "sent" } })).toBeNull();
  });

  it("F: sin status → null", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    expect(parseYcloudMessageStatus({ whatsappMessage: { wamid: "wamid.abc" } })).toBeNull();
  });

  it("G: evento sin whatsappMessage en absoluto → null", async () => {
    const { parseYcloudMessageStatus } = await import("@/server/inbox/ycloud-webhook");
    expect(parseYcloudMessageStatus({ type: "whatsapp.inbound_message.received" })).toBeNull();
  });
});

describe("handleYcloudEvent: whatsapp.message.updated (resolución + aislamiento)", () => {
  beforeEach(() => {
    applyStatusUpdateMock.mockReset();
    organizationIdDeMensajeMock.mockReset();
  });

  it("H: status de un mensaje conocido — resuelve organización y aplica el update", async () => {
    organizationIdDeMensajeMock.mockResolvedValueOnce("org_1");
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");

    const resultado = await handleYcloudEvent({
      type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "wamid.abc", status: "delivered" },
    });
    expect(resultado).toEqual({ organizationId: "org_1" });
    expect(applyStatusUpdateMock).toHaveBeenCalledWith("org_1", expect.objectContaining({ id: "wamid.abc", status: "delivered" }));
  });

  it("I: status de un mensaje NO reconocido (nunca insertado por Korex) — no aplica nada, no falla", async () => {
    organizationIdDeMensajeMock.mockResolvedValueOnce(null);
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");

    const resultado = await handleYcloudEvent({
      type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "wamid.desconocido", status: "sent" },
    });
    expect(resultado).toEqual({ organizationId: null });
    expect(applyStatusUpdateMock).not.toHaveBeenCalled();
  });

  it("J: aislamiento — el mensaje pertenece a OTRA organización que la del webhook propio del cliente → se descarta", async () => {
    organizationIdDeMensajeMock.mockResolvedValueOnce("org_ajena");
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");

    const resultado = await handleYcloudEvent(
      { type: "whatsapp.message.updated", whatsappMessage: { wamid: "wamid.abc", status: "read" } },
      { expectOrganizationId: "org_1" }
    );
    expect(resultado).toEqual({ organizationId: "org_ajena" });
    expect(applyStatusUpdateMock).not.toHaveBeenCalled();
  });

  it("K: evento desconocido (ni status ni los tres tipos ya soportados) — se ignora, sin error", async () => {
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");
    const resultado = await handleYcloudEvent({ type: "whatsapp.qr_code.updated" });
    expect(resultado).toEqual({ organizationId: null });
    expect(applyStatusUpdateMock).not.toHaveBeenCalled();
  });

  it("L: evento sin wamid/status (malformado) — se descarta, cero llamadas a applyStatusUpdate", async () => {
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");
    const resultado = await handleYcloudEvent({ type: "whatsapp.message.updated", whatsappMessage: {} });
    expect(resultado).toEqual({ organizationId: null });
    expect(organizationIdDeMensajeMock).not.toHaveBeenCalled();
  });
});
