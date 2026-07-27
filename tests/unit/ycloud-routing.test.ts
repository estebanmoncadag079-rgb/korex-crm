import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-tenant (Constitución III): el webhook de YCloud es POR CUENTA, así que
 * la organización sale del número del negocio. Un mensaje jamás puede caer en
 * la bandeja de un cliente que no es dueño del número.
 */

type Cred = { organizationId: string } | null;

const state = {
  byPhone: {} as Record<string, string>,
  byWaba: {} as Record<string, string>,
  observeWaba: undefined as string | undefined,
  observeOrg: undefined as string | undefined,
};

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    YCLOUD_OBSERVE_WABA: state.observeWaba,
    YCLOUD_OBSERVE_ORG: state.observeOrg,
  }),
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByDisplayPhone: async (phone: string): Promise<Cred> => {
    const org = state.byPhone[phone.replace(/\D/g, "")];
    return org ? { organizationId: org } : null;
  },
  getCredentialsByWabaId: async (waba: string): Promise<Cred> => {
    const org = state.byWaba[waba];
    return org ? { organizationId: org } : null;
  },
}));

import { resolveInboundRoute } from "@/server/inbox/ycloud-routing";
import type { ParsedInbound } from "@/server/inbox/ycloud-webhook";

function inbound(over: Partial<ParsedInbound> = {}): ParsedInbound {
  return {
    id: "wamid.1",
    wabaId: "waba_a",
    from: "573046838172",
    to: "573155136091",
    name: "Cliente",
    type: "text",
    text: "hola",
    unixTs: "1700000000",
    ...over,
  };
}

beforeEach(() => {
  state.byPhone = {};
  state.byWaba = {};
  state.observeWaba = undefined;
  state.observeOrg = undefined;
});

describe("enrutamiento de mensajes entrantes por número", () => {
  it("enruta al cliente dueño del número destino", async () => {
    state.byPhone["573155136091"] = "org_churra";
    state.byPhone["573001112233"] = "org_otro";

    const route = await resolveInboundRoute(inbound());
    expect(route).toEqual({ organizationId: "org_churra", triggerAgent: true });
  });

  it("dos clientes distintos NO se mezclan: cada número a su organización", async () => {
    state.byPhone["573155136091"] = "org_churra";
    state.byPhone["573001112233"] = "org_otro";

    const a = await resolveInboundRoute(inbound());
    const b = await resolveInboundRoute(inbound({ to: "573001112233" }));
    expect(a?.organizationId).toBe("org_churra");
    expect(b?.organizationId).toBe("org_otro");
  });

  it("número desconocido → se descarta (nunca cae en una organización por defecto)", async () => {
    state.byPhone["573001112233"] = "org_otro";
    expect(await resolveInboundRoute(inbound())).toBeNull();
  });

  it("acepta el número destino con '+' y separadores", async () => {
    state.byPhone["573155136091"] = "org_churra";
    const route = await resolveInboundRoute(inbound({ to: "+57 315 513 6091" }));
    expect(route?.organizationId).toBe("org_churra");
  });

  it("sin número registrado, el WABA sirve de respaldo", async () => {
    state.byWaba["waba_a"] = "org_churra";
    const route = await resolveInboundRoute(inbound({ to: "" }));
    expect(route?.organizationId).toBe("org_churra");
  });

  it("modo observación: ingiere pero el agente NO responde", async () => {
    state.byPhone["573155136091"] = "org_churra";
    state.observeOrg = "org_churra";
    state.observeWaba = "waba_a";

    const route = await resolveInboundRoute(inbound());
    expect(route).toEqual({ organizationId: "org_churra", triggerAgent: false });
  });

  it("la observación por entorno solo afecta a su organización", async () => {
    state.byPhone["573155136091"] = "org_churra";
    state.byPhone["573001112233"] = "org_otro";
    state.observeOrg = "org_churra";

    const otro = await resolveInboundRoute(inbound({ to: "573001112233" }));
    expect(otro).toEqual({ organizationId: "org_otro", triggerAgent: true });
  });

  it("compatibilidad: WABA en observación sin número registrado", async () => {
    state.observeWaba = "waba_a";
    state.observeOrg = "org_churra";
    const route = await resolveInboundRoute(inbound({ to: "" }));
    expect(route).toEqual({ organizationId: "org_churra", triggerAgent: false });
  });
});
