import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6A: `motor.ts` — crear/validar/preparar/iniciar/pausar/cancelar
 * campaña, congelar el snapshot de plantilla, materializar la audiencia y
 * encolar los envíos. Nada de esto llama a un proveedor de WhatsApp.
 */

type Fila = Record<string, unknown>;

const contactosElegiblesParaMarketing = vi.fn();
vi.mock("@/server/contacts", () => ({
  contactosElegiblesParaMarketing: (...args: unknown[]) =>
    contactosElegiblesParaMarketing(...args),
}));

// Fase 10J: `congelarEstimacion` (ahora parte de `prepararCampana`) resuelve
// el proveedor real vía credenciales — sin mockear esto, tocaría cifrado/env
// real. Mismo mock que `campaign-aprobacion.test.ts`.
const proveedorRealDeOrganizacion = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  proveedorRealDeOrganizacion: (...args: unknown[]) => proveedorRealDeOrganizacion(...args),
}));

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...conds: unknown[]) => conds,
}));

let contadorId = 0;
vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_fake${++contadorId}`,
}));

const selectQueue: Fila[][] = [];
const insertReturningQueue: Fila[][] = [];
const updateReturningQueue: Fila[][] = [];

function selectChain(rows: Fila[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "for"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  // Sin `.limit()` (materializarAudiencia no lo usa sobre este mock, pero
  // encolarEnviosDeCampana sí espera el resultado directo del `where`).
  chain.then = (resolve: (v: Fila[]) => void) => resolve(rows);
  return chain;
}

/** `db`/`tx` comparten la misma forma (Fase 6C: `intentarCompletarCampana` corre en transacción). */
function fabricarDbODeTx() {
  return {
    select: () => selectChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(insertReturningQueue.shift() ?? []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateReturningQueue.shift() ?? [{}]),
          then: (resolve: (v: Fila[]) => void) =>
            resolve(updateReturningQueue.shift() ?? [{}]),
        }),
      }),
    }),
  };
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    ...fabricarDbODeTx(),
    transaction: async (cb: (tx: ReturnType<typeof fabricarDbODeTx>) => unknown) =>
      cb(fabricarDbODeTx()),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const campanaBase = {
  id: "cmp_1",
  organizationId: "org_1",
  name: "Campaña de prueba",
  status: "draft",
  templateId: "tpl_1",
  templateSnapshot: null,
};
const plantillaAprobada = {
  id: "tpl_1",
  organizationId: "org_1",
  name: "seguimiento",
  language: "es",
  category: "MARKETING",
  body: "Hola {{1}}",
  status: "approved",
};

beforeEach(() => {
  selectQueue.length = 0;
  insertReturningQueue.length = 0;
  updateReturningQueue.length = 0;
  // Fase 10J: `congelarEstimacion` (ahora parte de `prepararCampana`) llama
  // a `estimarCampana`, que necesita una audiencia resuelta — sin default
  // aquí, cualquier test que no la sobreescriba explícitamente recibiría
  // `undefined` y `elegiblesOrdenadosPorAntiguedad` fallaría al iterarla.
  contactosElegiblesParaMarketing.mockReset().mockResolvedValue([]);
  proveedorRealDeOrganizacion.mockReset().mockResolvedValue("graph");
});

describe("congelarTemplateSnapshot / prepararCampana", () => {
  it("plantilla aprobada: congela name/language/category/body", async () => {
    selectQueue.push([campanaBase]); // leerCampana (validarCampana)
    selectQueue.push([plantillaAprobada]); // leerCampana → template (validarCampana)
    selectQueue.push([campanaBase]); // leerCampana (congelarTemplateSnapshot)
    selectQueue.push([plantillaAprobada]); // template (congelarTemplateSnapshot)
    // Fase 10J: `prepararCampana` también congela la estimación financiera
    // (`congelarEstimacion` → `estimarCampanaActual`). Sin contactos elegibles
    // (default del mock, ver beforeEach), la audiencia queda vacía y
    // `resolverCostosPorLote` no consulta ninguna tarifa.
    selectQueue.push([campanaBase]); // leerCampana (estimarCampanaActual)
    selectQueue.push([{ category: "MARKETING" }]); // template.category (estimarCampanaActual)
    selectQueue.push([{ ...campanaBase, status: "draft" }]); // leerCampana (transicionar)
    updateReturningQueue.push([{}]); // update snapshot
    updateReturningQueue.push([{}]); // update estimación (congelarEstimacion)
    updateReturningQueue.push([{ ...campanaBase, status: "ready" }]); // update transición

    const { prepararCampana } = await import("@/server/campaigns/motor");
    const resultado = await prepararCampana("org_1", "cmp_1");
    expect(resultado.status).toBe("ready");
  });

  it("plantilla NO aprobada: rechaza antes de transicionar", async () => {
    selectQueue.push([campanaBase]);
    selectQueue.push([{ ...plantillaAprobada, status: "pending" }]);

    const { prepararCampana, CampanaError } = await import("@/server/campaigns/motor");
    await expect(prepararCampana("org_1", "cmp_1")).rejects.toBeInstanceOf(CampanaError);
  });

  it("transición inválida (ready → ready) nunca vuelve a tocar el snapshot", async () => {
    selectQueue.push([{ ...campanaBase, status: "ready" }]); // validarCampana
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([{ ...campanaBase, status: "ready" }]); // leerCampana en congelarTemplateSnapshot
    selectQueue.push([plantillaAprobada]);
    selectQueue.push([{ ...campanaBase, status: "ready" }]); // leerCampana (estimarCampanaActual)
    selectQueue.push([{ category: "MARKETING" }]); // template.category (estimarCampanaActual)
    selectQueue.push([{ ...campanaBase, status: "ready" }]); // transicionar: ya está en ready
    updateReturningQueue.push([{}]); // update snapshot
    updateReturningQueue.push([{}]); // update estimación (congelarEstimacion)

    const { prepararCampana, CampanaError } = await import("@/server/campaigns/motor");
    await expect(prepararCampana("org_1", "cmp_1")).rejects.toBeInstanceOf(CampanaError);
  });
});

describe("materializarAudienciaDeCampana: solo contactos elegibles", () => {
  it("crea un recipient por cada contacto elegible", async () => {
    selectQueue.push([campanaBase]); // leerCampana
    contactosElegiblesParaMarketing.mockResolvedValue([
      { id: "ct_1" },
      { id: "ct_2" },
    ]);
    insertReturningQueue.push([{ id: "cmpr_a" }, { id: "cmpr_b" }]);

    const { materializarAudienciaDeCampana } = await import("@/server/campaigns/motor");
    const resultado = await materializarAudienciaDeCampana("org_1", "cmp_1");
    expect(resultado.creados).toBe(2);
    // La función de elegibilidad usada es EXACTAMENTE la existente — nunca
    // se reconstruye el filtro de opt-out/archivado aquí.
    expect(contactosElegiblesParaMarketing).toHaveBeenCalledWith("org_1");
  });

  it("sin contactos elegibles: no llama a insert, 0 creados", async () => {
    selectQueue.push([campanaBase]);
    contactosElegiblesParaMarketing.mockResolvedValue([]);

    const { materializarAudienciaDeCampana } = await import("@/server/campaigns/motor");
    const resultado = await materializarAudienciaDeCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ creados: 0 });
  });

  it("re-ejecutar no duplica: onConflictDoNothing puede devolver menos filas de las pedidas", async () => {
    selectQueue.push([campanaBase]);
    contactosElegiblesParaMarketing.mockResolvedValue([{ id: "ct_1" }, { id: "ct_2" }]);
    // Los dos ya existían: el UNIQUE(campaignId, contactId) real los descarta.
    insertReturningQueue.push([]);

    const { materializarAudienciaDeCampana } = await import("@/server/campaigns/motor");
    const resultado = await materializarAudienciaDeCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ creados: 0 });
  });
});

describe("encolarEnviosDeCampana: un job por recipient pendiente sin job", () => {
  it("crea un job por cada recipient pendiente sin job todavía", async () => {
    selectQueue.push([{ id: "cmpr_1" }, { id: "cmpr_2" }]); // LEFT JOIN … IS NULL
    insertReturningQueue.push([{ id: "cmpj_a" }, { id: "cmpj_b" }]);

    const { encolarEnviosDeCampana } = await import("@/server/campaigns/motor");
    const resultado = await encolarEnviosDeCampana("org_1", "cmp_1");
    expect(resultado.creados).toBe(2);
  });

  it("ejecución repetida no duplica: sin recipients pendientes sin job, 0 creados", async () => {
    selectQueue.push([]); // el LEFT JOIN ya no encuentra ninguno sin job

    const { encolarEnviosDeCampana } = await import("@/server/campaigns/motor");
    const resultado = await encolarEnviosDeCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ creados: 0 });
  });
});

/* ============================================================
 * Fase 6C: reanudarCampana() / intentarCompletarCampana()
 * ============================================================ */

describe("reanudarCampana: SOLO paused → processing", () => {
  it("paused → processing: reanuda", async () => {
    selectQueue.push([{ ...campanaBase, status: "paused" }]); // leerCampana
    selectQueue.push([{ ...campanaBase, status: "paused" }]); // leerCampana (transicionar)
    updateReturningQueue.push([{ ...campanaBase, status: "processing" }]);

    const { reanudarCampana } = await import("@/server/campaigns/motor");
    const resultado = await reanudarCampana("org_1", "cmp_1");
    expect(resultado.status).toBe("processing");
  });

  it.each(["draft", "ready", "scheduled", "completed", "failed", "cancelled"] as const)(
    "%s → processing: rechazado, reanudarCampana() solo aplica desde paused",
    async (estado) => {
      selectQueue.push([{ ...campanaBase, status: estado }]); // leerCampana

      const { reanudarCampana, CampanaError } = await import("@/server/campaigns/motor");
      await expect(reanudarCampana("org_1", "cmp_1")).rejects.toBeInstanceOf(CampanaError);
    }
  );
});

describe("intentarCompletarCampana: automática, solo cuando NO queda trabajo activo", () => {
  it("processing sin recipients ni jobs activos: completa", async () => {
    selectQueue.push([{ ...campanaBase, status: "processing" }]); // campaign FOR UPDATE
    selectQueue.push([]); // recipients pending/sending
    selectQueue.push([]); // jobs pendiente/corriendo
    updateReturningQueue.push([{}]);

    const { intentarCompletarCampana } = await import("@/server/campaigns/motor");
    const resultado = await intentarCompletarCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ completada: true });
  });

  it("queda un recipient pending: NO completa", async () => {
    selectQueue.push([{ ...campanaBase, status: "processing" }]);
    selectQueue.push([{ id: "cmpr_activo" }]); // sigue habiendo un pending/sending

    const { intentarCompletarCampana } = await import("@/server/campaigns/motor");
    const resultado = await intentarCompletarCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ completada: false });
  });

  it("sin recipients activos pero un job corriendo: NO completa", async () => {
    selectQueue.push([{ ...campanaBase, status: "processing" }]);
    selectQueue.push([]); // recipients: ninguno activo
    selectQueue.push([{ id: "cmpj_activo" }]); // pero un job sigue activo

    const { intentarCompletarCampana } = await import("@/server/campaigns/motor");
    const resultado = await intentarCompletarCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ completada: false });
  });

  it("campaña ya no está processing (paused/cancelled/completed): no-op, no lanza", async () => {
    selectQueue.push([{ ...campanaBase, status: "paused" }]);

    const { intentarCompletarCampana } = await import("@/server/campaigns/motor");
    const resultado = await intentarCompletarCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ completada: false });
  });

  it("idempotente: llamarla dos veces sobre una ya completada no lanza ni repite el update", async () => {
    selectQueue.push([{ ...campanaBase, status: "completed" }]); // ya la completó otra llamada

    const { intentarCompletarCampana } = await import("@/server/campaigns/motor");
    const resultado = await intentarCompletarCampana("org_1", "cmp_1");
    expect(resultado).toEqual({ completada: false });
  });

  it("campaña no encontrada: lanza CampanaError", async () => {
    selectQueue.push([]); // FOR UPDATE no encuentra nada

    const { intentarCompletarCampana, CampanaError } = await import("@/server/campaigns/motor");
    await expect(intentarCompletarCampana("org_1", "cmp_inexistente")).rejects.toBeInstanceOf(
      CampanaError
    );
  });
});
