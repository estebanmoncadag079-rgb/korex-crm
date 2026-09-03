import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10H — `applyStatusUpdate()` extendido: además de `message.status`
 * (orden monotónico ya probado en `status-monotonic.test.ts`), ahora anota
 * `campaignRecipient.deliveredAt`/`readAt` cuando corresponde. Archivo
 * separado de `ycloud-delivery-status.test.ts` porque ese mockea
 * `@/server/inbox/status` entero (para probar `handleYcloudEvent`
 * aislado) — aquí se necesita la implementación REAL.
 */

type Fila = Record<string, unknown>;

const publishMock = vi.fn();
vi.mock("@/server/events/bus", () => ({ publish: (...args: unknown[]) => publishMock(...args) }));

const selectQueue: Fila[][] = [];
const updateCalls: Array<{ values: Record<string, unknown> }> = [];

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ values });
        return { where: () => Promise.resolve([{}]) };
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

beforeEach(() => {
  selectQueue.length = 0;
  updateCalls.length = 0;
  publishMock.mockReset();
});

describe("applyStatusUpdate: extiende campaignRecipient.deliveredAt/readAt", () => {
  it("M: delivered — actualiza message.status Y campaignRecipient.deliveredAt", async () => {
    selectQueue.push([{ id: "msg_1", conversationId: "cv_1", status: "sent" }]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");

    await applyStatusUpdate("org_1", { id: "wamid.abc", status: "delivered", timestamp: "123" });
    expect(updateCalls).toHaveLength(2); // message + campaignRecipient
    expect(updateCalls[1]!.values).toHaveProperty("deliveredAt");
  });

  it("N: read — actualiza campaignRecipient.readAt, nunca deliveredAt de nuevo", async () => {
    selectQueue.push([{ id: "msg_1", conversationId: "cv_1", status: "delivered" }]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");

    await applyStatusUpdate("org_1", { id: "wamid.abc", status: "read", timestamp: "123" });
    expect(updateCalls[1]!.values).toHaveProperty("readAt");
    expect(updateCalls[1]!.values).not.toHaveProperty("deliveredAt");
  });

  it("O: failed — actualiza message.status pero NUNCA toca campaignRecipient (solo delivered/read lo hacen)", async () => {
    selectQueue.push([{ id: "msg_1", conversationId: "cv_1", status: "sent" }]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");

    await applyStatusUpdate("org_1", { id: "wamid.abc", status: "failed", timestamp: "123", errors: [{ code: 1, message: "x" }] });
    expect(updateCalls).toHaveLength(1); // solo message
  });

  it("P: delivered LLEGA DESPUÉS de read (fuera de orden) — se ignora por completo (isUpgrade lo bloquea), cero UPDATE", async () => {
    selectQueue.push([{ id: "msg_1", conversationId: "cv_1", status: "read" }]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");

    await applyStatusUpdate("org_1", { id: "wamid.abc", status: "delivered", timestamp: "123" });
    expect(updateCalls).toHaveLength(0);
  });

  it("Q: duplicado — el mismo status (read) llega dos veces: la segunda vez no vuelve a escribir", async () => {
    selectQueue.push([{ id: "msg_1", conversationId: "cv_1", status: "read" }]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");

    await applyStatusUpdate("org_1", { id: "wamid.abc", status: "read", timestamp: "123" });
    expect(updateCalls).toHaveLength(0);
  });

  it("R: mensaje no encontrado (waMessageId desconocido en esta organización) — no hace nada, no lanza", async () => {
    selectQueue.push([]);
    const { applyStatusUpdate } = await import("@/server/inbox/status");

    await expect(applyStatusUpdate("org_1", { id: "wamid.inexistente", status: "sent", timestamp: "123" })).resolves.toBeUndefined();
    expect(updateCalls).toHaveLength(0);
  });

  it("S: status desconocido (no es sent/delivered/read/failed) — se ignora", async () => {
    const { applyStatusUpdate } = await import("@/server/inbox/status");
    await applyStatusUpdate("org_1", { id: "wamid.abc", status: "warning", timestamp: "123" });
    expect(selectQueue).toHaveLength(0); // ni siquiera llega a buscar el mensaje
    expect(updateCalls).toHaveLength(0);
  });
});

describe("organizationIdDeMensaje (real, resolución multi-tenant por waMessageId único)", () => {
  it("T: mensaje encontrado — devuelve su organizationId", async () => {
    selectQueue.push([{ organizationId: "org_1" }]);
    const { organizationIdDeMensaje } = await import("@/server/inbox/status");
    expect(await organizationIdDeMensaje("wamid.abc")).toBe("org_1");
  });

  it("U: mensaje no encontrado — null, nunca lanza", async () => {
    selectQueue.push([]);
    const { organizationIdDeMensaje } = await import("@/server/inbox/status");
    expect(await organizationIdDeMensaje("wamid.inexistente")).toBeNull();
  });
});
