import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Devolver el turno al agente tiene que CONTINUAR la conversación, no dejarlo
 * despierto y mudo.
 *
 * Caso real (Lis Pastelería, 6-ago-2026): la clienta escribió "Cremoso de 7
 * Oz" a las 18:16:43, Lis devolvió el turno con "Te dejo con el encargado" a
 * las 18:18:30 y **el agente no dijo nada durante 5 minutos**, hasta que la
 * clienta escribió "Gracias" a las 18:21:22 — solo entonces soltó la
 * respuesta que ya tenía lista. El día anterior, con otra clienta, Lis tuvo
 * que escribir la respuesta a mano y repetir el comando.
 *
 * Y lo que manda el negocio por audio o foto se convierte a texto igual que
 * lo del cliente: si no, el agente retoma sin saber qué resolvió la persona.
 */

const maybeRunAgentTurn = vi.fn();
vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: (...a: unknown[]) => maybeRunAgentTurn(...a),
}));

const clearHandoff = vi.fn();
const markHumanTookOver = vi.fn();
vi.mock("@/server/inbox/handoff-policy", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clearHandoff: (...a: unknown[]) => clearHandoff(...a),
  markHumanTookOver: (...a: unknown[]) => markHumanTookOver(...a),
}));

const transcribirAudio = vi.fn();
const describirImagen = vi.fn();
vi.mock("@/server/ai/transcribir", () => ({
  transcribirAudio: (...a: unknown[]) => transcribirAudio(...a),
  describirImagen: (...a: unknown[]) => describirImagen(...a),
}));

vi.mock("@/server/inbox/lead-activity", () => ({
  avanzarLeadSilencioso: () => Promise.resolve(false),
  onLeadActivity: () => Promise.resolve(),
}));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));
vi.mock("@/server/inbox/credentials", () => ({
  getYcloudApiKey: () => Promise.resolve("key"),
}));

const insertadas: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertadas.push(v);
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([{ id: "msg_1", ...v }]),
        };
        return chain;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tabla) =>
        new Proxy({}, { get: (_t2, col) => `${String(tabla)}.${String(col)}` }),
    }
  ),
}));

/** La fila del mensaje: antes se insertan el contacto y la conversación. */
function mensajeInsertado() {
  return insertadas.find((v) => v.direction === "out");
}

const ECO_BASE = {
  organizationId: "org_lis",
  toPhone: "573001112233",
  waMessageId: "wamid.eco",
  timestamp: String(Math.floor(Date.now() / 1000)),
};

describe("el negocio devuelve el turno al agente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertadas.length = 0;
  });

  it("con el comando, el agente RETOMA sin esperar al cliente", async () => {
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");

    await ingestOutboundEcho({
      ...ECO_BASE,
      type: "text",
      text: "Te dejo con el encargado",
    });

    expect(clearHandoff).toHaveBeenCalled();
    expect(markHumanTookOver).not.toHaveBeenCalled();
    // Lo que faltaba: continuar la conversación en el acto.
    expect(maybeRunAgentTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ immediate: true })
    );
  });

  it("un mensaje normal del negocio sigue callando al agente", async () => {
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");

    await ingestOutboundEcho({
      ...ECO_BASE,
      type: "text",
      text: "Ya te lo despacho, dame 10 minutos",
    });

    expect(markHumanTookOver).toHaveBeenCalled();
    expect(clearHandoff).not.toHaveBeenCalled();
    expect(maybeRunAgentTurn).not.toHaveBeenCalled();
  });

  it("la nota de voz del negocio se transcribe y queda como texto", async () => {
    transcribirAudio.mockResolvedValue({ texto: "El domicilio son 8.000" });
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");

    await ingestOutboundEcho({
      ...ECO_BASE,
      type: "audio",
      text: null,
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/download/abc",
      mimeType: "audio/ogg",
    });

    expect(transcribirAudio).toHaveBeenCalled();
    expect(mensajeInsertado()?.text).toBe("El domicilio son 8.000");
  });

  /**
   * La foto del negocio se lee con una instrucción propia: el negocio no se
   * paga a sí mismo, así que buscar un comprobante ahí solo invita a
   * etiquetar mal.
   */
  it("la foto del negocio se describe con la instrucción de negocio", async () => {
    describirImagen.mockResolvedValue({ texto: "[TEXTO] Cremoso 7 oz $12.000" });
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");

    await ingestOutboundEcho({
      ...ECO_BASE,
      type: "image",
      text: null,
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/download/xyz",
      mimeType: "image/jpeg",
    });

    expect(describirImagen).toHaveBeenCalledWith(
      expect.objectContaining({ deQuien: "negocio" })
    );
    expect(mensajeInsertado()?.text).toBe("[TEXTO] Cremoso 7 oz $12.000");
  });

  /**
   * El comando dicho por voz también cuenta: hasta ahora la frase se buscaba
   * en el texto crudo, que en un audio llega vacío.
   */
  it("el comando dicho en una nota de voz también devuelve el turno", async () => {
    transcribirAudio.mockResolvedValue({ texto: "Te dejo con el encargado" });
    const { ingestOutboundEcho } = await import("@/server/inbox/ingest");

    await ingestOutboundEcho({
      ...ECO_BASE,
      type: "audio",
      text: null,
      mediaUrl: "https://api.ycloud.com/v2/whatsapp/media/download/abc",
      mimeType: "audio/ogg",
    });

    expect(clearHandoff).toHaveBeenCalled();
    expect(maybeRunAgentTurn).toHaveBeenCalled();
  });
});
