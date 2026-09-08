import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10W — "Fase 0" para el webhook de Meta directo
 * (`/api/webhooks/wa/[webhookToken]/route.ts`), hasta ahora ausente: el
 * hallazgo real de la auditoría fue que este camino respondía 200 ANTES de
 * procesar (`after()`), sin guardar el evento crudo — un fallo a mitad de
 * camino, o un reinicio del contenedor, perdía el evento sin dejar ningún
 * rastro. YCloud ya tenía esta protección desde el 3-ago-2026
 * (`webhook-event-log.ts`); este test prueba que el route handler de Meta
 * ahora la usa igual: captura ANTES de procesar, procesamiento SÍNCRONO (ya
 * no en `after()`), y marca procesado/fallido según corresponda.
 */

const recordWebhookEvent = vi.fn();
const markWebhookEventProcessed = vi.fn();
const markWebhookEventFailed = vi.fn();
vi.mock("@/server/inbox/webhook-event-log", () => ({
  recordWebhookEvent: (...a: unknown[]) => recordWebhookEvent(...a),
  markWebhookEventProcessed: (...a: unknown[]) => markWebhookEventProcessed(...a),
  markWebhookEventFailed: (...a: unknown[]) => markWebhookEventFailed(...a),
}));

const processMessagesValue = vi.fn();
vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue: (...a: unknown[]) => processMessagesValue(...a),
}));

const processTemplateStatusValue = vi.fn();
vi.mock("@/server/whatsapp/template-events", () => ({
  processTemplateStatusValue: (...a: unknown[]) => processTemplateStatusValue(...a),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    META_WEBHOOK_VERIFY_TOKEN: "token-secreto",
    META_APP_SECRET: undefined, // sin firma configurada: fuera de prod, pasa
  }),
}));

function req(body: string, opts?: { badSignature?: boolean }) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts?.badSignature) headers.set("x-hub-signature-256", "sha256=no-coincide");
  return new Request("https://x.test/api/webhooks/wa/token-secreto", {
    method: "POST",
    body,
    headers,
  });
}

const PAYLOAD_VALIDO = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "waba_1", changes: [{ field: "messages", value: { messages: [] } }] }],
});

describe("POST /api/webhooks/wa/[webhookToken] — Fase 10W: captura antes de procesar", () => {
  beforeEach(() => {
    recordWebhookEvent.mockReset().mockResolvedValue({ id: "we_1", payload: JSON.parse(PAYLOAD_VALIDO) });
    markWebhookEventProcessed.mockReset().mockResolvedValue(undefined);
    markWebhookEventFailed.mockReset().mockResolvedValue(undefined);
    processMessagesValue.mockReset().mockResolvedValue(undefined);
    processTemplateStatusValue.mockReset().mockResolvedValue(undefined);
  });

  it("BUG REAL corregido: guarda el evento crudo ANTES de procesar, y lo marca procesado — ya no depende de after()", async () => {
    const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
    const res = await POST(req(PAYLOAD_VALIDO), { params: Promise.resolve({ webhookToken: "token-secreto" }) });

    expect(res.status).toBe(200);
    expect(recordWebhookEvent).toHaveBeenCalledTimes(1);
    expect(recordWebhookEvent.mock.calls[0]![0]).toMatchObject({ source: "meta" });
    // El procesamiento YA terminó cuando el handler devuelve la respuesta
    // (síncrono, no en after()): se puede aserta sin esperar nada más.
    expect(processMessagesValue).toHaveBeenCalledTimes(1);
    expect(markWebhookEventProcessed).toHaveBeenCalledWith("we_1", null);
    expect(markWebhookEventFailed).not.toHaveBeenCalled();
  });

  it("si el procesamiento falla, el evento queda marcado 'fallido' con el error — no se pierde en silencio", async () => {
    processMessagesValue.mockRejectedValue(new Error("boom"));
    const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
    const res = await POST(req(PAYLOAD_VALIDO), { params: Promise.resolve({ webhookToken: "token-secreto" }) });

    expect(res.status).toBe(200); // Meta no debe reintentar en bucle
    expect(markWebhookEventFailed).toHaveBeenCalledTimes(1);
    expect(markWebhookEventFailed.mock.calls[0]![0]).toBe("we_1");
  });

  it("JSON ilegible: se marca fallido igual, pero el crudo ya quedó guardado", async () => {
    recordWebhookEvent.mockResolvedValue({ id: "we_2", payload: null });
    const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
    const res = await POST(req("esto no es json"), { params: Promise.resolve({ webhookToken: "token-secreto" }) });

    expect(res.status).toBe(200);
    expect(recordWebhookEvent).toHaveBeenCalledTimes(1); // el crudo se guardó
    expect(markWebhookEventFailed).toHaveBeenCalledWith("we_2", "cuerpo no es JSON válido");
    expect(processMessagesValue).not.toHaveBeenCalled();
  });

  it("si el guardado del evento crudo falla, responde 503 (para que Meta reintente) y no procesa nada", async () => {
    recordWebhookEvent.mockRejectedValue(new Error("DB caída"));
    const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
    const res = await POST(req(PAYLOAD_VALIDO), { params: Promise.resolve({ webhookToken: "token-secreto" }) });

    expect(res.status).toBe(503);
    expect(processMessagesValue).not.toHaveBeenCalled();
  });

  it("token de la URL incorrecto: 404, y nunca llega a guardar ni procesar nada", async () => {
    const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
    const res = await POST(req(PAYLOAD_VALIDO), { params: Promise.resolve({ webhookToken: "token-equivocado" }) });

    expect(res.status).toBe(404);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });
});
