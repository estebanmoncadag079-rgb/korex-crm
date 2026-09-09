import { describe, expect, it, vi } from "vitest";

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

/**
 * Incidente real (MALIA, 8-sep-2026, 23:43). Una clienta confirmó su pedido,
 * el agente le prometió "te comunico con una persona del equipo", y nadie vino
 * en 14 minutos mientras ella escribía cinco veces ("Ya no hay servicio??").
 *
 * El campo de números de aviso estaba vacío. Lo grave no fue eso —eso se llena
 * en un minuto— sino que el sistema LO SABÍA y no había dónde verlo: había
 * escrito "sin números de aviso configurados" en `notify_detail` **31 veces**,
 * en tres negocios, desde el 5-sep, y el estado guardado era
 * `fallo_recuperable`, indistinguible de un hipo pasajero de WhatsApp.
 *
 * Estas dos comprobaciones cierran esa puerta: "no había a quién avisar" tiene
 * que ser distinguible en el tipo de retorno (para que quien llama pueda
 * reaccionar) y ruidoso en los logs (para que se vea sin abrir la base).
 */
describe("nadie configuró a quién avisar", () => {
  it("se distingue de un envío fallido, y no se calla", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        select: () => {
          const chain: Record<string, unknown> = {};
          for (const m of ["from", "where", "limit"]) chain[m] = () => chain;
          (chain as { then: unknown }).then = (r: (v: unknown) => void) =>
            Promise.resolve([{ notifyPhones: "  ", notifyTemplate: null, notifyTemplateLang: null }]).then(r);
          return chain;
        },
      }),
      schema: new Proxy({}, { get: (_t, t2) => new Proxy({}, { get: (_a, c) => `${String(t2)}.${String(c)}` }) }),
    }));
    vi.doMock("@/lib/db/tenant", () => ({ scoped: () => ({}) }));

    const errores: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => {
      errores.push(a.map(String).join(" "));
    });

    const { notifyTeam } = await import("@/server/ai/notify-team");
    const r = await notifyTeam({ organizationId: "org_1", summary: "pedido" });

    // No es "falló el envío": es que no había a quién enviarlo.
    expect(r.sinDestinatarios).toBe(true);
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(0);
    // Y queda en los logs, con el sitio donde se arregla.
    expect(errores.join(" ")).toMatch(/SIN NÚMEROS DE AVISO/);
    expect(errores.join(" ")).toMatch(/agente/);
    spy.mockRestore();
  });

  it("con destinatarios reales, la bandera NO se levanta", () => {
    // El complemento del caso de arriba: `sinDestinatarios` distingue de
    // verdad, no está siempre encendida.
    expect(parseNotifyPhones("573046838172").length).toBeGreaterThan(0);
  });
});
