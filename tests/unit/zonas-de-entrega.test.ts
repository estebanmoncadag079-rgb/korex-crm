import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10N-J — fuente única de verdad para la tarifa de domicilio.
 * Incidente real (Kachipay, 4-sep-2026): al cliente le dijeron "$12.000" y
 * el resumen del pedido cerró con "$8.000" — no había ninguna tabla de
 * zonas, así que cada mención del precio era una generación de texto
 * libre independiente. Este archivo prueba el resolvedor puro
 * (`resolverZonaDeEntrega`) y el aislamiento multi-tenant de la consulta.
 */

function zona(id: string, nombre: string, feeCents: number) {
  return { id, nombre, feeCents };
}

describe("resolverZonaDeEntrega", () => {
  it("A: Kachipay con tarifa real ($12.000 = 1.200.000 centavos) — match exacto, reproduce el incidente real", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "Kachipay", 1200000), zona("dz_2", "Centro", 500000)];
    const r = resolverZonaDeEntrega(zonas, "Kachipay");
    expect(r).toEqual({ status: "found", zona: zonas[0] });
  });

  it("B: otra zona -> tarifa distinta, sin mezclarse", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "Kachipay", 1200000), zona("dz_2", "Centro", 500000)];
    const r = resolverZonaDeEntrega(zonas, "Centro");
    expect(r).toEqual({ status: "found", zona: zonas[1] });
  });

  it("tolera tildes, mayúsculas y espacios", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "Kachipay", 1200000)];
    expect(resolverZonaDeEntrega(zonas, "  KACHIPÁY  ")).toEqual({ status: "found", zona: zonas[0] });
  });

  it("match por substring único", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "Kachipay Centro", 1200000), zona("dz_2", "El Retiro", 300000)];
    expect(resolverZonaDeEntrega(zonas, "kachipay")).toEqual({ status: "found", zona: zonas[0] });
  });

  it("match por tokens cuando el cliente lo parafrasea", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "Barrio El Retiro", 1200000), zona("dz_2", "Centro", 300000)];
    expect(resolverZonaDeEntrega(zonas, "domicilio al retiro")).toEqual({ status: "found", zona: zonas[0] });
  });

  it("F: zona desconocida -> not_found, NUNCA inventa una tarifa", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "Kachipay", 1200000)];
    const r = resolverZonaDeEntrega(zonas, "un barrio que no existe en absoluto");
    expect(r).toEqual({ status: "not_found" });
  });

  it("sin ninguna zona registrada -> not_found siempre", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    expect(resolverZonaDeEntrega([], "Kachipay")).toEqual({ status: "not_found" });
  });

  it("dos zonas empatadas -> multiple_matches, pregunta en vez de asumir", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "San Antonio Norte", 400000), zona("dz_2", "San Antonio Sur", 450000)];
    const r = resolverZonaDeEntrega(zonas, "San Antonio");
    expect(r.status).toBe("multiple_matches");
    if (r.status === "multiple_matches") {
      expect(r.zonas.map((z) => z.id).sort()).toEqual(["dz_1", "dz_2"]);
    }
  });

  it("E: domicilio gratis (0) es una zona válida, no 'sin dato'", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_gratis", "Local / recogida", 0)];
    const r = resolverZonaDeEntrega(zonas, "recogida");
    expect(r).toEqual({ status: "found", zona: zonas[0] });
    if (r.status === "found") expect(r.zona.feeCents).toBe(0);
  });
});

describe("textoDeResultadoDomicilio", () => {
  it("found: incluye la cifra en pesos y la marca como dato real verificado", async () => {
    const { textoDeResultadoDomicilio } = await import("@/server/delivery/zonas");
    const texto = textoDeResultadoDomicilio("Kachipay", {
      status: "found",
      zona: zona("dz_1", "Kachipay", 1200000),
    });
    expect(texto).toContain("$12.000");
    expect(texto).toContain("verificado");
  });

  it("not_found: dice explícitamente que no invente la tarifa", async () => {
    const { textoDeResultadoDomicilio } = await import("@/server/delivery/zonas");
    const texto = textoDeResultadoDomicilio("Marte", { status: "not_found" });
    expect(texto.toLowerCase()).toContain("no inventes");
  });
});

const selectQueue: unknown[][] = [];
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  return chain;
}
vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => selectChain(selectQueue.shift() ?? []) }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

describe("zonasDeEntregaQuery: multi-tenant (Constitución III)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
  });

  it("O: pasa organizationId a scoped() — nunca confía en el frontend, siempre en el contexto del servidor", async () => {
    const scopedMod = await import("@/lib/db/tenant");
    const scopedSpy = vi.spyOn(scopedMod, "scoped");
    selectQueue.push([{ id: "dz_1", nombre: "Kachipay", feeCents: 1200000 }]);

    const { zonasDeEntregaQuery } = await import("@/server/delivery/zonas");
    await zonasDeEntregaQuery("org_1");

    expect(scopedSpy).toHaveBeenCalledWith(
      "deliveryZone.organizationId",
      "org_1",
      expect.anything()
    );
  });

  it("devuelve exactamente las filas que la consulta scoped entrega", async () => {
    selectQueue.push([
      { id: "dz_1", nombre: "Kachipay", feeCents: 1200000 },
      { id: "dz_2", nombre: "Centro", feeCents: 500000 },
    ]);
    const { zonasDeEntregaQuery } = await import("@/server/delivery/zonas");
    const zonas = await zonasDeEntregaQuery("org_1");
    expect(zonas).toHaveLength(2);
    expect(zonas[0]).toEqual({ id: "dz_1", nombre: "Kachipay", feeCents: 1200000 });
  });
});
