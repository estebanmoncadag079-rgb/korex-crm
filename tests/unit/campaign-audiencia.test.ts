import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10E/10F — segmentación de audiencia y estimación de costo. Los
 * cinco modos (`todos_los_contactos`/`pipeline_stage`/`selected_contacts`/
 * `fixed_count`/`budget`) siempre parten de `contactosElegiblesParaMarketing()`
 * (archivado y opt-out ya excluidos) — nunca reintroducen a alguien que esa
 * función ya excluyó.
 */

type Fila = Record<string, unknown>;

const contactosElegiblesParaMarketing = vi.fn();
vi.mock("@/server/contacts", () => ({
  contactosElegiblesParaMarketing: (...args: unknown[]) => contactosElegiblesParaMarketing(...args),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

const selectQueue: Fila[][] = [];
function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: Fila[]) => void) => resolve(rows);
  return chain;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => selectChain(selectQueue.shift() ?? []) }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const fetchMockGlobal = vi.fn(() => {
  throw new Error("PROHIBIDO: llamada HTTP real desde resolverAudiencia/estimarCampana");
});
vi.stubGlobal("fetch", fetchMockGlobal);

vi.mock("@/server/pricing/rates", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/pricing/rates")>();
  return original; // usamos la implementación real; solo mockeamos su acceso a DB vía @/lib/db de arriba, reusado
});

function contacto(id: string, overrides: Fila = {}): Fila {
  return { id, name: `Contacto ${id}`, phone: "573001112233", createdAt: new Date("2026-01-01"), ...overrides };
}

beforeEach(() => {
  contactosElegiblesParaMarketing.mockReset();
  selectQueue.length = 0;
});

describe("resolverAudiencia", () => {
  it("A: todos_los_contactos (default) — devuelve todos los elegibles", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([contacto("ct_1"), contacto("ct_2")]);
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "todos_los_contactos",
      audienceFilter: null,
    });
    expect(resultado.contactIds.sort()).toEqual(["ct_1", "ct_2"]);
  });

  it("B: pipeline_stage — solo contactos con lead en las etapas pedidas", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([contacto("ct_1"), contacto("ct_2"), contacto("ct_3")]);
    selectQueue.push([{ contactId: "ct_1" }, { contactId: "ct_3" }]); // leads en esas etapas
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "pipeline_stage",
      audienceFilter: { type: "pipeline_stage", stageIds: ["stg_perdidos"] },
    });
    expect(resultado.contactIds.sort()).toEqual(["ct_1", "ct_3"]);
  });

  it("B.2: pipeline_stage con stageIds vacío → audiencia vacía, sin tocar la base", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([contacto("ct_1")]);
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "pipeline_stage",
      audienceFilter: { type: "pipeline_stage", stageIds: [] },
    });
    expect(resultado.contactIds).toEqual([]);
  });

  it("C: selected_contacts — solo los IDs pedidos que SÍ son elegibles de ESTA organización (nunca confía en el frontend)", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([contacto("ct_1"), contacto("ct_2")]);
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    // ct_ajeno no aparece entre los elegibles de esta organización (cross-tenant o no elegible) — se descarta en silencio.
    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "selected_contacts",
      audienceFilter: { type: "selected_contacts", contactIds: ["ct_1", "ct_ajeno"] },
    });
    expect(resultado.contactIds).toEqual(["ct_1"]);
  });

  it("D: fixed_count — toma exactamente N, ordenados por más antiguo primero (oldest_first)", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([
      contacto("ct_nuevo", { createdAt: new Date("2026-06-01") }),
      contacto("ct_viejo", { createdAt: new Date("2026-01-01") }),
      contacto("ct_medio", { createdAt: new Date("2026-03-01") }),
    ]);
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "fixed_count",
      audienceFilter: { type: "fixed_count", limit: 2, selectionStrategy: "oldest_first" },
    });
    expect(resultado.contactIds).toEqual(["ct_viejo", "ct_medio"]);
  });

  it("D.2: fixed_count con más contactos elegibles que el límite pedido — nunca excede el límite", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([contacto("ct_1"), contacto("ct_2"), contacto("ct_3")]);
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "fixed_count",
      audienceFilter: { type: "fixed_count", limit: 1, selectionStrategy: "oldest_first" },
    });
    expect(resultado.contactIds).toHaveLength(1);
  });

  it("E: budget — acumula hasta no superar el presupuesto, deterministamente (oldest_first)", async () => {
    contactosElegiblesParaMarketing.mockResolvedValueOnce([
      contacto("ct_a", { createdAt: new Date("2026-01-01") }),
      contacto("ct_b", { createdAt: new Date("2026-01-02") }),
      contacto("ct_c", { createdAt: new Date("2026-01-03") }),
    ]);
    // Fase 10J: los tres comparten el mismo país real (CO, el default del
    // helper `contacto()`) — `resolverCostosPorLote` los agrupa y resuelve
    // la tarifa UNA sola vez para los tres (no una consulta por contacto).
    // Sin tarifa configurada (ni "CO" ni "default"), costo 0 para los tres.
    selectQueue.push([]); // buscar("CO")
    selectQueue.push([]); // buscar("default") — fallback de resolverTarifa
    const { resolverAudiencia } = await import("@/server/campaigns/audiencia");

    const resultado = await resolverAudiencia({
      organizationId: "org_1",
      audienceType: "budget",
      audienceFilter: { type: "budget", budgetUsd: 10 },
      category: "marketing",
      provider: "meta",
    });
    // Sin tarifa configurada, costo 0 por contacto → el presupuesto nunca se agota, entran todos.
    expect(resultado.contactIds.sort()).toEqual(["ct_a", "ct_b", "ct_c"]);
    expect(resultado.totalEstimadoUsd).toBe(0);
  });
});

describe("asignarPorPresupuesto (decimal exacto, sin arrastre de coma flotante)", () => {
  it("F: nunca supera el presupuesto por redondeo, incluso con muchos candidatos de costo fraccionario", async () => {
    const { asignarPorPresupuesto } = await import("@/server/pricing/rates");
    const candidatos = Array.from({ length: 1000 }, (_, i) => ({ contactId: `ct_${i}`, costUsd: 0.0033 }));
    const { incluidos, totalUsd } = asignarPorPresupuesto(candidatos, 1);
    expect(totalUsd).toBeLessThanOrEqual(1);
    expect(incluidos.length).toBe(Math.floor(1 / 0.0033));
  });

  it("G: presupuesto exacto para 3 candidatos de $0.30 con $0.90 — los tres entran, sin excluidos", () => {
    const candidatos = [
      { contactId: "a", costUsd: 0.3 },
      { contactId: "b", costUsd: 0.3 },
      { contactId: "c", costUsd: 0.3 },
    ];
    // require sync import at top already available via previous describe's dynamic import pattern
    return import("@/server/pricing/rates").then(({ asignarPorPresupuesto }) => {
      const { incluidos, excluidos, totalUsd } = asignarPorPresupuesto(candidatos, 0.9);
      expect(incluidos).toEqual(["a", "b", "c"]);
      expect(excluidos).toEqual([]);
      expect(totalUsd).toBeCloseTo(0.9, 10);
    });
  });

  it("H: presupuesto insuficiente para el último candidato — se excluye exactamente ese, no antes", () => {
    const candidatos = [
      { contactId: "a", costUsd: 0.5 },
      { contactId: "b", costUsd: 0.5 },
      { contactId: "c", costUsd: 0.5 },
    ];
    return import("@/server/pricing/rates").then(({ asignarPorPresupuesto }) => {
      const { incluidos, excluidos } = asignarPorPresupuesto(candidatos, 1);
      expect(incluidos).toEqual(["a", "b"]);
      expect(excluidos).toEqual(["c"]);
    });
  });
});

describe("resolverCostosPorLote (Fase 10J) — agrupa por país único, nunca resuelve país por contacto", () => {
  it("J: un contacto CO y un contacto US consumen exactamente una resolución de tarifa POR PAÍS, no por contacto", async () => {
    selectQueue.push([{ id: "prate_co", unitCostUsd: "0.0500000000", country: "CO", category: "marketing", provider: "meta" }]);
    selectQueue.push([{ id: "prate_us", unitCostUsd: "0.0100000000", country: "US", category: "marketing", provider: "meta" }]);
    const { resolverCostosPorLote } = await import("@/server/pricing/rates");

    const resultado = await resolverCostosPorLote(
      [{ phone: "573001112233" }, { phone: "15551234567" }],
      "marketing",
      "meta"
    );

    expect(resultado.costoDe("573001112233")).toBeCloseTo(0.05, 10);
    expect(resultado.costoDe("15551234567")).toBeCloseTo(0.01, 10);
    expect(resultado.ratesUsadas).toHaveLength(2);
    expect(selectQueue).toHaveLength(0); // ninguna consulta de más: una por país único, no una por contacto
  });

  it("K: país sin ninguna tarifa cargada (ni específica ni 'default') → costo 0, no aparece en ratesUsadas", async () => {
    selectQueue.push([]); // buscar("CO")
    selectQueue.push([]); // buscar("default")
    const { resolverCostosPorLote } = await import("@/server/pricing/rates");

    const resultado = await resolverCostosPorLote([{ phone: "573001112233" }], "marketing", "meta");

    expect(resultado.costoDe("573001112233")).toBe(0);
    expect(resultado.ratesUsadas).toEqual([]);
  });
});

describe("estimarCampana — Fase 10J: usa el país REAL de la audiencia seleccionada, nunca 'default' fijo", () => {
  it("L: solo hay tarifa cargada para 'CO' (sin fila 'default' redundante) — la estimación de una audiencia colombiana ya NO da $0 (el bug CRITICAL que motivó este fix)", async () => {
    const contactosCo = [contacto("ct_1"), contacto("ct_2")]; // ambos con phone CO (default del helper)
    contactosElegiblesParaMarketing.mockResolvedValue(contactosCo); // estimarCampana la llama 2 veces en paralelo
    selectQueue.push([{ id: "prate_co", unitCostUsd: "0.0500000000", country: "CO", category: "marketing", provider: "meta" }]);
    const { estimarCampana } = await import("@/server/campaigns/audiencia");

    const estimacion = await estimarCampana({
      organizationId: "org_1",
      audienceType: "todos_los_contactos",
      audienceFilter: null,
      category: "marketing",
      provider: "meta",
    });

    expect(estimacion.costoEstimadoUsd).toBeCloseTo(0.1, 10); // 2 contactos × $0.05
    expect(estimacion.ratesUsadas).toEqual([
      { pricingRateId: "prate_co", category: "marketing", country: "CO", unitCostUsd: "0.0500000000" },
    ]);
  });

  it("M: audiencia con contactos en dos países distintos — el desglose por país aparece completo en ratesUsadas (para congelar en rateSnapshot)", async () => {
    const mixta = [contacto("ct_co", { phone: "573001112233" }), contacto("ct_us", { phone: "15551234567" })];
    contactosElegiblesParaMarketing.mockResolvedValue(mixta);
    selectQueue.push([{ id: "prate_co", unitCostUsd: "0.0500000000", country: "CO", category: "marketing", provider: "meta" }]);
    selectQueue.push([{ id: "prate_us", unitCostUsd: "0.0100000000", country: "US", category: "marketing", provider: "meta" }]);
    const { estimarCampana } = await import("@/server/campaigns/audiencia");

    const estimacion = await estimarCampana({
      organizationId: "org_1",
      audienceType: "todos_los_contactos",
      audienceFilter: null,
      category: "marketing",
      provider: "meta",
    });

    expect(estimacion.costoEstimadoUsd).toBeCloseTo(0.06, 10); // 0.05 (CO) + 0.01 (US)
    expect(estimacion.ratesUsadas.map((r) => r.country).sort()).toEqual(["CO", "US"]);
  });
});

describe("paisDeTelefono", () => {
  it("I: reconoce Colombia (+57) y EE.UU. (+1) sin confundirlos con prefijos más largos", async () => {
    const { paisDeTelefono } = await import("@/server/pricing/rates");
    expect(paisDeTelefono("573001112233")).toBe("CO");
    expect(paisDeTelefono("15551234567")).toBe("US");
    expect(paisDeTelefono(null)).toBe("default");
    expect(paisDeTelefono("")).toBe("default");
  });
});
