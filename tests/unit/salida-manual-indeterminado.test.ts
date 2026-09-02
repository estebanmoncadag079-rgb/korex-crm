import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 4F: `salidaManualDeIndeterminado` — la única vía de salida de
 * `indeterminado`, con las guardias añadidas tras la Fase 4E (hallazgos 2 y
 * 3): motivo obligatorio, y `hacia: "sent"` exige un `messageId` real,
 * perteneciente a la MISMA organización, verificado antes de escribir nada.
 */

type Fila = Record<string, unknown>;

const dbMock = {
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
        // `leerFila` de `conRegistro` hace `where(donde)` sin `.limit()`,
        // devolviendo el array directo — soporta las dos formas.
        then: (resolve: (v: Fila[]) => void) => resolve(rows),
      }),
    }),
  };
}

function updateChain(returning: Fila[] = []) {
  return {
    set: () => ({
      where: () => Promise.resolve(returning),
    }),
  };
}

describe("salidaManualDeIndeterminado: motivo obligatorio", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.update.mockReturnValue(updateChain());
  });

  it("motivo vacío: rechaza sin tocar la base", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "pending",
        actor: "user:operador",
        motivo: "",
      })
    ).rejects.toThrow(/motivo no puede estar vacío/);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("motivo solo espacios: rechaza igual", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "failed",
        actor: "user:operador",
        motivo: "   ",
      })
    ).rejects.toThrow(/motivo no puede estar vacío/);
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});

describe("salidaManualDeIndeterminado: hacia pending/failed — sin exigencia de messageId", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.update.mockReturnValue(updateChain());
    // leerFila de conRegistro (antes/después) — misma fila simple basta.
    dbMock.select.mockReturnValue(selectChain([{ id: "cmpr_1", status: "indeterminado" }]));
  });

  it("indeterminado → pending: permitido, sin tocar message", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "pending",
        actor: "user:operador",
        motivo: "Confirmado con el cliente que nunca llegó, reintentar",
      })
    ).resolves.toBeUndefined();
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });

  it("indeterminado → failed: permitido", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "failed",
        actor: "user:operador",
        motivo: "Confirmado que el número no existe, abandonar",
      })
    ).resolves.toBeUndefined();
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });
});

describe("salidaManualDeIndeterminado: hacia sent — exige messageId real y verificado", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    dbMock.update.mockReturnValue(updateChain());
  });

  it("messageId inexistente: rechaza antes de escribir", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    dbMock.select
      .mockReturnValueOnce(selectChain([{ conversationId: "cv_1" }])) // recipient
      .mockReturnValueOnce(selectChain([])); // message: no existe

    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "sent",
        messageId: "msg_fantasma",
        actor: "user:operador",
        motivo: "El cliente mostró captura del mensaje recibido",
      })
    ).rejects.toThrow(/no existe/);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("messageId de otra organización: rechaza (scoped() nunca lo encuentra)", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    dbMock.select
      .mockReturnValueOnce(selectChain([{ conversationId: "cv_1" }])) // recipient de org_a
      .mockReturnValueOnce(selectChain([])); // message de org_b: scoped(org_a) no lo encuentra

    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "sent",
        messageId: "msg_de_otra_org",
        actor: "user:operador",
        motivo: "Intento incorrecto de cruzar organizaciones",
      })
    ).rejects.toThrow(/no existe/);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("messageId de otra conversación (misma org): rechaza", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    dbMock.select
      .mockReturnValueOnce(selectChain([{ conversationId: "cv_1" }])) // recipient
      .mockReturnValueOnce(selectChain([{ id: "msg_x", conversationId: "cv_2" }])); // message de otra conversación

    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "sent",
        messageId: "msg_x",
        actor: "user:operador",
        motivo: "Cruce de conversación",
      })
    ).rejects.toThrow(/no coincide/);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("messageId válido: permitido, escribe status=sent y el messageId", async () => {
    const { salidaManualDeIndeterminado } = await import("@/server/campaigns/recovery");
    const setSpy = vi.fn().mockReturnValue({ where: () => Promise.resolve([]) });
    dbMock.update.mockReturnValue({ set: setSpy });
    dbMock.select
      .mockReturnValueOnce(selectChain([{ conversationId: "cv_1" }])) // recipient
      .mockReturnValueOnce(selectChain([{ id: "msg_real", conversationId: "cv_1" }])) // message válido
      .mockReturnValue(selectChain([{ id: "cmpr_1", status: "indeterminado" }])); // leerFila de conRegistro

    await expect(
      salidaManualDeIndeterminado({
        organizationId: "org_a",
        recipientId: "cmpr_1",
        hacia: "sent",
        messageId: "msg_real",
        actor: "user:operador",
        motivo: "El cliente confirmó por otra vía que sí lo recibió",
      })
    ).resolves.toBeUndefined();

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", messageId: "msg_real" })
    );
  });
});
