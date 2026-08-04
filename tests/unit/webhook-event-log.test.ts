import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Captura del webhook antes de procesar (Fase 0, 3-ago-2026): el INSERT del
 * crudo debe ocurrir siempre, sea o no válido el JSON, y el estado debe
 * poder marcarse procesado/fallido después. Sin esto, un fallo a mitad de
 * camino era invisible — no quedaba ni rastro de qué había mandado YCloud.
 */

const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
  schema: { webhookEvent: {} },
}));

describe("webhook-event-log", () => {
  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
  });

  it("guarda el crudo con payload parseado cuando el JSON es válido", async () => {
    const { recordWebhookEvent } = await import(
      "@/server/inbox/webhook-event-log"
    );
    const { id, payload } = await recordWebhookEvent({
      source: "agencia",
      rawBody: '{"type":"whatsapp.inbound_message.received"}',
      headers: { "content-type": "application/json" },
      signature: "t=1,s=abc",
    });

    expect(id).toMatch(/^whev_/);
    expect(payload).toEqual({ type: "whatsapp.inbound_message.received" });
    expect(inserted[0]).toMatchObject({
      source: "agencia",
      rawBody: '{"type":"whatsapp.inbound_message.received"}',
      payload: { type: "whatsapp.inbound_message.received" },
      organizationId: null,
    });
  });

  it("con JSON inválido, guarda el crudo igual y payload queda null", async () => {
    const { recordWebhookEvent } = await import(
      "@/server/inbox/webhook-event-log"
    );
    const { payload } = await recordWebhookEvent({
      source: "org_1",
      rawBody: "esto no es json",
      headers: {},
      signature: null,
      organizationId: "org_1",
    });

    expect(payload).toBeNull();
    expect(inserted[0]).toMatchObject({
      rawBody: "esto no es json",
      payload: null,
      organizationId: "org_1",
    });
  });

  it("marca procesado con la organización resuelta", async () => {
    const { markWebhookEventProcessed } = await import(
      "@/server/inbox/webhook-event-log"
    );
    await markWebhookEventProcessed("whev_1", "org_1");

    expect(updated[0]).toMatchObject({ status: "procesado", organizationId: "org_1" });
  });

  it("marca fallido con el mensaje del error", async () => {
    const { markWebhookEventFailed } = await import(
      "@/server/inbox/webhook-event-log"
    );
    await markWebhookEventFailed("whev_1", new Error("proveedor caído"));

    expect(updated[0]).toMatchObject({ status: "fallido", error: "proveedor caído" });
  });
});
