import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un contacto con nombre de usuario de WhatsApp (sin teléfono, solo
 * `waUserId`) se responde con YCloud usando el campo `recipient`, NUNCA con
 * el campo `to` (que YCloud valida como E.164 y rechaza con "Invalid E.164
 * phone number"). Bug real confirmado en vivo el 3-ago-2026 en Lis
 * Pastelería: ni el agente ni un humano respondiendo a mano podían
 * contestarle a Nathalia, un cliente con nombre de usuario activado —
 * `sendText` mandaba el `waUserId` por `to` y YCloud lo rechazaba siempre.
 */

const ycloudSendText = vi.fn();
vi.mock("@/lib/ycloud/client", () => ({
  isYcloudEnabled: () => true,
  ycloudSendText: (...a: unknown[]) => ycloudSendText(...a),
  ycloudSendTemplate: vi.fn(),
}));

const graphRequest = vi.fn();
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const getCredentialsByOrg = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...a: unknown[]) => getCredentialsByOrg(...a),
}));

vi.mock("@/server/usage", () => ({
  registrarUsoWhatsapp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/inbox/lead-activity", () => ({
  avanzarLeadSilencioso: vi.fn().mockResolvedValue(undefined),
}));

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectQueue: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () =>
          Promise.resolve([{ id: "msg_1", createdAt: new Date(), ...values }]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  }),
  schema: {
    conversation: { id: "conversation.id" },
    contact: {},
    message: {},
  },
}));

describe("sendText: contacto identificado solo por nombre de usuario de WhatsApp", () => {
  beforeEach(() => {
    ycloudSendText.mockReset().mockResolvedValue("wamid.1");
    graphRequest.mockReset();
    getCredentialsByOrg.mockReset().mockResolvedValue({
      organizationId: "org_1",
      phoneNumberId: "ycloud:573158339990",
      token: "",
      displayPhoneNumber: "573158339990",
      status: "connected",
    });
    selectQueue.length = 0;
  });

  it("manda por 'recipient' (BSUID), nunca por 'to'", async () => {
    selectQueue.push([
      {
        conversation: {
          id: "cv_1",
          organizationId: "org_1",
          isTest: false,
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_1", phone: null, waUserId: "CO.38528566123409360" },
      },
    ]);

    const { sendText } = await import("@/server/inbox/send");
    await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "¡Hola! ¿En qué te ayudo?",
      aiGenerated: true,
    });

    expect(ycloudSendText).toHaveBeenCalledTimes(1);
    expect(ycloudSendText.mock.calls[0]![0]).toMatchObject({
      to: { kind: "waUserId", value: "CO.38528566123409360" },
    });
  });

  it("con teléfono normal, sigue mandando por 'to' como siempre", async () => {
    selectQueue.push([
      {
        conversation: {
          id: "cv_2",
          organizationId: "org_1",
          isTest: false,
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_2", phone: "573001112233", waUserId: null },
      },
    ]);

    const { sendText } = await import("@/server/inbox/send");
    await sendText({
      conversationId: "cv_2",
      organizationId: "org_1",
      text: "hola",
    });

    expect(ycloudSendText.mock.calls[0]![0]).toMatchObject({
      to: { kind: "phone", value: "573001112233" },
    });
  });
});
