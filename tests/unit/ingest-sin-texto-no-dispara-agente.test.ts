import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un mensaje sin texto ni adjunto (edición de WhatsApp, reacción/respuesta a
 * un Estado, tipo no soportado) se guarda con su marcador para no
 * desaparecer del hilo (ver mensaje-no-compatible.test.ts), pero NO debe
 * disparar un turno del agente: pasárselo como si el cliente lo hubiera
 * escrito lo confunde. Caso real: el modelo ejecutó `handoff` sin sentido al
 * ver "[mensaje no compatible: tipo edit...]" en Lis Pastelería
 * (3-ago-2026), y como Lis no tiene número de aviso configurado (a
 * propósito), la clienta quedó esperando sin que nadie se enterara.
 */

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/inbox/lead-activity", () => ({
  avanzarLeadSilencioso: vi.fn().mockResolvedValue(undefined),
  onLeadActivity: vi.fn().mockResolvedValue(undefined),
  cerrarLeadPorComprobante: vi.fn().mockResolvedValue(false),
  esComprobanteDePago: vi.fn(() => false),
}));
vi.mock("@/server/inbox/handoff-policy", () => ({
  clearHandoff: vi.fn().mockResolvedValue(undefined),
  isReturnToAgentPhrase: vi.fn(() => false),
  markHumanTookOver: vi.fn().mockResolvedValue(undefined),
  resumeReason: vi.fn(() => null),
}));
vi.mock("@/server/ai/transcribir", () => ({
  describirImagen: vi.fn(),
  transcribirAudio: vi.fn(),
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: vi.fn(),
  getYcloudApiKey: vi.fn(),
}));
vi.mock("@/server/inbox/status", () => ({ applyStatusUpdate: vi.fn() }));

// Cada insert "gana" el conflicto (devuelve fila): así getOrCreateContact y
// getOrCreateConversation nunca caen al camino de select, y basta con
// devolver los propios `values` insertados.
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ id: "generated_1", ...values }]),
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        // `limit` para la conversación, `orderBy` para la identidad del
        // contacto (que busca por teléfono Y BSUID, del más antiguo al nuevo).
        where: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => Promise.resolve([]),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  }),
  schema: {
    contact: { organizationId: "contact.organizationId", phone: "contact.phone", waUserId: "contact.waUserId" },
    conversation: {
      organizationId: "conversation.organizationId",
      contactId: "conversation.contactId",
      isTest: "conversation.isTest",
    },
    message: { waMessageId: "message.waMessageId" },
  },
}));

describe("ingestInboundMessage: mensajes sin texto ni adjunto no disparan al agente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tipo edit sin texto: NO llama a maybeRunAgentTurn", async () => {
    const { ingestInboundMessage } = await import("@/server/inbox/ingest");
    const { maybeRunAgentTurn } = await import("@/server/ai/trigger");

    await ingestInboundMessage({
      organizationId: "org_1",
      from: "573000000000",
      profileName: "Cliente",
      waMessageId: "wamid_edit_1",
      type: "edit",
      text: null,
      timestamp: "1712345678",
    });

    expect(maybeRunAgentTurn).not.toHaveBeenCalled();
  });

  it("mensaje de texto real: SÍ llama a maybeRunAgentTurn", async () => {
    const { ingestInboundMessage } = await import("@/server/inbox/ingest");
    const { maybeRunAgentTurn } = await import("@/server/ai/trigger");

    await ingestInboundMessage({
      organizationId: "org_1",
      from: "573000000000",
      profileName: "Cliente",
      waMessageId: "wamid_text_1",
      type: "text",
      text: "hola",
      timestamp: "1712345678",
    });

    expect(maybeRunAgentTurn).toHaveBeenCalledTimes(1);
  });
});
