import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10I — flujo de aprobación cliente→superadmin:
 * draft → pending_approval → ready | rejected, con snapshot de plantilla Y
 * estimación de costo congelados en el momento de SOLICITAR (no al
 * aprobar), y toda acción auditada vía `conRegistro`.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

const contactosElegiblesParaMarketing = vi.fn();
vi.mock("@/server/contacts", () => ({
  contactosElegiblesParaMarketing: (...args: unknown[]) => contactosElegiblesParaMarketing(...args),
}));

const proveedorRealDeOrganizacion = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  proveedorRealDeOrganizacion: (...args: unknown[]) => proveedorRealDeOrganizacion(...args),
}));

const selectQueue: Fila[][] = [];
const updateSetSpy = vi.fn();

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: Fila[]) => void) => resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetSpy(values);
        return { where: () => ({ returning: () => Promise.resolve([{ ...values }]) }) };
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
  updateSetSpy.mockReset();
  contactosElegiblesParaMarketing.mockReset().mockResolvedValue([]);
  proveedorRealDeOrganizacion.mockReset().mockResolvedValue("graph");
});

const campanaDraft = { id: "cmp_1", organizationId: "org_1", status: "draft", templateId: "tpl_1" };
const plantillaAprobada = {
  id: "tpl_1",
  name: "promo",
  language: "es",
  category: "MARKETING",
  body: "Hola {{1}}",
  status: "approved",
  components: null,
};

describe("solicitarAprobacionCampana: draft → pending_approval", () => {
  it("A: campaña válida — congela snapshot + estimación, transiciona, registra requestedBy/requestedAt", async () => {
    selectQueue.push([campanaDraft]); // leerCampana (validarCampana)
    selectQueue.push([plantillaAprobada]); // template (validarCampana)
    selectQueue.push([campanaDraft]); // leerCampana (congelarTemplateSnapshot)
    selectQueue.push([plantillaAprobada]); // template (congelarTemplateSnapshot)
    selectQueue.push([campanaDraft]); // leerCampana (estimarCampanaActual)
    selectQueue.push([{ category: "MARKETING" }]); // template.category (estimarCampanaActual)
    // Sin contactos elegibles (mock por defecto []), la audiencia seleccionada
    // queda vacía → resolverCostosPorLote no resuelve ningún país (Fase 10J:
    // ya no consulta pricing_rate para una audiencia vacía).
    selectQueue.push([campanaDraft]); // conRegistro leerFila (antes)
    selectQueue.push([{ ...campanaDraft, status: "draft" }]); // leerCampana dentro de transicionar
    selectQueue.push([{ ...campanaDraft, status: "pending_approval" }]); // conRegistro leerFila (después)
    const { solicitarAprobacionCampana } = await import("@/server/campaigns/motor");

    const resultado = await solicitarAprobacionCampana("org_1", "cmp_1", "user:esteban");
    expect(resultado.status).toBe("pending_approval");
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending_approval", requestedBy: "user:esteban" })
    );
  });

  it("B: campaña sin plantilla asignada — rechaza antes de congelar nada", async () => {
    selectQueue.push([{ ...campanaDraft, templateId: null }]);
    const { solicitarAprobacionCampana, CampanaError } = await import("@/server/campaigns/motor");

    const err = await solicitarAprobacionCampana("org_1", "cmp_1", "user:esteban").catch((e) => e);
    expect(err).toBeInstanceOf(CampanaError);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});

describe("aprobarCampana: pending_approval → ready", () => {
  it("C: transiciona y registra approvedBy/approvedAt", async () => {
    selectQueue.push([{ ...campanaDraft, status: "pending_approval" }]); // leerCampana (guard propio)
    selectQueue.push([{ ...campanaDraft, status: "pending_approval" }]); // conRegistro leerFila (antes)
    selectQueue.push([{ ...campanaDraft, status: "pending_approval" }]); // leerCampana dentro de transicionar
    selectQueue.push([{ ...campanaDraft, status: "ready" }]); // conRegistro leerFila (después)
    const { aprobarCampana } = await import("@/server/campaigns/motor");

    const resultado = await aprobarCampana("org_1", "cmp_1", "user:superadmin");
    expect(resultado.status).toBe("ready");
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", approvedBy: "user:superadmin" })
    );
  });

  it("D: NUNCA aplica fuera de pending_approval (ej. draft) — rechaza de entrada, cero UPDATE, aunque draft→ready sea válido para prepararCampana()", async () => {
    selectQueue.push([{ ...campanaDraft, status: "draft" }]); // leerCampana (guard propio)
    const { aprobarCampana, CampanaError } = await import("@/server/campaigns/motor");

    const err = await aprobarCampana("org_1", "cmp_1", "user:superadmin").catch((e) => e);
    expect(err).toBeInstanceOf(CampanaError);
    expect(err.code).toBe("invalid_transition");
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});

describe("rechazarCampana: pending_approval → rejected", () => {
  it("E: con motivo — transiciona y guarda rejectionReason", async () => {
    selectQueue.push([{ ...campanaDraft, status: "pending_approval" }]);
    selectQueue.push([{ ...campanaDraft, status: "pending_approval" }]);
    selectQueue.push([{ ...campanaDraft, status: "rejected" }]);
    const { rechazarCampana } = await import("@/server/campaigns/motor");

    const resultado = await rechazarCampana("org_1", "cmp_1", "user:superadmin", "Contenido promocional sin opt-in claro");
    expect(resultado.status).toBe("rejected");
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", rejectionReason: "Contenido promocional sin opt-in claro" })
    );
  });

  it("F: motivo vacío — rechaza SIN tocar la base (ni siquiera intenta transicionar)", async () => {
    const { rechazarCampana, CampanaError } = await import("@/server/campaigns/motor");

    const err = await rechazarCampana("org_1", "cmp_1", "user:superadmin", "   ").catch((e) => e);
    expect(err).toBeInstanceOf(CampanaError);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});

describe("reabrirCampanaRechazada: rejected → draft", () => {
  it("G: transiciona de vuelta a draft para poder reintentar", async () => {
    selectQueue.push([{ ...campanaDraft, status: "rejected" }]); // leerCampana dentro de transicionar
    const { reabrirCampanaRechazada } = await import("@/server/campaigns/motor");

    const resultado = await reabrirCampanaRechazada("org_1", "cmp_1");
    expect(resultado.status).toBe("draft");
  });
});

describe("estimarCampanaActual: cuenta + costo, sin transicionar ni escribir nada", () => {
  it("H: todos_los_contactos, sin tarifa cargada (ni para el país real ni 'default') → costo 0, ratesUsadas vacío, cero UPDATE", async () => {
    selectQueue.push([campanaDraft]); // leerCampana
    selectQueue.push([{ category: "MARKETING" }]); // template.category
    // Ambos contactos sin teléfono → mismo país único ("default") → una sola
    // llamada a `resolverTarifa({country:"default"})`, que internamente
    // prueba `buscar("default")` y, al no encontrar nada, cae otra vez en
    // `buscar("default")` (el mismo país) — dos SELECT idénticos.
    selectQueue.push([]); // pricing_rate buscar("default") — primer intento
    selectQueue.push([]); // pricing_rate buscar("default") — fallback (mismo país, resolverTarifa siempre reintenta con "default")
    // mockResolvedValue (no "Once"): estimarCampana() llama contactosElegiblesParaMarketing
    // dos veces en paralelo (Promise.all de elegiblesOrdenadosPorAntiguedad + resolverAudiencia).
    contactosElegiblesParaMarketing.mockResolvedValue([
      { id: "ct_1", createdAt: new Date(), phone: null },
      { id: "ct_2", createdAt: new Date(), phone: null },
    ]);
    const { estimarCampanaActual } = await import("@/server/campaigns/motor");

    const estimacion = await estimarCampanaActual("org_1", "cmp_1");
    expect(estimacion).toEqual({
      elegiblesTotal: 2,
      seleccionados: 2,
      costoEstimadoUsd: 0,
      moneda: "USD",
      categoria: "marketing",
      ratesUsadas: [],
    });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});
