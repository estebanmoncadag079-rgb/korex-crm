import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 4C: `reclamarTrabajoDeCampana` (claim + evidencia de intento) y
 * `rescatarHuerfanosDeCampana` (recovery diferenciado), con foco en
 * multi-tenant y en las validaciones de consistencia — no en volver a
 * probar `SKIP LOCKED` en sí (eso es Postgres real, cubierto en
 * `tests/integration/campaign-idempotency.test.ts`).
 */

type Fila = Record<string, unknown>;

const dbMock = {
  execute: vi.fn(),
  transaction: vi.fn(),
};
const txMock = {
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  getDb: () => dbMock,
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

function selectChain(rows: Fila[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

function updateChain(returning: Fila[] = []) {
  return {
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve(returning),
        then: (resolve: (v: Fila[]) => void) => resolve(returning),
      }),
    }),
  };
}

describe("reclamarTrabajoDeCampana: claim + evidencia de intento (multi-tenant)", () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
    dbMock.transaction.mockReset();
    txMock.execute.mockReset();
    txMock.select.mockReset();
    txMock.update.mockReset();
    dbMock.transaction.mockImplementation((cb: (tx: typeof txMock) => unknown) => cb(txMock));
  });

  it("sin trabajo pendiente, devuelve null sin tocar nada más", async () => {
    const { reclamarTrabajoDeCampana } = await import("@/server/campaigns/cola");
    txMock.execute.mockResolvedValue([]);
    const resultado = await reclamarTrabajoDeCampana("worker-1");
    expect(resultado).toBeNull();
    expect(txMock.select).not.toHaveBeenCalled();
  });

  it("job tomado pero sin recipient coherente en esa organización/campaña: lanza y no transiciona nada", async () => {
    const { reclamarTrabajoDeCampana } = await import("@/server/campaigns/cola");
    txMock.execute.mockResolvedValue([
      { id: "cmpj_1", organization_id: "org_a", campaign_id: "cmp_1", recipient_id: "cmpr_1", attempts: 1 },
    ]);
    txMock.select.mockReturnValue(selectChain([])); // scoped() no encuentra nada: org/campaña no coinciden
    txMock.update.mockReturnValue(updateChain());

    await expect(reclamarTrabajoDeCampana("worker-1")).rejects.toThrow(/dato corrupto/);
    expect(txMock.update).not.toHaveBeenCalled();
  });

  it("recipient encontrado pero en un estado que no admite pasar a sending: lanza sin transicionar", async () => {
    const { reclamarTrabajoDeCampana } = await import("@/server/campaigns/cola");
    txMock.execute.mockResolvedValue([
      { id: "cmpj_1", organization_id: "org_a", campaign_id: "cmp_1", recipient_id: "cmpr_1", attempts: 1 },
    ]);
    txMock.select.mockReturnValue(selectChain([{ status: "sent" }])); // ya se envió antes — inconsistencia
    txMock.update.mockReturnValue(updateChain());

    await expect(reclamarTrabajoDeCampana("worker-1")).rejects.toThrow(/no admite pasar a "sending"/);
    expect(txMock.update).not.toHaveBeenCalled();
  });

  it("caso normal: reclama, transiciona a sending, y devuelve el trabajo tomado", async () => {
    const { reclamarTrabajoDeCampana } = await import("@/server/campaigns/cola");
    txMock.execute.mockResolvedValue([
      { id: "cmpj_1", organization_id: "org_a", campaign_id: "cmp_1", recipient_id: "cmpr_1", attempts: 1 },
    ]);
    txMock.select.mockReturnValue(selectChain([{ status: "pending" }]));
    txMock.update.mockReturnValue(updateChain());

    const resultado = await reclamarTrabajoDeCampana("worker-1");
    expect(resultado).toEqual({
      jobId: "cmpj_1",
      recipientId: "cmpr_1",
      campaignId: "cmp_1",
      organizationId: "org_a",
      attempts: 1,
    });
    expect(txMock.update).toHaveBeenCalledTimes(1); // la transición a sending, y nada más
  });
});

describe("rescatarHuerfanosDeCampana: recovery diferenciado, nunca ciego", () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
    dbMock.transaction.mockReset();
    txMock.update.mockReset();
    txMock.execute.mockReset();
    dbMock.transaction.mockImplementation((cb: (tx: typeof txMock) => unknown) => cb(txMock));
  });

  it("caso A — recipient seguía pending: el job vuelve a la cola sin riesgo", async () => {
    const { rescatarHuerfanosDeCampana } = await import("@/server/campaigns/recovery");
    dbMock.execute
      .mockResolvedValueOnce([{ id: "cmpj_1" }]) // caso A: 1 recuperado
      .mockResolvedValueOnce([]); // caso B: ninguno ambiguo

    const resultado = await rescatarHuerfanosDeCampana();
    expect(resultado).toEqual({ recuperadosSeguro: 1, marcadosIndeterminado: 0 });
  });

  it("caso B — recipient en sending: pasa a indeterminado, el job se cierra como fallido, SIN reintento", async () => {
    const { rescatarHuerfanosDeCampana } = await import("@/server/campaigns/recovery");
    dbMock.execute
      .mockResolvedValueOnce([]) // caso A: ninguno seguro
      .mockResolvedValueOnce([
        { job_id: "cmpj_2", recipient_id: "cmpr_2", organization_id: "org_a" },
      ]); // caso B: 1 ambiguo
    txMock.update.mockReturnValue(updateChain());
    txMock.execute.mockResolvedValue([]);

    const resultado = await rescatarHuerfanosDeCampana();
    expect(resultado).toEqual({ recuperadosSeguro: 0, marcadosIndeterminado: 1 });
    // El recipient se actualiza a indeterminado...
    expect(txMock.update).toHaveBeenCalledTimes(1);
    // ...y el job se cierra (fallido) por la misma vía — nunca vuelve a "pendiente".
    expect(txMock.execute).toHaveBeenCalledTimes(1);
  });
});
