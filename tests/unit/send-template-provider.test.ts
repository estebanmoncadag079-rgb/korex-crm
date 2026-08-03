import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * sendTemplate SIEMPRE usaba Graph directo, aunque el cliente estuviera en
 * YCloud (el caso real de La Churra y Lis): fuera de la ventana de 24 h,
 * mandar una plantilla desde la bandeja fallaba. Debe elegir proveedor igual
 * que sendText.
 */

const graphRequest = vi.fn();
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const ycloudSendTemplate = vi.fn();
const isYcloudEnabled = vi.fn();
vi.mock("@/lib/ycloud/client", () => ({
  isYcloudEnabled: (...args: unknown[]) => isYcloudEnabled(...args),
  ycloudSendTemplate: (...args: unknown[]) => ycloudSendTemplate(...args),
}));

const getCredentialsByOrg = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrg(...args),
  getCredentialsByWabaId: vi.fn(),
  markReconnectRequired: vi.fn(),
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
          Promise.resolve([{ ...values, id: values.id ?? "msg_1", createdAt: new Date() }]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

const template = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "seguimiento",
  language: "es",
  body: "Hola {{1}}",
  status: "approved",
};
const conversationRow = {
  conversation: { id: "cv_1", organizationId: "org_1", isTest: false },
  contact: { id: "ct_1", phone: "573001112233", waUserId: null },
};

describe("sendTemplate elige proveedor igual que sendText", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    ycloudSendTemplate.mockReset();
    isYcloudEnabled.mockReset();
    getCredentialsByOrg.mockReset();
    selectQueue.length = 0;
  });

  it("con cuenta propia de YCloud, usa ycloudSendTemplate y NO llama a Graph", async () => {
    selectQueue.push([template], [conversationRow]);
    ycloudSendTemplate.mockResolvedValue("wamid.ycloud.1");
    getCredentialsByOrg.mockResolvedValue({
      organizationId: "org_1",
      phoneNumberId: "ycloud:573155136091",
      token: "clientkey",
      displayPhoneNumber: "573155136091",
      status: "connected",
    });

    const { sendTemplate } = await import("@/server/whatsapp/templates");
    await sendTemplate({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
    });

    expect(ycloudSendTemplate).toHaveBeenCalledTimes(1);
    expect(ycloudSendTemplate.mock.calls[0]![0]).toMatchObject({
      to: { kind: "phone", value: "573001112233" },
      name: "seguimiento",
      language: "es",
      bodyParams: ["María"],
    });
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("con la cuenta de YCloud de la agencia (sin key propia), también usa YCloud", async () => {
    selectQueue.push([template], [conversationRow]);
    isYcloudEnabled.mockReturnValue(true);
    ycloudSendTemplate.mockResolvedValue("wamid.ycloud.2");
    getCredentialsByOrg.mockResolvedValue({
      organizationId: "org_1",
      phoneNumberId: "ycloud:573155136091",
      token: "",
      displayPhoneNumber: "573155136091",
      status: "connected",
    });

    const { sendTemplate } = await import("@/server/whatsapp/templates");
    await sendTemplate({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
    });

    expect(ycloudSendTemplate).toHaveBeenCalledTimes(1);
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("sin YCloud (Meta directo), sigue usando Graph", async () => {
    selectQueue.push([template], [conversationRow]);
    isYcloudEnabled.mockReturnValue(false);
    getCredentialsByOrg.mockResolvedValue({
      organizationId: "org_1",
      phoneNumberId: "123456",
      token: "graph-token",
      displayPhoneNumber: "573155136091",
      status: "connected",
    });
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.graph.1" }] });

    const { sendTemplate } = await import("@/server/whatsapp/templates");
    await sendTemplate({
      organizationId: "org_1",
      conversationId: "cv_1",
      templateId: "tpl_1",
      variable: "María",
    });

    expect(graphRequest).toHaveBeenCalledTimes(1);
    expect(ycloudSendTemplate).not.toHaveBeenCalled();
  });
});
