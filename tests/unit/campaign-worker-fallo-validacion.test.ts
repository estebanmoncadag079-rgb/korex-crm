import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10J (autoauditoría) — hallazgo HIGH real: un `TemplateError("invalid",
 * ...)` lanzado ANTES de llamar al proveedor (ej. "La plantilla requiere el
 * valor de {{1}}" para un contacto sin nombre) caía en el catch genérico de
 * `resolverTrabajoTomado`, que revierte a `pending` SIN pasar por
 * `registrarFalloEnvioDeCampana` (la única función que aplica
 * `MAX_INTENTOS_CAMPANA`) — el mismo recipient se reclamaba, fallaba y se
 * revertía en cada ciclo de sondeo PARA SIEMPRE, acaparando el único cupo de
 * concurrencia de la organización (`CONCURRENCIA_CAMPANA_POR_ORG = 1`) sin
 * que la campaña completara ni marcara ese recipient como `failed`.
 *
 * Corregido: un `TemplateError("invalid", ...)` ahora se trata como un
 * fallo de VALIDACIÓN no reintentable — mismo criterio que ya usa
 * `registrarFalloEnvioDeCampana` para un `EXPLICIT_FAILURE` del proveedor
 * con `retryable: false` (Fase 6C).
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

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

const updateSpy = vi.fn();
const deleteSpy = vi.fn();
/** `revertirAPending` (worker.ts) es la ÚNICA función de este archivo que usa `db.transaction()` — contarla aparte permite distinguir "escritura normal de conversationId" (siempre ocurre) de "se revirtió a pending" (lo que el fix debe evitar para TemplateError('invalid', ...)). */
const transactionSpy = vi.fn();
const selectQueue: Fila[][] = [];

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

function txChain() {
  const chain: Record<string, unknown> = {};
  chain.update = () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) });
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: (...args: unknown[]) => {
      updateSpy(...args);
      return { set: (values: Record<string, unknown>) => ({ where: () => Promise.resolve([{ ...values }]) }) };
    },
    delete: (...args: unknown[]) => {
      deleteSpy(...args);
      return { where: () => Promise.resolve([]) };
    },
    transaction: async (cb: (tx: unknown) => unknown) => {
      transactionSpy();
      return cb(txChain());
    },
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const tomado = { jobId: "cmpj_1", recipientId: "cmpr_1", campaignId: "cmp_1", organizationId: "org_1", attempts: 1 };
const campanaProcessing = {
  id: "cmp_1",
  organizationId: "org_1",
  status: "processing",
  templateId: "tpl_1",
  templateSnapshot: { name: "promo", language: "es", category: "MARKETING", body: "Hola {{1}}" },
};
// Contacto SIN nombre real (el caso reportado): `contactName` vacío.
const recipienteSinNombre = { contactId: "ct_1", contactName: "" };

beforeEach(() => {
  selectQueue.length = 0;
  updateSpy.mockReset();
  deleteSpy.mockReset();
  transactionSpy.mockReset();
  reclamarTrabajoDeCampana.mockReset();
  registrarEnvioExitosoDeCampana.mockReset();
  registrarFalloEnvioDeCampana.mockReset();
  pausarCampana.mockReset();
  intentarCompletarCampana.mockReset();
  tieneOptOutDeMarketing.mockReset();
  getOrCreateConversation.mockReset();
  tieneOptOutDeMarketing.mockResolvedValue(false);
  getOrCreateConversation.mockResolvedValue({ id: "cv_1" });
  registrarFalloEnvioDeCampana.mockResolvedValue({ reintenta: false });
  intentarCompletarCampana.mockResolvedValue({ completada: false });
});

describe("resolverTrabajoTomado: TemplateError('invalid', ...) antes del proveedor — fallo NO reintentable, nunca revierte para siempre", () => {
  it("A: plantilla requiere {{1}} y el proveedor lo rechaza — se marca failed vía registrarFalloEnvioDeCampana con retryable=false, NUNCA revertirAPending", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteSinNombre]);
    const { TemplateError } = await import("@/server/whatsapp/templates");
    const proveedor = vi.fn().mockRejectedValue(new TemplateError("invalid", "La plantilla requiere el valor de {{1}}"));
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });

    expect(resultado).toEqual({ outcome: "fallido", retryable: false });
    expect(registrarFalloEnvioDeCampana).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "cmpr_1",
        errorProveedor: "La plantilla requiere el valor de {{1}}",
        retryable: false,
      })
    );
    // El job cerró para siempre: intenta completar la campaña (mismo
    // criterio que cualquier otro cierre definitivo).
    expect(intentarCompletarCampana).toHaveBeenCalledWith("org_1", "cmp_1");
  });

  it("B: NUNCA llama revertirAPending (que dejaría el recipient en pending para siempre) — el fix cierra el job vía registrarFalloEnvioDeCampana en su lugar", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteSinNombre]);
    const { TemplateError } = await import("@/server/whatsapp/templates");
    const proveedor = vi.fn().mockRejectedValue(new TemplateError("invalid", "La plantilla requiere el valor de {{1}}"));
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    await procesarUnEnvioDeCampana({ worker: "w1", proveedor });

    // `revertirAPending` es la ÚNICA función de worker.ts que usa
    // `db.transaction()` — si nunca se llamó, el recipient NO volvió a
    // `pending` sin resolución (el bug original).
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("C: otro TemplateError con code distinto de 'invalid' (ej. 'not_found') SIGUE cayendo en el camino genérico (revierte, error_inesperado) — el fix es acotado, no over-corrige", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteSinNombre]);
    const { TemplateError } = await import("@/server/whatsapp/templates");
    const proveedor = vi.fn().mockRejectedValue(new TemplateError("not_found", "Plantilla no encontrada"));
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });

    expect(resultado).toEqual({ outcome: "error_inesperado" });
    expect(registrarFalloEnvioDeCampana).not.toHaveBeenCalled();
  });

  it("D: un error de reconexión SIGUE pausando toda la campaña (el fix no interfiere con esa rama, que se revisa ANTES)", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteSinNombre]);
    const { TemplateError } = await import("@/server/whatsapp/templates");
    const proveedor = vi.fn().mockRejectedValue(new TemplateError("reconnect_required", "reconecta"));
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });

    expect(resultado).toEqual({ outcome: "reconexion_requerida" });
    expect(pausarCampana).toHaveBeenCalledWith("org_1", "cmp_1");
    expect(registrarFalloEnvioDeCampana).not.toHaveBeenCalled();
  });
});
