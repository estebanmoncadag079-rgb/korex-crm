import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-031, el guardrail que se había escapado: el aviso de pedido al EQUIPO.
 *
 * El guard de sandbox vivía en `inbox/send`, que cubre el mensaje al CLIENTE.
 * `notify_order` avisa al equipo por otra ruta (YCloud/Graph directo) y no
 * miraba `is_test`: cada corrida del Laboratorio en la que el agente cerraba un
 * pedido le mandaba al negocio un pedido inventado, con dirección incluida.
 *
 * `lab-sandbox.test.ts` no lo detectaba porque solo ejercita la acción `reply`.
 */

const ycloudSendText = vi.fn();
const ycloudSendTemplate = vi.fn();
const callGraphSend = vi.fn();

vi.mock("@/lib/ycloud/client", () => ({
  isYcloudEnabled: () => true,
  ycloudSendText,
  ycloudSendTemplate,
}));

vi.mock("@/server/inbox/send", () => ({
  callGraphSend,
  ycloudApiKeyOf: () => "key-test",
}));

vi.mock("@/server/whatsapp/credentials", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/credentials")>();
  return {
    ...original,
    getCredentialsByOrg: async () => ({ displayPhoneNumber: "573000000000" }),
  };
});

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

// El perfil TIENE números de aviso configurados: sin esto la prueba pasaría
// por la razón equivocada (nadie a quien escribir, no el guard).
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () =>
      thenableChain([
        {
          notifyPhones: "573046838172",
          notifyTemplate: null,
          notifyTemplateLang: "es",
        },
      ]),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, table) =>
        new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }),
    }
  ),
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: () => true }));

describe("aviso de pedido en corridas del Laboratorio", () => {
  beforeEach(() => {
    ycloudSendText.mockReset();
    ycloudSendTemplate.mockReset();
    callGraphSend.mockReset();
  });

  it("con isTest NO escribe a nadie", async () => {
    const { notifyTeam } = await import("@/server/ai/notify-team");

    const result = await notifyTeam({
      organizationId: "org_1",
      summary: "1 pedido — Carrera 15 # 8-40, apartamento 302 — $20.000",
      customerPhone: "5210000000001",
      isTest: true,
    });

    expect(ycloudSendText).not.toHaveBeenCalled();
    expect(ycloudSendTemplate).not.toHaveBeenCalled();
    expect(callGraphSend).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.detail).toMatch(/laboratorio/i);
  });

  it("sin isTest sí avisa (el guard no rompió el camino real)", async () => {
    const { notifyTeam } = await import("@/server/ai/notify-team");

    const result = await notifyTeam({
      organizationId: "org_1",
      summary: "1 pedido — Carrera 15 # 8-40 — $20.000",
      customerPhone: "573001112233",
    });

    expect(ycloudSendText).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });
});
