import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  transicionAutomaticaPermitida,
  transicionRecipientValida,
} from "@/server/campaigns/estados";

/**
 * Fase 4C (auditoría de idempotencia, 2-sep-2026): la máquina de estados en
 * sí (pura, sin DB) y el comportamiento de `registrarEnvioExitosoDeCampana`/
 * `registrarFalloEnvioDeCampana` ante los distintos resultados posibles.
 *
 * Nada aquí llama a un proveedor de WhatsApp ni a Postgres real: los tests
 * de concurrencia real con `SKIP LOCKED` y de atomicidad real de
 * transacciones viven en `tests/integration/campaign-idempotency.test.ts`
 * (mismo motivo que `tests/integration/_db.ts` ya documenta para
 * `agent_job`: eso no se puede probar con un doble sin acabar probando el
 * doble).
 */

describe("estados.ts: la máquina de estados en sí", () => {
  it("pending solo puede ir a sending o skipped", () => {
    expect(transicionRecipientValida("pending", "sending")).toBe(true);
    expect(transicionRecipientValida("pending", "skipped")).toBe(true);
    expect(transicionRecipientValida("pending", "sent")).toBe(false);
    expect(transicionRecipientValida("pending", "indeterminado")).toBe(false);
  });

  it("sending puede ir a sent, failed, pending (nunca llamó) o indeterminado (ambiguo)", () => {
    expect(transicionRecipientValida("sending", "sent")).toBe(true);
    expect(transicionRecipientValida("sending", "failed")).toBe(true);
    expect(transicionRecipientValida("sending", "pending")).toBe(true);
    expect(transicionRecipientValida("sending", "indeterminado")).toBe(true);
  });

  it("sent y skipped son terminales — nada sale de ahí", () => {
    expect(transicionRecipientValida("sent", "pending")).toBe(false);
    expect(transicionRecipientValida("sent", "failed")).toBe(false);
    expect(transicionRecipientValida("skipped", "pending")).toBe(false);
  });

  it("failed puede reintentarse (vuelve a pending), nada más", () => {
    expect(transicionRecipientValida("failed", "pending")).toBe(true);
    expect(transicionRecipientValida("failed", "sent")).toBe(false);
  });

  it("indeterminado admite las tres salidas manuales — pero ninguna es automática", () => {
    expect(transicionRecipientValida("indeterminado", "pending")).toBe(true);
    expect(transicionRecipientValida("indeterminado", "sent")).toBe(true);
    expect(transicionRecipientValida("indeterminado", "failed")).toBe(true);
    // La distinción crítica de todo el diseño: válida sintácticamente, pero
    // NUNCA automática (ver el siguiente describe).
    expect(transicionAutomaticaPermitida("indeterminado", "pending")).toBe(false);
    expect(transicionAutomaticaPermitida("indeterminado", "sent")).toBe(false);
    expect(transicionAutomaticaPermitida("indeterminado", "failed")).toBe(false);
  });
});

describe("transicionAutomaticaPermitida: lo que un proceso SIN humano puede hacer", () => {
  it("las transiciones seguras de la cola están permitidas", () => {
    expect(transicionAutomaticaPermitida("pending", "sending")).toBe(true);
    expect(transicionAutomaticaPermitida("pending", "skipped")).toBe(true);
    expect(transicionAutomaticaPermitida("sending", "sent")).toBe(true);
    expect(transicionAutomaticaPermitida("sending", "failed")).toBe(true);
    expect(transicionAutomaticaPermitida("sending", "pending")).toBe(true);
    expect(transicionAutomaticaPermitida("sending", "indeterminado")).toBe(true);
    expect(transicionAutomaticaPermitida("failed", "pending")).toBe(true);
  });

  it("ninguna transición DESDE indeterminado es automática, aunque sea válida", () => {
    for (const hacia of ["pending", "sent", "failed"] as const) {
      expect(transicionRecipientValida("indeterminado", hacia)).toBe(true);
      expect(transicionAutomaticaPermitida("indeterminado", hacia)).toBe(false);
    }
  });
});

/* ============================================================
 * registrarEnvioExitosoDeCampana / registrarFalloEnvioDeCampana
 * ============================================================ */

type Fila = Record<string, unknown>;

const txMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: async (cb: (tx: typeof txMock) => unknown) => cb(txMock),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_fake123`,
}));

function insertChain(returning: Fila[]) {
  return {
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(returning),
      }),
    }),
  };
}

function updateChain(returning: Fila[]) {
  return {
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve(returning),
        // `where` sin `.returning()` también se usa (recovery/registrarFallo) —
        // debe seguir siendo awaitable directamente.
        then: (resolve: (v: Fila[]) => void) => resolve(returning),
      }),
    }),
  };
}

/** La cadena de la guardia (Fase 4F): `select(...).from(...).where(...).for("update").limit(1)`. */
function selectForUpdateChain(rows: Fila[]) {
  return {
    from: () => ({
      where: () => ({
        for: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
}

describe("registrarEnvioExitosoDeCampana: la transacción de éxito", () => {
  beforeEach(() => {
    txMock.select.mockReset();
    txMock.insert.mockReset();
    txMock.update.mockReset();
    txMock.execute.mockReset();
    // Por defecto, el recipient está en "sending" — el estado normal justo
    // después del claim, el único desde el que esta función debe operar.
    txMock.select.mockReturnValue(selectForUpdateChain([{ status: "sending" }]));
  });

  it("inserta el mensaje, marca sent con el messageId, y cierra el job — todo junto", async () => {
    const { registrarEnvioExitosoDeCampana } = await import("@/server/campaigns/cola");
    txMock.insert.mockReturnValue(insertChain([{ id: "msg_fake123" }]));
    txMock.update.mockReturnValue(updateChain([{ id: "cmpr_1" }]));
    txMock.execute.mockResolvedValue([]);

    const resultado = await registrarEnvioExitosoDeCampana({
      jobId: "cmpj_1",
      recipientId: "cmpr_1",
      organizationId: "org_a",
      conversationId: "cv_1",
      waMessageId: "wamid.123",
      text: "hola",
    });

    expect(resultado).toEqual({ messageId: "msg_fake123" });
    expect(txMock.insert).toHaveBeenCalledTimes(1);
    expect(txMock.update).toHaveBeenCalledTimes(1);
    expect(txMock.execute).toHaveBeenCalledTimes(1); // el DELETE del job
  });

  it("si el waMessageId ya existía (reintento duplicado), aborta sin tocar el recipient", async () => {
    const { registrarEnvioExitosoDeCampana } = await import("@/server/campaigns/cola");
    txMock.insert.mockReturnValue(insertChain([])); // onConflictDoNothing: nada insertado
    txMock.update.mockReturnValue(updateChain([]));

    await expect(
      registrarEnvioExitosoDeCampana({
        jobId: "cmpj_1",
        recipientId: "cmpr_1",
        organizationId: "org_a",
        conversationId: "cv_1",
        waMessageId: "wamid.ya_existia",
        text: null,
      })
    ).rejects.toThrow(/ya existía/);

    expect(txMock.update).not.toHaveBeenCalled(); // atomicidad: nunca llega a tocar el recipient
    expect(txMock.execute).not.toHaveBeenCalled(); // ni a cerrar el job
  });

  it("si el recipient no existe en esa organización, aborta la transacción entera", async () => {
    const { registrarEnvioExitosoDeCampana } = await import("@/server/campaigns/cola");
    txMock.select.mockReturnValue(selectForUpdateChain([])); // guardia: nada que bloquear

    await expect(
      registrarEnvioExitosoDeCampana({
        jobId: "cmpj_1",
        recipientId: "cmpr_ajena",
        organizationId: "org_a",
        conversationId: "cv_1",
        waMessageId: "wamid.456",
        text: null,
      })
    ).rejects.toThrow(/no encontrado/);

    expect(txMock.insert).not.toHaveBeenCalled(); // ni siquiera intenta insertar el mensaje
    expect(txMock.execute).not.toHaveBeenCalled();
  });

  // Fase 4F, hallazgo 1: la guardia rechaza si el recovery ya se adelantó.
  it.each(["indeterminado", "sent", "skipped", "failed"] as const)(
    "si el recipient ya está en %s, rechaza sin insertar message ni cerrar el job",
    async (estado) => {
      const { registrarEnvioExitosoDeCampana } = await import("@/server/campaigns/cola");
      txMock.select.mockReturnValue(selectForUpdateChain([{ status: estado }]));

      await expect(
        registrarEnvioExitosoDeCampana({
          jobId: "cmpj_1",
          recipientId: "cmpr_1",
          organizationId: "org_a",
          conversationId: "cv_1",
          waMessageId: "wamid.race",
          text: null,
        })
      ).rejects.toThrow(/ya no admite pasar a "sent"/);

      expect(txMock.insert).not.toHaveBeenCalled();
      expect(txMock.update).not.toHaveBeenCalled();
      expect(txMock.execute).not.toHaveBeenCalled();
    }
  );
});

describe("registrarFalloEnvioDeCampana: solo para errores EXPLÍCITOS del proveedor", () => {
  beforeEach(() => {
    txMock.select.mockReset();
    txMock.update.mockReset();
    txMock.execute.mockReset();
    txMock.select.mockReturnValue(selectForUpdateChain([{ status: "sending" }]));
    txMock.update.mockReturnValue(updateChain([{ id: "cmpr_1" }]));
    txMock.execute.mockResolvedValue([]);
  });

  it("agotados los intentos, marca failed definitivo — sin reintento", async () => {
    const { registrarFalloEnvioDeCampana, MAX_INTENTOS_CAMPANA } = await import(
      "@/server/campaigns/cola"
    );
    const resultado = await registrarFalloEnvioDeCampana({
      jobId: "cmpj_1",
      recipientId: "cmpr_1",
      organizationId: "org_a",
      errorProveedor: "número inválido",
      attempts: MAX_INTENTOS_CAMPANA,
    });
    expect(resultado).toEqual({ reintenta: false });
    // Un solo update de recipient (a failed) y un execute (job → fallido).
    expect(txMock.update).toHaveBeenCalledTimes(1);
    expect(txMock.execute).toHaveBeenCalledTimes(1);
  });

  it("con intentos restantes, reprograma: recipient vuelve a pending, job a pendiente", async () => {
    const { registrarFalloEnvioDeCampana } = await import("@/server/campaigns/cola");
    const resultado = await registrarFalloEnvioDeCampana({
      jobId: "cmpj_1",
      recipientId: "cmpr_1",
      organizationId: "org_a",
      errorProveedor: "timeout de red explícito",
      attempts: 1,
    });
    expect(resultado).toEqual({ reintenta: true });
    // Dos updates de recipient (failed, luego pending) y un execute (reprogramar el job).
    expect(txMock.update).toHaveBeenCalledTimes(2);
    expect(txMock.execute).toHaveBeenCalledTimes(1);
  });

  it("si el recipient ya está indeterminado, rechaza sin escribir failed", async () => {
    const { registrarFalloEnvioDeCampana } = await import("@/server/campaigns/cola");
    txMock.select.mockReturnValue(selectForUpdateChain([{ status: "indeterminado" }]));

    await expect(
      registrarFalloEnvioDeCampana({
        jobId: "cmpj_1",
        recipientId: "cmpr_1",
        organizationId: "org_a",
        errorProveedor: "número inválido",
        attempts: 1,
      })
    ).rejects.toThrow(/ya no admite pasar a "failed"/);

    expect(txMock.update).not.toHaveBeenCalled();
    expect(txMock.execute).not.toHaveBeenCalled();
  });
});
