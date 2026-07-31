import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidSignature,
  isValidWebhookToken,
  safeEqual,
} from "@/server/inbox/webhook";
import { verifyYcloudSignature } from "@/server/inbox/ycloud-webhook";

describe("capa 1: token en la ruta (FR-041/FR-083)", () => {
  it("segmento correcto → válido", () => {
    expect(isValidWebhookToken("token-abc", "token-abc")).toBe(true);
  });

  it("segmento incorrecto → inválido (la ruta responde 404)", () => {
    expect(isValidWebhookToken("token-xyz", "token-abc")).toBe(false);
  });

  it("verify token vacío jamás valida", () => {
    expect(isValidWebhookToken("", "")).toBe(false);
  });
});

describe("capa 2: firma x-hub-signature-256 (FR-042)", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  function sign(payload: string, key: string): string {
    return `sha256=${createHmac("sha256", key).update(payload, "utf8").digest("hex")}`;
  }

  it("firma válida → pasa", () => {
    expect(isValidSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("firma inválida → rechaza (la ruta responde 401)", () => {
    expect(isValidSignature(body, sign(body, "otro-secreto"), secret)).toBe(
      false
    );
  });

  it("firma de otro body → rechaza", () => {
    expect(isValidSignature("{}", sign(body, secret), secret)).toBe(false);
  });

  it("header ausente con secreto configurado → rechaza", () => {
    expect(isValidSignature(body, null, secret)).toBe(false);
  });

  it("sin secreto configurado la capa está desactivada → pasa", () => {
    expect(isValidSignature(body, null, undefined)).toBe(true);
    expect(isValidSignature(body, "sha256=basura", undefined)).toBe(true);
  });
});

describe("safeEqual", () => {
  it("longitudes distintas no lanzan", () => {
    expect(safeEqual("a", "aa")).toBe(false);
  });
});

/**
 * Fallar CERRADO en producción cuando falta el secreto de firma.
 *
 * Antes, sin secreto configurado, ambas verificaciones devolvían `true`: la
 * capa quedaba desactivada. Es cómodo para probar, pero en producción significa
 * aceptar cualquier evento sin firmar — y estos webhooks son las únicas puertas
 * del sistema abiertas sin sesión. Con solo la URL, un desconocido podía meter
 * un "mensaje entrante" falso en la bandeja de un negocio y hacer que su
 * WhatsApp respondiera a un número elegido por él.
 *
 * Un webhook que deja de entregar se nota enseguida y se arregla; uno que
 * acepta mensajes de cualquiera, no.
 */
describe("firmas sin secreto configurado", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en producción RECHAZA aunque no haya secreto (YCloud)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(verifyYcloudSignature("{}", null, undefined)).toBe(false);
  });

  it("en producción RECHAZA aunque no haya secreto (Meta)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isValidSignature("{}", null, undefined)).toBe(false);
  });

  it("fuera de producción sigue permitiendo probar sin secreto", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyYcloudSignature("{}", null, undefined)).toBe(true);
    expect(isValidSignature("{}", null, undefined)).toBe(true);
  });

  it("con secreto puesto, una firma ausente se rechaza siempre", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(verifyYcloudSignature("{}", null, "whsec_loquesea")).toBe(false);
    expect(isValidSignature("{}", null, "appsecret")).toBe(false);
  });
});
