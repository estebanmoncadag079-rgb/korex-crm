import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de `ingestOutboundEcho` con el filtro de eco propio (ver
 * `eco-de-mensaje-propio.test.ts` para la lógica de decisión aislada). Aquí se
 * prueba el EFECTO observable: cuando hay un mensaje propio reciente que
 * coincide, el eco NUNCA llega a insertarse ni a ceder el turno a un humano.
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
  reactivarLeadSilencioso: vi.fn().mockResolvedValue(false),
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

let recientesParaEco: { id: string; text: string | null }[] = [];
let mensajesInsertados: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            // El insert del MENSAJE final (tiene `direction`) es el único
            // que nos importa rastrear; contact/conversation "ganan" el
            // conflicto siempre, igual que el resto de los tests de ingest.
            if (values.direction) mensajesInsertados.push(values);
            return Promise.resolve([{ id: "generated_1", ...values }]);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => ({
            limit: () => Promise.resolve(recientesParaEco),
          }),
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
      id: "conversation.id",
    },
    message: {
      id: "message.id",
      text: "message.text",
      conversationId: "message.conversationId",
      direction: "message.direction",
      aiGenerated: "message.aiGenerated",
      createdAt: "message.createdAt",
      waMessageId: "message.waMessageId",
    },
  },
}));

describe("ingestOutboundEcho: descarta el eco de un mensaje propio reciente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recientesParaEco = [];
    mensajesInsertados = [];
  });

  it("con un mensaje propio reciente de mismo texto: NO inserta el eco ni cede el turno", async () => {
    recientesParaEco = [{ id: "msg_saludo_real", text: "Bienvenida  a Lashes Valen Studio." }];
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");
    const { markHumanTookOver } = await import("@/server/inbox/handoff-policy");

    await ingestOutboundEcho({
      organizationId: "org_1",
      toPhone: "573000000000",
      waMessageId: "wamid_eco_1",
      type: "text",
      text: "Bienvenida  a Lashes Valen Studio.",
      timestamp: "1712345678",
    });

    expect(mensajesInsertados).toHaveLength(0);
    expect(markHumanTookOver).not.toHaveBeenCalled();
  });

  it("sin ningún mensaje propio reciente: inserta el eco y cede el turno (comportamiento normal, sin cambios)", async () => {
    recientesParaEco = [];
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");
    const { markHumanTookOver } = await import("@/server/inbox/handoff-policy");

    await ingestOutboundEcho({
      organizationId: "org_1",
      toPhone: "573000000000",
      waMessageId: "wamid_eco_2",
      type: "text",
      text: "Ya te separo el cupo, hermosa",
      timestamp: "1712345678",
    });

    expect(mensajesInsertados).toHaveLength(1);
    expect(markHumanTookOver).toHaveBeenCalledTimes(1);
  });
});
