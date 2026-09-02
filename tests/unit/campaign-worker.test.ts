import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6A: `procesarUnEnvioDeCampana` — el orquestador completo, con el
 * proveedor SIEMPRE inyectado (nunca YCloud/Meta real; ver `worker.ts`,
 * punto 10 de la Fase 6A: inyección de dependencia, sin bandera global).
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

const updateSpy = vi.fn();
const deleteSpy = vi.fn();
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
    update: (...args: unknown[]) => {
      updateSpy(...args);
      return {
        set: (values: Record<string, unknown>) => ({
          where: () => Promise.resolve([{ ...values }]),
        }),
      };
    },
    delete: (...args: unknown[]) => {
      deleteSpy(...args);
      return { where: () => Promise.resolve([]) };
    },
    transaction: async (cb: (tx: unknown) => unknown) => {
      const tx = {
        update: (...args: unknown[]) => {
          updateSpy(...args);
          return { set: () => ({ where: () => Promise.resolve([{}]) }) };
        },
        delete: (...args: unknown[]) => {
          deleteSpy(...args);
          return { where: () => Promise.resolve([]) };
        },
      };
      return cb(tx);
    },
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const tomado = {
  jobId: "cmpj_1",
  recipientId: "cmpr_1",
  campaignId: "cmp_1",
  organizationId: "org_1",
  attempts: 1,
};
const campanaProcessing = {
  id: "cmp_1",
  organizationId: "org_1",
  status: "processing",
  templateId: "tpl_1",
  templateSnapshot: { name: "seguimiento", language: "es", category: "MARKETING", body: "Hola {{1}}" },
};
const recipienteConContacto = { contactId: "ct_1", contactName: "María" };

function proveedorFijo(resultado: unknown) {
  return vi.fn().mockResolvedValue(resultado);
}

beforeEach(() => {
  selectQueue.length = 0;
  updateSpy.mockReset();
  deleteSpy.mockReset();
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
  // Default razonable: la mayoría de tests no le interesa la política de
  // reintento en sí, solo que `retryable` viaje — lo que sí les importa
  // (retryable=false, agotado, etc.) lo fija cada test explícitamente.
  registrarFalloEnvioDeCampana.mockResolvedValue({ reintenta: true });
  intentarCompletarCampana.mockResolvedValue({ completada: false });
});

describe("procesarUnEnvioDeCampana", () => {
  it("sin trabajo pendiente: sin_trabajo, nada más se toca", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(null);
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor: proveedorFijo(null) });
    expect(resultado).toEqual({ outcome: "sin_trabajo" });
  });

  it("campaña ya no está processing (pausada/cancelada): revierte a pending, no llama al proveedor", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([{ ...campanaProcessing, status: "paused" }]);
    const proveedor = proveedorFijo(null);
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "campana_no_activa" });
    expect(proveedor).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalled(); // revirtió recipient + job
  });

  // Fase 6C, hallazgo #1 de la Fase 6B: sin snapshot no hay fuente de
  // verdad de contenido — no debería ocurrir (prepararCampana siempre lo
  // congela), pero se comprueba igual, defensivo.
  it("campaña processing pero SIN templateSnapshot (defensivo): revierte, no llama al proveedor", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([{ ...campanaProcessing, templateSnapshot: null }]);
    const proveedor = proveedorFijo(null);
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "campana_no_activa" });
    expect(proveedor).not.toHaveBeenCalled();
  });

  it("opt-out revalidado: marca skipped, cierra el job, no llama al proveedor", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    tieneOptOutDeMarketing.mockResolvedValue(true);
    const proveedor = proveedorFijo(null);
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "omitido_opt_out" });
    expect(proveedor).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalled(); // cierra el job, igual que un envío exitoso
    // El job cerró para siempre (SKIPPED) — intenta completar la campaña.
    expect(intentarCompletarCampana).toHaveBeenCalledWith("org_1", "cmp_1");
  });

  it("rate limit bloqueado: NO llama al proveedor, revierte sin marcar failed", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const proveedor = proveedorFijo(null);
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor,
      rateLimit: { windowMs: 1000, max: 1 },
    });
    expect(resultado).toEqual({ outcome: "rate_limited" });
    expect(proveedor).not.toHaveBeenCalled();
    expect(registrarFalloEnvioDeCampana).not.toHaveBeenCalled();
    // No cerró ningún job — no tiene sentido intentar completar la campaña.
    expect(intentarCompletarCampana).not.toHaveBeenCalled();
  });

  it("SUCCESS del proveedor: registra el envío exitoso, usando el snapshot congelado como contenido", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    registrarEnvioExitosoDeCampana.mockResolvedValue({ messageId: "msg_1" });
    const proveedor = proveedorFijo({
      kind: "SUCCESS",
      waMessageId: "wamid.1",
      renderedText: "Hola María",
    });
    const { procesarUnEnvioDeCampana, TIMEOUT_ENVIO_CAMPANA_MS } = await import(
      "@/server/campaigns/worker"
    );

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "enviado", messageId: "msg_1" });
    expect(proveedor).toHaveBeenCalledWith(
      expect.objectContaining({
        retry: false,
        templateId: "tpl_1",
        variable: "María",
        timeoutMs: TIMEOUT_ENVIO_CAMPANA_MS, // ningún timeoutMs explícito: usa el default
        contentSnapshot: { name: "seguimiento", language: "es", body: "Hola {{1}}" },
      })
    );
    expect(registrarEnvioExitosoDeCampana).toHaveBeenCalledTimes(1);
    // El job cerró para siempre — intenta completar la campaña.
    expect(intentarCompletarCampana).toHaveBeenCalledWith("org_1", "cmp_1");
  });

  it("timeoutMs explícito: se respeta en vez del default", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    registrarEnvioExitosoDeCampana.mockResolvedValue({ messageId: "msg_1" });
    const proveedor = proveedorFijo({ kind: "SUCCESS", waMessageId: "wamid.1", renderedText: "x" });
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    await procesarUnEnvioDeCampana({ worker: "w1", proveedor, timeoutMs: 5_000 });
    expect(proveedor).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5_000 }));
  });

  it("EXPLICIT_FAILURE retryable=false: falla definitivo, e intenta completar la campaña", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    registrarFalloEnvioDeCampana.mockResolvedValue({ reintenta: false });
    const proveedor = proveedorFijo({
      kind: "EXPLICIT_FAILURE",
      error: "número inválido",
      retryable: false,
      causa: null,
    });
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "fallido", retryable: false });
    expect(registrarFalloEnvioDeCampana).toHaveBeenCalledWith(
      expect.objectContaining({ errorProveedor: "número inválido", attempts: 1, retryable: false })
    );
    // Cierre definitivo: el job cerró para siempre, intenta completar.
    expect(intentarCompletarCampana).toHaveBeenCalledWith("org_1", "cmp_1");
  });

  it("EXPLICIT_FAILURE retryable=true (con intentos restantes): reintenta, NO intenta completar todavía", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    registrarFalloEnvioDeCampana.mockResolvedValue({ reintenta: true });
    const proveedor = proveedorFijo({
      kind: "EXPLICIT_FAILURE",
      error: "rate limited",
      retryable: true,
      causa: null,
    });
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "fallido", retryable: true });
    expect(registrarFalloEnvioDeCampana).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true })
    );
    // Todavía queda trabajo (va a reintentar): no tiene sentido intentar completar.
    expect(intentarCompletarCampana).not.toHaveBeenCalled();
  });

  it("AMBIGUOUS_FAILURE: NO reintenta ni toca el recipient — queda en sending para el recovery", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    const proveedor = proveedorFijo({ kind: "AMBIGUOUS_FAILURE", error: "timeout", causa: null });
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "ambiguo" });
    expect(registrarEnvioExitosoDeCampana).not.toHaveBeenCalled();
    expect(registrarFalloEnvioDeCampana).not.toHaveBeenCalled();
    // Ni siquiera el update de conversationId cuenta como "tocar el resultado":
    // se permite (ocurre antes del proveedor), pero nada más después.
    // El job sigue vivo (sending) — no tiene sentido intentar completar.
    expect(intentarCompletarCampana).not.toHaveBeenCalled();
  });

  it("reconexión requerida: pausa TODA la campaña y revierte el recipient, sin marcar failed", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    const { TemplateError } = await import("@/server/whatsapp/templates");
    const proveedor = vi.fn().mockRejectedValue(new TemplateError("reconnect_required", "reconecta"));
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "reconexion_requerida" });
    expect(pausarCampana).toHaveBeenCalledWith("org_1", "cmp_1");
    expect(registrarFalloEnvioDeCampana).not.toHaveBeenCalled();
    // La campaña queda paused — jamás se intenta completar aquí.
    expect(intentarCompletarCampana).not.toHaveBeenCalled();
  });

  it("excepción inesperada del proveedor: revierte, no marca failed con certeza falsa", async () => {
    reclamarTrabajoDeCampana.mockResolvedValue(tomado);
    selectQueue.push([campanaProcessing]);
    selectQueue.push([recipienteConContacto]);
    const proveedor = vi.fn().mockRejectedValue(new Error("boom inesperado"));
    const { procesarUnEnvioDeCampana } = await import("@/server/campaigns/worker");

    const resultado = await procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado).toEqual({ outcome: "error_inesperado" });
    expect(pausarCampana).not.toHaveBeenCalled();
    expect(registrarFalloEnvioDeCampana).not.toHaveBeenCalled();
    expect(intentarCompletarCampana).not.toHaveBeenCalled();
  });
});
