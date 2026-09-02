import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8A: el EJECUTOR del primer envío controlado — precheck de solo
 * lectura (`precheckPrimerEnvioControlado`) y la ejecución en sí
 * (`ejecutarPrimerEnvioControlado`, que reutiliza `procesarUnEnvioControladoDeCampana`
 * de `prueba-controlada.ts` sin duplicarla). Mocks puros, sin Postgres real
 * — la garantía de concurrencia/persistencia real vive en
 * `tests/integration/campaign-worker.test.ts`.
 */

type Fila = Record<string, unknown>;

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

const selectQueue: Fila[][] = [];

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "for"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: Fila[]) => void) => resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => selectChain(selectQueue.shift() ?? []),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const procesarUnEnvioControladoDeCampanaMock = vi.fn();
vi.mock("@/server/campaigns/prueba-controlada", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/campaigns/prueba-controlada")>();
  return {
    ...original,
    procesarUnEnvioControladoDeCampana: (...args: unknown[]) => procesarUnEnvioControladoDeCampanaMock(...args),
  };
});

const campanaBase = {
  id: "cmp_1",
  organizationId: "org_1",
  status: "processing",
  templateId: "tpl_1",
  templateSnapshot: { name: "seguimiento", language: "es", category: "MARKETING", body: "Hola {{1}}" },
};
const plantillaAprobada = { status: "approved" };
const recipienteBase = { campaignId: "cmp_1", status: "pending", contactId: "ct_1" };
const contactoBase = {
  id: "ct_1",
  organizationId: "org_1",
  name: "María",
  phone: "573001112233",
  waUserId: null,
  marketingOptOut: false,
};
const jobBase = { id: "cmpj_1", campaignId: "cmp_1", status: "pendiente" };

const input = { organizationId: "org_1", campaignId: "cmp_1", recipientId: "cmpr_1" };

/** Encola las 7 filas del camino feliz completo (campaign→template→recipient→contact→job→conteo×2). */
function encolarCaminoFeliz(overrides?: {
  campana?: Partial<typeof campanaBase>;
  plantilla?: Partial<typeof plantillaAprobada>;
  recipiente?: Partial<typeof recipienteBase>;
  contacto?: Partial<typeof contactoBase>;
  job?: Partial<typeof jobBase>;
  recipients?: Fila[];
  jobs?: Fila[];
}) {
  selectQueue.push([{ ...campanaBase, ...overrides?.campana }]);
  selectQueue.push([{ ...plantillaAprobada, ...overrides?.plantilla }]);
  selectQueue.push([{ ...recipienteBase, ...overrides?.recipiente }]);
  selectQueue.push([{ ...contactoBase, ...overrides?.contacto }]);
  selectQueue.push([{ ...jobBase, ...overrides?.job }]);
  selectQueue.push(overrides?.recipients ?? [{ id: "cmpr_1" }]);
  selectQueue.push(overrides?.jobs ?? [{ id: "cmpj_1" }]);
}

beforeEach(() => {
  selectQueue.length = 0;
  procesarUnEnvioControladoDeCampanaMock.mockReset();
});

describe("precheckPrimerEnvioControlado", () => {
  it("S — camino feliz: 1 recipient + 1 job, todo válido", async () => {
    encolarCaminoFeliz();
    const { precheckPrimerEnvioControlado } = await import("@/server/campaigns/ejecutar-primer-envio");

    const precheck = await precheckPrimerEnvioControlado(input);
    expect(precheck).toMatchObject({
      campaignStatus: "processing",
      recipientStatus: "pending",
      jobStatus: "pendiente",
      totalRecipients: 1,
      totalJobs: 1,
      contactName: "María",
    });
    expect(precheck.telefonoEnmascarado).toBe("********2233");
  });

  it("B — campaign inexistente: aborta (not_found)", async () => {
    selectQueue.push([]); // campana no encontrada
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("not_found");
  });

  it("C — campaign de otra organización (scoped no la encuentra): aborta", async () => {
    selectQueue.push([]); // mismo efecto que B: scoped() con la org equivocada no encuentra nada
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    await expect(
      precheckPrimerEnvioControlado({ ...input, organizationId: "org_ajena" })
    ).rejects.toBeInstanceOf(EjecucionControladaError);
  });

  it("D — recipient inexistente: aborta (not_found)", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([]); // recipient no encontrado
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("not_found");
  });

  it("E — recipient de otra campaña: aborta (mismatch)", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([{ ...recipienteBase, campaignId: "cmp_OTRA" }]);
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("mismatch");
  });

  it("F — recipient de otra organización (scoped no lo encuentra): aborta", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([]); // mismo efecto que D
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    await expect(precheckPrimerEnvioControlado(input)).rejects.toBeInstanceOf(EjecucionControladaError);
  });

  it.each([
    ["G", "sent"],
    ["H", "skipped"],
    ["I", "indeterminado"],
    ["J", "failed"],
  ] as const)("%s — recipient status=%s: aborta (already_processed), nunca reintenta", async (_caso, status) => {
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([{ ...recipienteBase, status }]);
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("already_processed");
  });

  it("K — opt-out true: aborta (opt_out)", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([recipienteBase]);
    selectQueue.push([{ ...contactoBase, marketingOptOut: true }]);
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("opt_out");
  });

  it("L — template vivo no approved: aborta (invalid)", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([{ status: "pending" }]);
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("invalid");
  });

  it("M — snapshot inexistente: aborta (invalid), antes de leer el template vivo", async () => {
    selectQueue.push([{ ...campanaBase, templateSnapshot: null }]);
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("invalid");
  });

  it("N — 0 recipients en la campaña (conteo real): aborta (multiple_candidates), nunca elige LIMIT 1", async () => {
    encolarCaminoFeliz({ recipients: [] });
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("multiple_candidates");
  });

  it("O — 2 recipients en la campaña: aborta (multiple_candidates)", async () => {
    encolarCaminoFeliz({ recipients: [{ id: "cmpr_1" }, { id: "cmpr_2" }] });
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("multiple_candidates");
  });

  it("P — 0 jobs en la campaña: aborta (multiple_candidates)", async () => {
    encolarCaminoFeliz({ jobs: [] });
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("multiple_candidates");
  });

  it("Q — 2 jobs en la campaña: aborta (multiple_candidates)", async () => {
    encolarCaminoFeliz({ jobs: [{ id: "cmpj_1" }, { id: "cmpj_2" }] });
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("multiple_candidates");
  });

  it("R — el job encontrado no corresponde a esta campaña: aborta (mismatch)", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([recipienteBase]);
    selectQueue.push([contactoBase]);
    selectQueue.push([{ ...jobBase, campaignId: "cmp_OTRA" }]);
    const { precheckPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await precheckPrimerEnvioControlado(input).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("mismatch");
  });
});

describe("ejecutarPrimerEnvioControlado", () => {
  it("T — precheck (×2, inicial + barrera final) pasa, delega en procesarUnEnvioControladoDeCampana exactamente 1 vez", async () => {
    encolarCaminoFeliz(); // precheck inicial
    encolarCaminoFeliz(); // barrera final (Fase 8A, sección 13): revalida todo de nuevo, fresco
    procesarUnEnvioControladoDeCampanaMock.mockResolvedValue({ outcome: "enviado", messageId: "msg_1" });
    const proveedor = vi.fn();
    const { ejecutarPrimerEnvioControlado } = await import("@/server/campaigns/ejecutar-primer-envio");

    const ejecucion = await ejecutarPrimerEnvioControlado({ ...input, proveedor });
    expect(ejecucion.resultado).toEqual({ outcome: "enviado", messageId: "msg_1" });
    expect(procesarUnEnvioControladoDeCampanaMock).toHaveBeenCalledTimes(1);
    expect(procesarUnEnvioControladoDeCampanaMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", campaignId: "cmp_1", recipientId: "cmpr_1", proveedor })
    );
  });

  it("precheck falla en la primera pasada: NUNCA llega a procesarUnEnvioControladoDeCampana", async () => {
    selectQueue.push([]); // campana no encontrada
    const { ejecutarPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    await expect(ejecutarPrimerEnvioControlado({ ...input, proveedor: vi.fn() })).rejects.toBeInstanceOf(
      EjecucionControladaError
    );
    expect(procesarUnEnvioControladoDeCampanaMock).not.toHaveBeenCalled();
  });

  it("barrera final detecta un cambio entre el precheck inicial y la revalidación: aborta sin llamar al proveedor", async () => {
    encolarCaminoFeliz(); // precheck inicial: OK
    // Barrera final: el recipient cambió a "sent" entre medias (ej. otro proceso lo procesó).
    selectQueue.push([campanaBase]);
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([{ ...recipienteBase, status: "sent" }]);
    const { ejecutarPrimerEnvioControlado, EjecucionControladaError } = await import(
      "@/server/campaigns/ejecutar-primer-envio"
    );

    const err = await ejecutarPrimerEnvioControlado({ ...input, proveedor: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(EjecucionControladaError);
    expect(err.code).toBe("already_processed");
    expect(procesarUnEnvioControladoDeCampanaMock).not.toHaveBeenCalled();
  });
});

describe("parseArgs (scripts/ejecutar-primer-envio-controlado.ts) — caso A: IDs faltantes", () => {
  it("sin --organization/--campaign/--recipient: los campos quedan undefined", async () => {
    const { parseArgs } = await import("@/server/campaigns/ejecutar-primer-envio");
    const args = parseArgs([]);
    expect(args.organization).toBeUndefined();
    expect(args.campaign).toBeUndefined();
    expect(args.recipient).toBeUndefined();
    expect(args.ejecutar).toBe(false);
  });

  it("con los 3 IDs y sin --ejecutar: ejecutar queda false", async () => {
    const { parseArgs } = await import("@/server/campaigns/ejecutar-primer-envio");
    const args = parseArgs(["--organization", "org_1", "--campaign", "cmp_1", "--recipient", "cmpr_1"]);
    expect(args).toEqual({ organization: "org_1", campaign: "cmp_1", recipient: "cmpr_1", ejecutar: false });
  });

  it("con --ejecutar: se activa explícitamente", async () => {
    const { parseArgs } = await import("@/server/campaigns/ejecutar-primer-envio");
    const args = parseArgs([
      "--organization",
      "org_1",
      "--campaign",
      "cmp_1",
      "--recipient",
      "cmpr_1",
      "--ejecutar",
    ]);
    expect(args.ejecutar).toBe(true);
  });

  it.each(["--all", "--limit", "--batch", "--contacts", "--tag", "--confirmar"])(
    '"%s": argumento no reconocido, rechazado explícitamente (nunca ignorado en silencio)',
    async (flagProhibido) => {
      const { parseArgs } = await import("@/server/campaigns/ejecutar-primer-envio");
      expect(() => parseArgs([flagProhibido])).toThrow(/no reconocido/);
    }
  );
});
