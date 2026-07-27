import { describe, expect, it } from "vitest";

/**
 * Aviso de pedido al equipo: la lista de destinatarios la teclea el negocio,
 * así que tolera comas, espacios, '+' y duplicados — pero nunca inventa
 * números ni deja pasar basura.
 */

import { parseNotifyPhones, waMeLink } from "@/server/ai/notify-team";

describe("destinatarios del aviso de pedido", () => {
  it("separa por coma, punto y coma o salto de línea", () => {
    expect(parseNotifyPhones("573046838172, 573167298393;573044293489")).toEqual([
      "573046838172",
      "573167298393",
      "573044293489",
    ]);
  });

  it("respeta el número escrito con '+', espacios y guiones dentro", () => {
    expect(parseNotifyPhones("+57 304-683-8172")).toEqual(["573046838172"]);
    expect(parseNotifyPhones("+57 304 683 8172, +57 316 729 8393")).toEqual([
      "573046838172",
      "573167298393",
    ]);
  });

  it("descarta vacíos, cortos y cadenas imposibles", () => {
    expect(parseNotifyPhones("573046838172, , 12, abc, 1234567890123456789")).toEqual([
      "573046838172",
    ]);
  });

  it("no repite el mismo número escrito de dos formas", () => {
    expect(parseNotifyPhones("+573046838172, 573046838172")).toEqual([
      "573046838172",
    ]);
  });

  it("sin configurar → sin destinatarios (no revienta)", () => {
    expect(parseNotifyPhones(null)).toEqual([]);
    expect(parseNotifyPhones("")).toEqual([]);
    expect(parseNotifyPhones("   ")).toEqual([]);
  });
});

describe("enlace para responderle al cliente", () => {
  it("completa el indicativo colombiano en números de 10 dígitos", () => {
    expect(waMeLink("3046838172")).toBe("https://wa.me/573046838172");
  });

  it("respeta el número que ya trae indicativo", () => {
    expect(waMeLink("573046838172")).toBe("https://wa.me/573046838172");
  });

  it("sin dígitos → sin enlace", () => {
    expect(waMeLink("sin numero")).toBeNull();
  });
});
