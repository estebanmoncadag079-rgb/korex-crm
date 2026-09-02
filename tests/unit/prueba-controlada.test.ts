import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 7B: el camino de PRUEBA CONTROLADA — un único envío real a un único
 * destinatario, aislado del camino de campañas reales. Estos tests cubren
 * las validaciones de `prueba-controlada.ts` con mocks (sin Postgres real);
 * la garantía de concurrencia/aislamiento real vive en
 * `tests/integration/campaign-worker.test.ts`.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

let contadorId = 0;
vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_fake${++contadorId}`,
}));

const selectQueue: Fila[][] = [];
const insertReturningQueue: Fila[][] = [];
const insertSpy = vi.fn();
const updateSpy = vi.fn();

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "for"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: Fila[]) => void) => resolve(rows);
  return chain;
}

const reclamarTrabajoDeCampanaPorId = vi.fn();
vi.mock("@/server/campaigns/cola", () => ({
  reclamarTrabajoDeCampanaPorId: (...args: unknown[]) => reclamarTrabajoDeCampanaPorId(...args),
}));

const resolverTrabajoTomado = vi.fn();
const revertirAPending = vi.fn();
vi.mock("@/server/campaigns/worker", () => ({
  resolverTrabajoTomado: (...args: unknown[]) => resolverTrabajoTomado(...args),
  revertirAPending: (...args: unknown[]) => revertirAPending(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    insert: (...args: unknown[]) => {
      insertSpy(...args);
      return {
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertReturningQueue.shift() ?? []),
          }),
        }),
      };
    },
    update: (...args: unknown[]) => {
      updateSpy(...args);
      return { set: () => ({ where: () => Promise.resolve([{}]) }) };
    },
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const campanaBase = {
  id: "cmp_1",
  organizationId: "org_1",
  status: "ready",
  templateId: "tpl_1",
  templateSnapshot: { name: "seguimiento", language: "es", category: "MARKETING", body: "Hola {{1}}" },
};
const plantillaAprobada = { status: "approved" };
const contactoBase = {
  id: "ct_1",
  organizationId: "org_1",
  name: "María",
  phone: "573001112233",
  waUserId: null,
  marketingOptOut: false,
};

beforeEach(() => {
  selectQueue.length = 0;
  insertReturningQueue.length = 0;
  insertSpy.mockReset();
  updateSpy.mockReset();
});

describe("materializarAudienciaUnica", () => {
  it("contact correcto: crea exactamente un recipient", async () => {
    selectQueue.push([campanaBase], [plantillaAprobada], [contactoBase]);
    insertReturningQueue.push([{ id: "cmpr_fake1" }]);
    const { materializarAudienciaUnica } = await import("@/server/campaigns/prueba-controlada");

    const resultado = await materializarAudienciaUnica({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    });
    expect(resultado).toEqual({ recipientId: "cmpr_fake1", creado: true });
  });

  it("contact de otra organización (scoped no lo encuentra): aborta", async () => {
    selectQueue.push([campanaBase], [plantillaAprobada], []);
    const { materializarAudienciaUnica, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    await expect(
      materializarAudienciaUnica({ organizationId: "org_1", campaignId: "cmp_1", contactId: "ct_ajeno" })
    ).rejects.toBeInstanceOf(PruebaControladaError);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("opt-out: aborta sin crear el recipient", async () => {
    selectQueue.push([campanaBase], [plantillaAprobada], [{ ...contactoBase, marketingOptOut: true }]);
    const { materializarAudienciaUnica, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    const err = await materializarAudienciaUnica({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PruebaControladaError);
    expect(err.code).toBe("opt_out");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("campaign de otra organización (scoped no la encuentra): aborta", async () => {
    selectQueue.push([]);
    const { materializarAudienciaUnica, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    await expect(
      materializarAudienciaUnica({ organizationId: "org_ajena", campaignId: "cmp_1", contactId: "ct_1" })
    ).rejects.toBeInstanceOf(PruebaControladaError);
  });

  it("template vivo no aprobado: aborta", async () => {
    selectQueue.push([campanaBase], [{ status: "pending" }]);
    const { materializarAudienciaUnica, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    const err = await materializarAudienciaUnica({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PruebaControladaError);
    expect(err.code).toBe("invalid");
  });

  it("snapshot null: aborta antes de leer el template vivo", async () => {
    selectQueue.push([{ ...campanaBase, templateSnapshot: null }]);
    const { materializarAudienciaUnica, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    await expect(
      materializarAudienciaUnica({ organizationId: "org_1", campaignId: "cmp_1", contactId: "ct_1" })
    ).rejects.toBeInstanceOf(PruebaControladaError);
  });

  it("campaña no está en ready: aborta", async () => {
    selectQueue.push([{ ...campanaBase, status: "processing" }], [plantillaAprobada]);
    const { materializarAudienciaUnica, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    const err = await materializarAudienciaUnica({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PruebaControladaError);
    expect(err.code).toBe("invalid_transition");
  });

  it("duplicate recipient: segunda llamada es idempotente, no crea un segundo", async () => {
    const { materializarAudienciaUnica } = await import("@/server/campaigns/prueba-controlada");

    selectQueue.push([campanaBase], [plantillaAprobada], [contactoBase]);
    insertReturningQueue.push([{ id: "cmpr_fake1" }]);
    const primero = await materializarAudienciaUnica({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    });
    expect(primero).toEqual({ recipientId: "cmpr_fake1", creado: true });

    // Segunda llamada: el UNIQUE(campaignId, contactId) real rechaza el
    // insert (onConflictDoNothing → sin filas), y la función relee la
    // fila ya existente en vez de crear una segunda.
    selectQueue.push([campanaBase], [plantillaAprobada], [contactoBase]);
    insertReturningQueue.push([]);
    selectQueue.push([{ id: "cmpr_fake1" }]);
    const segundo = await materializarAudienciaUnica({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    });
    expect(segundo).toEqual({ recipientId: "cmpr_fake1", creado: false });
  });
});

describe("encolarJobUnicoDeCampana", () => {
  it("crea exactamente un job para el recipient dado", async () => {
    selectQueue.push([{ campaignId: "cmp_1", status: "pending" }]);
    insertReturningQueue.push([{ id: "cmpj_fake1" }]);
    const { encolarJobUnicoDeCampana } = await import("@/server/campaigns/prueba-controlada");

    const resultado = await encolarJobUnicoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_1",
    });
    expect(resultado).toEqual({ jobId: "cmpj_fake1", creado: true });
  });

  it("campaignId mismatch: el recipient pertenece a OTRA campaña — aborta", async () => {
    selectQueue.push([{ campaignId: "cmp_OTRA", status: "pending" }]);
    const { encolarJobUnicoDeCampana, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    const err = await encolarJobUnicoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PruebaControladaError);
    expect(err.code).toBe("mismatch");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("duplicate job: segunda llamada es idempotente, no crea un segundo", async () => {
    const { encolarJobUnicoDeCampana } = await import("@/server/campaigns/prueba-controlada");

    selectQueue.push([{ campaignId: "cmp_1", status: "pending" }]);
    insertReturningQueue.push([{ id: "cmpj_fake1" }]);
    const primero = await encolarJobUnicoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_1",
    });
    expect(primero.creado).toBe(true);

    selectQueue.push([{ campaignId: "cmp_1", status: "pending" }]);
    insertReturningQueue.push([]);
    selectQueue.push([{ id: "cmpj_fake1" }]);
    const segundo = await encolarJobUnicoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_1",
    });
    expect(segundo).toEqual({ jobId: "cmpj_fake1", creado: false });
  });
});

describe("activarCampanaParaPruebaControlada: límite estricto de 1 recipient/1 job", () => {
  it("exactamente 1 recipient y 1 job: activa a processing", async () => {
    selectQueue.push([campanaBase], [{ id: "cmpr_1" }], [{ id: "cmpj_1" }]);
    const { activarCampanaParaPruebaControlada } = await import("@/server/campaigns/prueba-controlada");

    await activarCampanaParaPruebaControlada("org_1", "cmp_1");
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it(">1 candidato (2 recipients): aborta, NUNCA escoge el primero", async () => {
    selectQueue.push([campanaBase], [{ id: "cmpr_1" }, { id: "cmpr_2" }], [{ id: "cmpj_1" }]);
    const { activarCampanaParaPruebaControlada, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    const err = await activarCampanaParaPruebaControlada("org_1", "cmp_1").catch((e) => e);
    expect(err).toBeInstanceOf(PruebaControladaError);
    expect(err.code).toBe("multiple_candidates");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("transición inválida (ya processing): aborta", async () => {
    selectQueue.push([{ ...campanaBase, status: "completed" }]);
    const { activarCampanaParaPruebaControlada, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    await expect(activarCampanaParaPruebaControlada("org_1", "cmp_1")).rejects.toBeInstanceOf(
      PruebaControladaError
    );
  });
});

describe("previsualizarEnvioControlado: solo lectura", () => {
  it("preview correcto, mensaje renderizado desde el snapshot", async () => {
    selectQueue.push([campanaBase], [contactoBase], []);
    const { previsualizarEnvioControlado } = await import("@/server/campaigns/prueba-controlada");

    const preview = await previsualizarEnvioControlado({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    });
    expect(preview.mensajeFinal).toBe("Hola María");
    expect(preview.telefonoEnmascarado).toBe("********2233"); // 12 dígitos: 8 enmascarados + últimos 4
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it(">1 candidato (otro contacto ya materializado en esta campaña): aborta", async () => {
    selectQueue.push([campanaBase], [contactoBase], [{ contactId: "ct_1" }, { contactId: "ct_OTRO" }]);
    const { previsualizarEnvioControlado, PruebaControladaError } = await import(
      "@/server/campaigns/prueba-controlada"
    );

    const err = await previsualizarEnvioControlado({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PruebaControladaError);
    expect(err.code).toBe("multiple_candidates");
  });
});

describe("prepararPruebaControlada: sin confirmación no ejecuta, con confirmación queda READY_TO_SEND", () => {
  it("sin --confirmar-unico-envio: PREVIEW_ONLY, nada se escribe", async () => {
    selectQueue.push([campanaBase], [contactoBase], []);
    const { prepararPruebaControlada } = await import("@/server/campaigns/prueba-controlada");

    const resultado = await prepararPruebaControlada({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
      confirmar: false,
    });
    expect(resultado.status).toBe("PREVIEW_ONLY");
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("con --confirmar-unico-envio: READY_TO_SEND, materializa/encola/activa, nunca envía", async () => {
    // previsualizarEnvioControlado
    selectQueue.push([campanaBase], [contactoBase], []);
    // materializarAudienciaUnica
    selectQueue.push([campanaBase], [plantillaAprobada], [contactoBase]);
    insertReturningQueue.push([{ id: "cmpr_fake1" }]);
    // encolarJobUnicoDeCampana
    selectQueue.push([{ campaignId: "cmp_1", status: "pending" }]);
    insertReturningQueue.push([{ id: "cmpj_fake1" }]);
    // activarCampanaParaPruebaControlada
    selectQueue.push([campanaBase], [{ id: "cmpr_fake1" }], [{ id: "cmpj_fake1" }]);

    const { prepararPruebaControlada } = await import("@/server/campaigns/prueba-controlada");
    const resultado = await prepararPruebaControlada({
      organizationId: "org_1",
      campaignId: "cmp_1",
      contactId: "ct_1",
      confirmar: true,
    });
    expect(resultado).toMatchObject({
      status: "READY_TO_SEND",
      recipientId: "cmpr_fake1",
      jobId: "cmpj_fake1",
    });
    // Ninguna llamada a un proveedor es posible: la función no acepta ese parámetro.
  });
});

describe("procesarUnEnvioControladoDeCampana: worker acotado a una campaña", () => {
  beforeEach(() => {
    reclamarTrabajoDeCampanaPorId.mockReset();
    resolverTrabajoTomado.mockReset();
    revertirAPending.mockReset();
  });

  it("sin trabajo: sin_trabajo, nada más se toca", async () => {
    reclamarTrabajoDeCampanaPorId.mockResolvedValue(null);
    const { procesarUnEnvioControladoDeCampana } = await import("@/server/campaigns/prueba-controlada");

    const resultado = await procesarUnEnvioControladoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_1",
      proveedor: vi.fn(),
    });
    expect(resultado).toEqual({ outcome: "sin_trabajo" });
    expect(resolverTrabajoTomado).not.toHaveBeenCalled();
  });

  it("recipient no coincide: aborta ANTES del proveedor, revierte, nunca delega en resolverTrabajoTomado", async () => {
    const tomado = { jobId: "cmpj_1", recipientId: "cmpr_OTRO", campaignId: "cmp_1", organizationId: "org_1", attempts: 1 };
    reclamarTrabajoDeCampanaPorId.mockResolvedValue(tomado);
    const { procesarUnEnvioControladoDeCampana } = await import("@/server/campaigns/prueba-controlada");

    const resultado = await procesarUnEnvioControladoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_ESPERADO",
      proveedor: vi.fn(),
    });
    expect(resultado).toEqual({ outcome: "recipient_no_coincide" });
    expect(revertirAPending).toHaveBeenCalledWith(tomado);
    expect(resolverTrabajoTomado).not.toHaveBeenCalled();
  });

  it("recipient coincide: delega en resolverTrabajoTomado (misma lógica del worker general)", async () => {
    const tomado = { jobId: "cmpj_1", recipientId: "cmpr_1", campaignId: "cmp_1", organizationId: "org_1", attempts: 1 };
    reclamarTrabajoDeCampanaPorId.mockResolvedValue(tomado);
    resolverTrabajoTomado.mockResolvedValue({ outcome: "enviado", messageId: "msg_1" });
    const { procesarUnEnvioControladoDeCampana } = await import("@/server/campaigns/prueba-controlada");

    const proveedor = vi.fn();
    const resultado = await procesarUnEnvioControladoDeCampana({
      organizationId: "org_1",
      campaignId: "cmp_1",
      recipientId: "cmpr_1",
      proveedor,
    });
    expect(resultado).toEqual({ outcome: "enviado", messageId: "msg_1" });
    expect(resolverTrabajoTomado).toHaveBeenCalledWith(tomado, expect.objectContaining({ proveedor }));
    expect(revertirAPending).not.toHaveBeenCalled();
  });
});
