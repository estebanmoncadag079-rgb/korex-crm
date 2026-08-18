import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `send_image`: el modelo sigue pidiendo lo mismo (una etiqueta), pero desde
 * el 18-ago-2026 lo que hay detrás puede ser una foto o un catálogo en PDF
 * (docs/korexia/97-BITACORA-RESERVA-MULTIPLE.md §15) — lo decide
 * `foto.mimeType`, nunca el modelo. Esto prueba que el turno completo elige
 * bien según ese mimeType, sin tocar `send.ts` real (mismo patrón que
 * pipeline-appointments-dispatch.test.ts, con @/server/ai/fotos mockeado
 * entero).
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const fotoPorEtiqueta = vi.fn();
vi.mock("@/server/ai/fotos", () => ({
  fotoPorEtiqueta: (...a: unknown[]) => fotoPorEtiqueta(...a),
  fotosDeLaOrganizacion: () => Promise.resolve([]),
  urlPublicaDeFoto: (id: string) => `https://ejemplo.test/api/media/${id}`,
}));

const selectQueue: unknown[][] = [];
const inserted: { table: unknown; values: Record<string, unknown> }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

/**
 * `isTest: true` a propósito: así `deliverImage`/`deliverDocument` caen a
 * `persistTestOutbound` en vez de tocar `send.ts` real (que sí tiene la
 * aserción dura FR-031) — se puede leer qué se habría mandado directo del
 * `insert` a `message`, sin mockear un tercer módulo más.
 */
const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};
const PROFILE = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  appointmentsEnabled: false,
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  hoursOpen: "08:00",
  hoursClose: "18:00",
  hoursDays: "1,2,3,4,5,6",
};
const HISTORY = [{ id: "msg_1", direction: "in", text: "hola", createdAt: new Date() }];

function queueTurnoBase() {
  selectQueue.push([CONVERSATION], [PROFILE], HISTORY, [], [], []);
}

function textoDelMensajeSaliente(): string | undefined {
  const m = inserted.find((i) => (i.values as { direction?: string }).direction === "out");
  return (m?.values as { text?: string } | undefined)?.text;
}

describe("send_image: foto o documento, según el mimeType real del archivo", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    chatJson.mockReset();
    fotoPorEtiqueta.mockReset();
    selectQueue.length = 0;
    inserted.length = 0;
  });

  it("una etiqueta con mimeType image/* se entrega como foto", async () => {
    queueTurnoBase();
    fotoPorEtiqueta.mockResolvedValue({
      id: "med_foto",
      etiqueta: "Volumen Ruso",
      mimeType: "image/jpeg",
    });
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "send_image", etiqueta: "Volumen Ruso" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("send_image");
    expect(textoDelMensajeSaliente()).toMatch(/^\[foto: /);
  });

  it("una etiqueta con mimeType application/pdf se entrega como documento", async () => {
    queueTurnoBase();
    fotoPorEtiqueta.mockResolvedValue({
      id: "med_catalogo",
      etiqueta: "Catálogo de diseños",
      mimeType: "application/pdf",
    });
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "send_image", etiqueta: "Catálogo de diseños" },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const action = await runAgentTurn("cv_1");

    expect(action?.action).toBe("send_image");
    expect(textoDelMensajeSaliente()).toMatch(/^\[documento: /);
  });

  it("una etiqueta que no existe se degrada a texto, sin importar el tipo", async () => {
    queueTurnoBase();
    fotoPorEtiqueta.mockResolvedValue(null);
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        action: "send_image",
        etiqueta: "no existe",
        reply: "No encontré eso, ¿te ayudo con algo más?",
      },
      raw: "{}",
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(textoDelMensajeSaliente()).toBe("No encontré eso, ¿te ayudo con algo más?");
  });
});
