import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10W — bug real encontrado por auditoría (no reportado aún por un
 * cliente): un evento de YCloud sin `from`/`fromUserId` (mensaje "perdido",
 * ver ycloud-events.ts) dispara `alertarMensajePerdido` → `notifyTeam` — un
 * WhatsApp real al equipo. Ni el endpoint del webhook ni `notifyTeam` tienen
 * deduplicación propia: un reintento del POST completo (YCloud reintenta si
 * no recibió 2xx a tiempo, y `reprocesarWebhosFallidos` también reprocesa
 * eventos `fallido`) volvía a llamar esto para el MISMO evento y el equipo
 * recibía la misma alerta duplicada. Este test reproduce el reintento exacto
 * y confirma que ahora se deduplica por `id` del mensaje, sin suprimir
 * alertas de mensajes DISTINTOS.
 */

const resolveRouteMock = vi.fn();
vi.mock("@/server/inbox/ycloud-routing", () => ({
  resolveInboundRoute: vi.fn(),
  resolveRoute: (...a: unknown[]) => resolveRouteMock(...a),
}));

const notifyTeamMock = vi.fn();
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeamMock(...a),
}));

vi.mock("@/server/inbox/status", () => ({
  applyStatusUpdate: vi.fn(),
  organizationIdDeMensaje: vi.fn(),
  isUpgrade: vi.fn(),
}));
vi.mock("@/server/inbox/ingest", () => ({
  ingestInboundMessage: vi.fn(),
  ingestHistoryMessage: vi.fn(),
  ingestOutboundEcho: vi.fn(),
}));
vi.mock("@/server/whatsapp/credentials", () => ({ captureMetaWabaId: vi.fn() }));

function eventoPerdido(id: string) {
  return {
    type: "whatsapp.inbound_message.received",
    whatsappInboundMessage: {
      id,
      wabaId: "waba_1",
      to: "+573000000000",
      // Sin `from` NI `fromUserId`: exactamente el caso real que descarta
      // parseYcloudInbound() y dispara la alerta.
    },
  } as unknown as import("@/server/inbox/ycloud-webhook").YcloudEvent;
}

describe("alertarMensajePerdido: dedup real ante reintento del webhook (Fase 10W)", () => {
  beforeEach(() => {
    resolveRouteMock.mockReset().mockResolvedValue({ organizationId: "org_1" });
    notifyTeamMock.mockReset().mockResolvedValue({ sent: 1, failed: 0, detail: "ok" });
  });

  it("BUG REAL corregido: el MISMO evento perdido, reintentado 3 veces, notifica al equipo UNA sola vez", async () => {
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");
    const evento = eventoPerdido("wamid.perdido_1");

    await handleYcloudEvent(evento);
    await handleYcloudEvent(evento); // reintento del POST completo
    await handleYcloudEvent(evento); // reprocesarWebhosFallidos

    expect(notifyTeamMock).toHaveBeenCalledTimes(1);
  });

  it("un evento perdido DISTINTO (id distinto) SÍ dispara su propia alerta: el dedup no lo suprime todo", async () => {
    const { handleYcloudEvent } = await import("@/server/inbox/ycloud-events");

    await handleYcloudEvent(eventoPerdido("wamid.perdido_2"));
    await handleYcloudEvent(eventoPerdido("wamid.perdido_3"));

    expect(notifyTeamMock).toHaveBeenCalledTimes(2);
  });
});
