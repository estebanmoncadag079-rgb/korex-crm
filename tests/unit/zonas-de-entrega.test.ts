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

/**
 * 25-sep-2026 — medido contra 49 direcciones REALES de pedidos cerrados de
 * MALIA (con la tarifa que de verdad se cobró): el buscador daba por buena una
 * zona apoyándose SOLO en un número de la calle o en una palabra de dirección.
 * "Calle 119#20-66 Decepaz" → "20 de Julio" (por el "20"); "Carrera 94 2
 * 1A-oeste" → "Alfonso López 1a Etapa" (cobró $10.000 en vez de $8.000);
 * "… Centro, Cali" → "Calima"/"Calipso" (por "cali"). Con el backend
 * verificando SIEMPRE, una coincidencia así cobra mal en silencio: es peor que
 * preguntar el barrio.
 */
describe("resolverZonaDeEntrega: un número o una palabra de dirección no bastan", () => {
  const ZONAS = [
    zona("dz_20j", "20 de Julio", 1000000),
    zona("dz_alf", "Alfonso López P. 1a. Etapa", 1000000),
    zona("dz_cma", "Calima", 1000000),
    zona("dz_cps", "Calipso", 1000000),
    zona("dz_cen", "Centenario", 800000),
    zona("dz_flo", "Floralia", 1000000),
    zona("dz_ref", "El Refugio", 800000),
  ];

  it("el número de la calle NO identifica un barrio (Decepaz ≠ 20 de Julio)", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    expect(resolverZonaDeEntrega(ZONAS, "Calle 119#20-66 Decepaz").status).not.toBe("found");
  });

  it("un '1A' de la nomenclatura NO es la '1a Etapa' de un barrio (cobraba $10.000 en vez de $8.000)", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    expect(resolverZonaDeEntrega(ZONAS, "Carrera 94 2 1A-oeste-10").status).not.toBe("found");
  });

  it("'Cali' es la ciudad, no Calima ni Calipso", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    expect(
      resolverZonaDeEntrega(ZONAS, "Edificio Colombia Carrera 3 #10-12 oficina 404, Centro, Cali").status
    ).toBe("not_found");
  });

  it("'center' de un centro comercial no es el barrio Centenario", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    expect(
      resolverZonaDeEntrega(ZONAS, "Calle 14 #4-49 c.c makao center frente a la joyeria").status
    ).not.toBe("found");
  });

  it("CONTROL: con el barrio en la dirección, sigue encontrándolo", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const flo = resolverZonaDeEntrega(ZONAS, "Calle 72L # 4n 86, Floralia");
    expect(flo.status === "found" && flo.zona.nombre).toBe("Floralia");
    const ref = resolverZonaDeEntrega(ZONAS, "Cl. 4 #66B-52, edificio miro barrio el refugio");
    expect(ref.status === "found" && ref.zona.nombre).toBe("El Refugio");
  });
});

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

  /**
   * Fase 8H — caso real de MALIA (8-sep-2026): una clienta escribió
   * "poblado ll" (con L minúsculas por "II"). El catálogo tiene "El Poblado"
   * y "Poblado II", las dos reales. El desempate por `ratio` elegía "El
   * Poblado" en silencio, solo porque su nombre tiene menos palabras. Con dos
   * zonas de tarifa distinta, ese mismo camino cobra mal sin que nadie lo
   * note.
   */
  it("BUG REAL: 'poblado ll' con dos zonas hermanas -> PREGUNTA cuál, no elige la de nombre más corto", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [
      zona("dz_1", "El Poblado", 1000000),
      zona("dz_2", "Poblado II", 1000000),
      zona("dz_3", "Kachipay", 1200000),
    ];
    const r = resolverZonaDeEntrega(zonas, "poblado ll");
    expect(r.status).toBe("multiple_matches");
    if (r.status !== "multiple_matches") return;
    expect(r.zonas.map((z) => z.nombre).sort()).toEqual(["El Poblado", "Poblado II"]);
  });

  it("con tarifas DISTINTAS entre hermanas, tampoco adivina: pregunta", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [zona("dz_1", "El Prado", 800000), zona("dz_2", "Prado Norte", 1200000)];
    expect(resolverZonaDeEntrega(zonas, "prado alto").status).toBe("multiple_matches");
  });

  it("si algo de lo que coincidió SÍ distingue, resuelve normal (no pregunta de más)", async () => {
    const { resolverZonaDeEntrega } = await import("@/server/delivery/zonas");
    const zonas = [
      zona("dz_1", "Ciudad Jardín", 1000000),
      zona("dz_2", "Ciudad Meléndez", 1000000),
      zona("dz_3", "Cañasgordas", 1200000),
    ];
    // "jardin" distingue a esa zona de sus hermanas "Ciudad ...", aunque
    // "barrio" quede sin explicar.
    const r = resolverZonaDeEntrega(zonas, "barrio ciudad jardin");
    expect(r).toEqual({ status: "found", zona: zonas[0] });
    // Caso real: "cañas gorda" separado en dos palabras.
    expect(resolverZonaDeEntrega(zonas, "cañas gorda")).toEqual({
      status: "found",
      zona: zonas[2],
    });
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
