import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10G/10I — capa API de `/api/campaigns`: exige sesión válida,
 * resuelve `organizationId` SIEMPRE de la sesión (nunca del body) para los
 * endpoints de cliente, exige superadmin para las acciones que gastan
 * dinero de la agencia (approve/reject/prepare/start/pause/resume/cancel),
 * y traduce los errores del dominio al status HTTP correcto. El dominio
 * (`motor.ts`/`consultas.ts`) ya está probado a fondo en
 * `campaign-motor.test.ts`/`campaign-aprobacion.test.ts` — aquí solo se
 * confirma el contrato de la capa API.
 */

class CampanaErrorMock extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CampanaError";
    this.code = code;
  }
}
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  invalid: 422,
  invalid_transition: 409,
};

const crearCampanaMock = vi.fn();
const prepararCampanaMock = vi.fn();
const solicitarAprobacionCampanaMock = vi.fn();
const aprobarCampanaMock = vi.fn();
const rechazarCampanaMock = vi.fn();
const iniciarCampanaMock = vi.fn();
const pausarCampanaMock = vi.fn();
const reanudarCampanaMock = vi.fn();
const cancelarCampanaMock = vi.fn();
const estimarCampanaActualMock = vi.fn();
vi.mock("@/server/campaigns/motor", () => ({
  CampanaError: CampanaErrorMock,
  campanaErrorStatus: (err: CampanaErrorMock) => STATUS_BY_CODE[err.code] ?? 500,
  crearCampana: (...args: unknown[]) => crearCampanaMock(...args),
  prepararCampana: (...args: unknown[]) => prepararCampanaMock(...args),
  solicitarAprobacionCampana: (...args: unknown[]) => solicitarAprobacionCampanaMock(...args),
  aprobarCampana: (...args: unknown[]) => aprobarCampanaMock(...args),
  rechazarCampana: (...args: unknown[]) => rechazarCampanaMock(...args),
  iniciarCampana: (...args: unknown[]) => iniciarCampanaMock(...args),
  pausarCampana: (...args: unknown[]) => pausarCampanaMock(...args),
  reanudarCampana: (...args: unknown[]) => reanudarCampanaMock(...args),
  cancelarCampana: (...args: unknown[]) => cancelarCampanaMock(...args),
  estimarCampanaActual: (...args: unknown[]) => estimarCampanaActualMock(...args),
}));

const listarCampanasMock = vi.fn();
const obtenerCampanaMock = vi.fn();
const editarBorradorDeCampanaMock = vi.fn();
const resumenRecipientsDeCampanaMock = vi.fn();
const serializeCampanaMock = vi.fn((c: unknown) => c);
vi.mock("@/server/campaigns/consultas", () => ({
  listarCampanas: (...args: unknown[]) => listarCampanasMock(...args),
  obtenerCampana: (...args: unknown[]) => obtenerCampanaMock(...args),
  editarBorradorDeCampana: (...args: unknown[]) => editarBorradorDeCampanaMock(...args),
  resumenRecipientsDeCampana: (...args: unknown[]) => resumenRecipientsDeCampanaMock(...args),
  serializeCampana: (c: unknown) => serializeCampanaMock(c),
}));

const selectQueueDb: unknown[][] = [];
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => selectChain(selectQueueDb.shift() ?? []) }),
  schema: new Proxy({}, { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: (...conds: unknown[]) => conds }));

type Sesion = { userId: string; organizationId: string; role: string; platformRole: "superadmin" | null; impersonating: boolean };
let sesionActual: Sesion | null = null;
class UnauthorizedErrorMock extends Error {}
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: UnauthorizedErrorMock,
  requireSession: async () => {
    if (!sesionActual) throw new UnauthorizedErrorMock();
    return sesionActual;
  },
}));

const SUPERADMIN: Sesion = { userId: "u_admin", organizationId: "org_agencia", role: "owner", platformRole: "superadmin", impersonating: false };
const CLIENTE: Sesion = { userId: "u_cliente", organizationId: "org_1", role: "member", platformRole: null, impersonating: false };

beforeEach(() => {
  for (const m of [
    crearCampanaMock, prepararCampanaMock, solicitarAprobacionCampanaMock, aprobarCampanaMock, rechazarCampanaMock,
    iniciarCampanaMock, pausarCampanaMock, reanudarCampanaMock, cancelarCampanaMock, estimarCampanaActualMock,
    listarCampanasMock, obtenerCampanaMock, editarBorradorDeCampanaMock, resumenRecipientsDeCampanaMock, serializeCampanaMock,
  ]) m.mockReset();
  serializeCampanaMock.mockImplementation((c: unknown) => c);
  selectQueueDb.length = 0;
  sesionActual = CLIENTE;
});

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET/POST /api/campaigns — siempre scoped a session.organizationId", () => {
  it("A: sin sesión → 401", async () => {
    sesionActual = null;
    const { GET } = await import("@/app/api/campaigns/route");
    const res = await GET(new Request("http://localhost/api/campaigns"));
    expect(res.status).toBe(401);
  });

  it("B: GET usa organizationId de la SESIÓN, no de query — un cliente nunca puede pedir campañas de otra organización", async () => {
    listarCampanasMock.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/campaigns/route");
    // Intenta colar organizationId=org_ajena por query string: se ignora.
    await GET(new Request("http://localhost/api/campaigns?organizationId=org_ajena"));
    expect(listarCampanasMock).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1" }));
  });

  it("C: POST crea campaña con organizationId de la sesión, createdBy=user:<id>", async () => {
    crearCampanaMock.mockResolvedValueOnce({ id: "cmp_1" });
    const { POST } = await import("@/app/api/campaigns/route");
    const res = await POST(jsonRequest("http://localhost/api/campaigns", { name: "Promo" }));
    expect(res.status).toBe(201);
    expect(crearCampanaMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", createdBy: "user:u_cliente" })
    );
  });

  it("D: POST con templateId de OTRA organización — rechaza ANTES de crear (scoped no lo encuentra)", async () => {
    selectQueueDb.push([]); // scoped no encuentra el template en esta organización
    const { POST } = await import("@/app/api/campaigns/route");
    const res = await POST(jsonRequest("http://localhost/api/campaigns", { name: "Promo", templateId: "tpl_ajeno" }));
    expect(res.status).toBe(422);
    expect(crearCampanaMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/campaigns/[id] — editar borrador", () => {
  it("E: edición normal — pasa organizationId de sesión, nunca el del cliente", async () => {
    editarBorradorDeCampanaMock.mockResolvedValueOnce({ id: "cmp_1", status: "draft" });
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const res = await PATCH(jsonRequest("http://localhost/api/campaigns/cmp_1", { name: "Nuevo nombre" }, "PATCH"), ctx("cmp_1"));
    expect(res.status).toBe(200);
    expect(editarBorradorDeCampanaMock).toHaveBeenCalledWith("org_1", "cmp_1", expect.objectContaining({ name: "Nuevo nombre" }));
  });

  it("F: campaña ya no está en draft (ej. completed) — 422, cero escritura", async () => {
    editarBorradorDeCampanaMock.mockRejectedValueOnce(new CampanaErrorMock("invalid", 'Solo se pueden editar campañas en "draft"'));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const res = await PATCH(jsonRequest("http://localhost/api/campaigns/cmp_1", { name: "x" }, "PATCH"), ctx("cmp_1"));
    expect(res.status).toBe(422);
  });

  it("G: cross-tenant — campaignId de otra organización → not_found (404), nunca revela que existe", async () => {
    editarBorradorDeCampanaMock.mockRejectedValueOnce(new CampanaErrorMock("not_found", "Campaña no encontrada"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const res = await PATCH(jsonRequest("http://localhost/api/campaigns/cmp_ajena", { name: "x" }, "PATCH"), ctx("cmp_ajena"));
    expect(res.status).toBe(404);
  });
});

describe("Acciones exclusivas de superadmin — el CLIENTE nunca puede aprobar ni ejecutar", () => {
  const endpoints: Array<{ path: string; mock: ReturnType<typeof vi.fn>; body?: Record<string, unknown> }> = [
    { path: "prepare", mock: prepararCampanaMock },
    { path: "approve", mock: aprobarCampanaMock },
    { path: "reject", mock: rechazarCampanaMock, body: { organizationId: "org_1", motivo: "x" } },
    { path: "start", mock: iniciarCampanaMock },
    { path: "pause", mock: pausarCampanaMock },
    { path: "resume", mock: reanudarCampanaMock },
    { path: "cancel", mock: cancelarCampanaMock },
  ];

  it.each(endpoints)("H: member (cliente) intenta POST /$path → 403, cero llamadas al dominio", async ({ path, mock }) => {
    sesionActual = CLIENTE;
    const { POST } = await import(`@/app/api/campaigns/[id]/${path}/route`);
    const res = await POST(
      jsonRequest(`http://localhost/api/campaigns/cmp_1/${path}`, { organizationId: "org_1" }),
      ctx("cmp_1")
    );
    expect(res.status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
  });

  it.each(endpoints)("I: sin sesión intenta POST /$path → 401", async ({ path, mock }) => {
    sesionActual = null;
    const { POST } = await import(`@/app/api/campaigns/[id]/${path}/route`);
    const res = await POST(
      jsonRequest(`http://localhost/api/campaigns/cmp_1/${path}`, { organizationId: "org_1" }),
      ctx("cmp_1")
    );
    expect(res.status).toBe(401);
    expect(mock).not.toHaveBeenCalled();
  });

  it("J: superadmin SÍ puede aprobar — 200, aprobarCampana llamado con el organizationId del body", async () => {
    sesionActual = SUPERADMIN;
    aprobarCampanaMock.mockResolvedValueOnce({ id: "cmp_1", status: "ready" });
    const { POST } = await import("@/app/api/campaigns/[id]/approve/route");
    const res = await POST(jsonRequest("http://localhost/api/campaigns/cmp_1/approve", { organizationId: "org_1" }), ctx("cmp_1"));
    expect(res.status).toBe(200);
    expect(aprobarCampanaMock).toHaveBeenCalledWith("org_1", "cmp_1", "user:u_admin");
  });

  it("K: superadmin intenta aprobar una campaña que NO está pending_approval → 409 (invalid_transition)", async () => {
    sesionActual = SUPERADMIN;
    aprobarCampanaMock.mockRejectedValueOnce(new CampanaErrorMock("invalid_transition", "solo aplica desde pending_approval"));
    const { POST } = await import("@/app/api/campaigns/[id]/approve/route");
    const res = await POST(jsonRequest("http://localhost/api/campaigns/cmp_1/approve", { organizationId: "org_1" }), ctx("cmp_1"));
    expect(res.status).toBe(409);
  });

  it("L: reject sin motivo (body inválido) → 422, cero llamada al dominio", async () => {
    sesionActual = SUPERADMIN;
    const { POST } = await import("@/app/api/campaigns/[id]/reject/route");
    const res = await POST(jsonRequest("http://localhost/api/campaigns/cmp_1/reject", { organizationId: "org_1" }), ctx("cmp_1"));
    expect(res.status).toBe(422);
    expect(rechazarCampanaMock).not.toHaveBeenCalled();
  });

  it("M: ejecutar (start) sin haber pasado por ready — el dominio rechaza (invalid_transition), la API lo traduce a 409", async () => {
    sesionActual = SUPERADMIN;
    iniciarCampanaMock.mockRejectedValueOnce(new CampanaErrorMock("invalid_transition", 'transición "draft" → "processing" no permitida'));
    const { POST } = await import("@/app/api/campaigns/[id]/start/route");
    const res = await POST(jsonRequest("http://localhost/api/campaigns/cmp_1/start", { organizationId: "org_1" }), ctx("cmp_1"));
    expect(res.status).toBe(409);
  });
});

describe("GET /api/campaigns/[id]/estimate — solo lectura, cliente puede verla", () => {
  it("N: cliente ve su propia estimación", async () => {
    estimarCampanaActualMock.mockResolvedValueOnce({ elegiblesTotal: 10, seleccionados: 10, costoEstimadoUsd: 0, moneda: "USD", categoria: "marketing", pricingRateId: null });
    const { GET } = await import("@/app/api/campaigns/[id]/estimate/route");
    const res = await GET(new Request("http://localhost/api/campaigns/cmp_1/estimate"), ctx("cmp_1"));
    expect(res.status).toBe(200);
    expect(estimarCampanaActualMock).toHaveBeenCalledWith("org_1", "cmp_1");
  });
});

describe("POST /api/campaigns/[id]/request-approval — el cliente pide, nunca ejecuta directo", () => {
  it("O: cliente solicita aprobación de su propia campaña", async () => {
    solicitarAprobacionCampanaMock.mockResolvedValueOnce({ id: "cmp_1", status: "pending_approval" });
    const { POST } = await import("@/app/api/campaigns/[id]/request-approval/route");
    const res = await POST(new Request("http://localhost/api/campaigns/cmp_1/request-approval", { method: "POST" }), ctx("cmp_1"));
    expect(res.status).toBe(200);
    expect(solicitarAprobacionCampanaMock).toHaveBeenCalledWith("org_1", "cmp_1", "user:u_cliente");
  });

  it("P: cliente intenta solicitar aprobación de una campaña de OTRA organización — el dominio (scoped) la trata como not_found", async () => {
    solicitarAprobacionCampanaMock.mockRejectedValueOnce(new CampanaErrorMock("not_found", "Campaña no encontrada"));
    const { POST } = await import("@/app/api/campaigns/[id]/request-approval/route");
    const res = await POST(new Request("http://localhost/api/campaigns/cmp_ajena/request-approval", { method: "POST" }), ctx("cmp_ajena"));
    expect(res.status).toBe(404);
  });
});
