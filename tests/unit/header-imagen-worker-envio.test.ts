import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9P, sección 11 — `procesarUnEnvioDeCampana()` (worker.ts) propaga
 * `templateSnapshot.components` al proveedor de envío tal cual quedó
 * congelado. Mismo patrón de mock que `campaign-worker.test.ts` (Fase 6A),
 * en archivo aparte porque mockea `@/server/campaigns/motor` — lo que
 * chocaría con `header-imagen-motor-worker.test.ts`, que necesita la
 * versión REAL de ese módulo.
 */

type Fila = Record<string, unknown>;

const reclamarTrabajoDeCampana = vi.fn();
const registrarEnvioExitosoDeCampana = vi.fn();
const registrarFalloEnvioDeCampana = vi.fn();
vi.mock("@/server/campaigns/cola", () => ({
  reclamarTrabajoDeCampana: (...args: unknown[]) => reclamarTrabajoDeCampana(...args),
  registrarEnvioExitosoDeCampana: (...args: unknown[]) => registrarEnvioExitosoDeCampana(...args),
  registrarFalloEnvioDeCampana: (...args: unknown[]) => registrarFalloEnvioDeCampana(...args),
}));

const pausarCampana = vi.fn();
const intentarCompletarCampana = vi.fn();
vi.mock("@/server/campaigns/motor", () => ({
  pausarCampana: (...args: unknown[]) => pausarCampana(...args),
  intentarCompletarCampana: (...args: unknown[]) => intentarCompletarCampana(...args),
}));

const tieneOptOutDeMarketing = vi.fn();
vi.mock("@/server/contacts", () => ({
  tieneOptOutDeMarketing: (...args: unknown[]) => tieneOptOutDeMarketing(...args),
}));

const getOrCreateConversation = vi.fn();
vi.mock("@/server/inbox/ingest", () => ({
  getOrCreateConversation: (...args: unknown[]) => getOrCreateConversation(...args),
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

const selectQueue: Fila[][] = [];
function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        update: () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) }),
        delete: () => ({ where: () => Promise.resolve([]) }),
      }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const tomado = { jobId: "cmpj_1", recipientId: "cmpr_1", campaignId: "cmp_1", organizationId: "org_1", attempts: 1 };
const componentsConImagen = { header: { type: "IMAGE", mediaAssetId: "asset_1" }, footer: null };
const campanaConHeaderImagen = {
  id: "cmp_1",
  organizationId: "org_1",
  status: "processing",
  templateId: "tpl_1",
  templateSnapshot: {
    name: "promo_imagen",
    language: "es",
    category: "MARKETING",
    body: "Aprovecha {{1}}",
    components: componentsConImagen,
  },
};
const recipienteConContacto = { contactId: "ct_1", contactName: "María" };

beforeEach(() => {
  selectQueue.length = 0;
  reclamarTrabajoDeCampana.mockReset();
  registrarEnvioExitosoDeCampana.mockReset();
  registrarFalloEnvioDeCampana.mockReset();
  pausarCampana.mockReset();
  intentarCompletarCampana.mockReset();
  tieneOptOutDeMarketing.mockReset();
  getOrCreateConversation.mockReset();
  checkRateLimit.mockReset();
  tieneOptOutDeMarketing.mockResolvedValue(false);
  getOrCreateConversation.mockResolvedValue({ id: "cv_1" });
  intentarCompletarCampana.mockResolvedValue({ completada: false });
});

describe("procesarUnEnvioDeCampana: propaga templateSnapshot.components al proveedor (worker.ts)", () => {
  it("el proveedor recibe contentSnapshot.components EXACTAMENTE como quedó congelado (header IMAGE incluido)", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaConHeaderImagen]);
    selectQueue.push([recipienteConContacto]);
    registrarEnvioExitosoDeCampana.mockResolvedValue({ messageId: "msg_1" });
    const proveedor = vi.fn().mockResolvedValue({ kind: "SUCCESS", waMessageId: "wamid.1", renderedText: "Aprovecha María" });
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "enviado", messageId: "msg_1" });
    expect(proveedor).toHaveBeenCalledWith(
      expect.objectContaining({
        contentSnapshot: expect.objectContaining({ components: componentsConImagen }),
      })
    );
  });
});
