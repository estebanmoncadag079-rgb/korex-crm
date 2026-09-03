import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 9M: tests de la capa API del panel admin de plantillas —
 * GET/POST `/api/admin/templates`, PATCH/submit/reconcile
 * `/api/admin/templates/[id]`.
 *
 * El dominio (`crearBorradorDePlantilla`/`enviarPlantillaAAprobacion`/
 * `reconciliarCreacionTemplateYCloud`/etc.) ya está exhaustivamente probado
 * en las Fases 9B-9I con Postgres real/mocks propios — aquí solo se
 * confirma que la capa API: exige superadmin, resuelve el provider
 * server-side (nunca del body), invoca al dominio con los argumentos
 * correctos, y traduce sus resultados/errores al Response HTTP correcto.
 */

class TemplateErrorMock extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  not_connected: 409,
  reconnect_required: 409,
  invalid: 422,
  not_found: 404,
  meta_error: 422,
  meta_unavailable: 503,
  not_implemented: 501,
  reconciliation_required: 409,
  local_write_failed: 500,
};

const crearBorradorDePlantillaMock = vi.fn();
const editarBorradorDePlantillaMock = vi.fn();
const enviarPlantillaAAprobacionMock = vi.fn();
const reconciliarCreacionTemplateYCloudMock = vi.fn();

vi.mock("@/server/whatsapp/templates", () => ({
  TemplateError: TemplateErrorMock,
  templateErrorStatus: (err: TemplateErrorMock) => STATUS_BY_CODE[err.code] ?? 500,
  serializeAdminTemplate: (t: Record<string, unknown>) => t,
  crearBorradorDePlantilla: (...args: unknown[]) => crearBorradorDePlantillaMock(...args),
  editarBorradorDePlantilla: (...args: unknown[]) => editarBorradorDePlantillaMock(...args),
  enviarPlantillaAAprobacion: (...args: unknown[]) => enviarPlantillaAAprobacionMock(...args),
  reconciliarCreacionTemplateYCloud: (...args: unknown[]) =>
    reconciliarCreacionTemplateYCloudMock(...args),
}));

type Sesion = {
  userId: string;
  organizationId: string;
  role: string;
  platformRole: "superadmin" | null;
  impersonating: boolean;
};

let sesionActual: Sesion | null = null;

class UnauthorizedErrorMock extends Error {}

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: UnauthorizedErrorMock,
  requireSession: async () => {
    if (!sesionActual) throw new UnauthorizedErrorMock();
    return sesionActual;
  },
}));

const findOrganizationMock = vi.fn();
vi.mock("@/server/admin/clients", () => ({
  findOrganization: (...args: unknown[]) => findOrganizationMock(...args),
}));

const listAdminTemplatesMock = vi.fn();
const resolverProviderDeOrganizacionMock = vi.fn();
vi.mock("@/server/admin/templates", () => ({
  listAdminTemplates: (...args: unknown[]) => listAdminTemplatesMock(...args),
  resolverProviderDeOrganizacion: (...args: unknown[]) => resolverProviderDeOrganizacionMock(...args),
}));

const SUPERADMIN: Sesion = {
  userId: "u_admin",
  organizationId: "org_agencia",
  role: "owner",
  platformRole: "superadmin",
  impersonating: false,
};
const MEMBER: Sesion = {
  userId: "u_member",
  organizationId: "org_1",
  role: "member",
  platformRole: null,
  impersonating: false,
};

beforeEach(() => {
  crearBorradorDePlantillaMock.mockReset();
  editarBorradorDePlantillaMock.mockReset();
  enviarPlantillaAAprobacionMock.mockReset();
  reconciliarCreacionTemplateYCloudMock.mockReset();
  findOrganizationMock.mockReset();
  listAdminTemplatesMock.mockReset();
  resolverProviderDeOrganizacionMock.mockReset();
  sesionActual = SUPERADMIN;
});

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET/POST /api/admin/templates", () => {
  it("A: usuario no superadmin (member) → 403", async () => {
    sesionActual = MEMBER;
    const { GET } = await import("@/app/api/admin/templates/route");
    const res = await GET(new Request("http://localhost/api/admin/templates"));
    expect(res.status).toBe(403);
  });

  it("B: superadmin GET → listado, filtros traducidos correctamente", async () => {
    listAdminTemplatesMock.mockResolvedValueOnce([{ id: "t1", name: "confirmacion" }]);
    const { GET } = await import("@/app/api/admin/templates/route");
    const res = await GET(
      new Request("http://localhost/api/admin/templates?organizationId=org_1&status=draft&provider=ycloud&q=conf")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { templates: unknown[] };
    expect(data.templates).toHaveLength(1);
    expect(listAdminTemplatesMock).toHaveBeenCalledWith({
      organizationId: "org_1",
      status: "draft",
      provider: "ycloud",
      q: "conf",
    });
  });

  it("C: superadmin crea draft — provider resuelto server-side, nunca del body", async () => {
    findOrganizationMock.mockResolvedValueOnce({ id: "org_1", name: "Org" });
    resolverProviderDeOrganizacionMock.mockResolvedValueOnce("ycloud");
    crearBorradorDePlantillaMock.mockResolvedValueOnce({ id: "t1", status: "draft", organizationId: "org_1" });
    const { POST } = await import("@/app/api/admin/templates/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates", {
        organizationId: "org_1",
        name: "confirmacion",
        language: "es",
        category: "UTILITY",
        body: "Hola",
        // aunque alguien mande provider en el body, no debe usarse:
        provider: "graph",
      })
    );
    expect(res.status).toBe(201);
    expect(crearBorradorDePlantillaMock).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ provider: "ycloud" })
    );
  });

  it("D: member intenta crear → 403, cero llamadas al dominio", async () => {
    sesionActual = MEMBER;
    const { POST } = await import("@/app/api/admin/templates/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates", {
        organizationId: "org_1",
        name: "x",
        language: "es",
        category: "UTILITY",
        body: "hola",
      })
    );
    expect(res.status).toBe(403);
    expect(crearBorradorDePlantillaMock).not.toHaveBeenCalled();
  });

  it("organización sin proveedor soportado → 409, cero llamadas a crearBorradorDePlantilla", async () => {
    findOrganizationMock.mockResolvedValueOnce({ id: "org_1", name: "Org" });
    resolverProviderDeOrganizacionMock.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/admin/templates/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates", {
        organizationId: "org_1",
        name: "x",
        language: "es",
        category: "UTILITY",
        body: "hola",
      })
    );
    expect(res.status).toBe(409);
    expect(crearBorradorDePlantillaMock).not.toHaveBeenCalled();
  });

  it("F: duplicate → error propagado con el status correcto (422)", async () => {
    findOrganizationMock.mockResolvedValueOnce({ id: "org_1", name: "Org" });
    resolverProviderDeOrganizacionMock.mockResolvedValueOnce("ycloud");
    crearBorradorDePlantillaMock.mockRejectedValueOnce(
      new TemplateErrorMock("invalid", 'Ya existe una plantilla "dup" en el idioma "es"')
    );
    const { POST } = await import("@/app/api/admin/templates/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates", {
        organizationId: "org_1",
        name: "dup",
        language: "es",
        category: "UTILITY",
        body: "hola",
      })
    );
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error: { message: string } };
    expect(data.error.message).toMatch(/Ya existe/);
  });

  it("G: variable inválida → error propagado con el status correcto (422)", async () => {
    findOrganizationMock.mockResolvedValueOnce({ id: "org_1", name: "Org" });
    resolverProviderDeOrganizacionMock.mockResolvedValueOnce("ycloud");
    crearBorradorDePlantillaMock.mockRejectedValueOnce(
      new TemplateErrorMock("invalid", "v1 admite una sola variable {{1}} en el cuerpo")
    );
    const { POST } = await import("@/app/api/admin/templates/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates", {
        organizationId: "org_1",
        name: "x",
        language: "es",
        category: "UTILITY",
        body: "Hola {{1}} {{2}}",
      })
    );
    expect(res.status).toBe(422);
  });

  it("K: approved → visible en el listado tal cual", async () => {
    listAdminTemplatesMock.mockResolvedValueOnce([
      { id: "t1", status: "approved", providerStatus: "APPROVED", waTemplateId: "tpl_1" },
    ]);
    const { GET } = await import("@/app/api/admin/templates/route");
    const res = await GET(new Request("http://localhost/api/admin/templates?status=approved"));
    const data = (await res.json()) as { templates: Array<{ status: string }> };
    expect(data.templates[0]!.status).toBe("approved");
  });

  it("L: rejected → motivo visible en el listado", async () => {
    listAdminTemplatesMock.mockResolvedValueOnce([
      { id: "t1", status: "rejected", rejectionReason: "Contenido promocional sin opt-in" },
    ]);
    const { GET } = await import("@/app/api/admin/templates/route");
    const res = await GET(new Request("http://localhost/api/admin/templates?status=rejected"));
    const data = (await res.json()) as { templates: Array<{ rejectionReason: string }> };
    expect(data.templates[0]!.rejectionReason).toBe("Contenido promocional sin opt-in");
  });
});

describe("PATCH /api/admin/templates/[id]", () => {
  it("E: cross-tenant — organizationId equivocado bloqueado por el dominio (not_found)", async () => {
    editarBorradorDePlantillaMock.mockRejectedValueOnce(
      new TemplateErrorMock("not_found", "Plantilla no encontrada en esta organización")
    );
    const { PATCH } = await import("@/app/api/admin/templates/[id]/route");
    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/templates/t1", { organizationId: "org_ajena", name: "x" }, "PATCH"),
      ctx("t1")
    );
    expect(res.status).toBe(404);
    expect(editarBorradorDePlantillaMock).toHaveBeenCalledWith("org_ajena", "t1", expect.anything());
  });

  it("member intenta editar → 403", async () => {
    sesionActual = MEMBER;
    const { PATCH } = await import("@/app/api/admin/templates/[id]/route");
    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/templates/t1", { organizationId: "org_1", name: "x" }, "PATCH"),
      ctx("t1")
    );
    expect(res.status).toBe(403);
    expect(editarBorradorDePlantillaMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/templates/[id]/submit", () => {
  it("H: draft → submit exitoso, devuelve la fila actualizada", async () => {
    enviarPlantillaAAprobacionMock.mockResolvedValueOnce({
      id: "t1",
      status: "pending",
      providerStatus: "PENDING",
    });
    const { POST } = await import("@/app/api/admin/templates/[id]/submit/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/submit", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(200);
    expect(enviarPlantillaAAprobacionMock).toHaveBeenCalledWith(
      "org_1",
      "t1",
      expect.objectContaining({})
    );
  });

  it("I: submit con provider=graph → not_implemented (501)", async () => {
    enviarPlantillaAAprobacionMock.mockRejectedValueOnce(
      new TemplateErrorMock("not_implemented", "Envío a aprobación vía Graph directo todavía no implementado")
    );
    const { POST } = await import("@/app/api/admin/templates/[id]/submit/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/submit", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(501);
  });

  it("J: submit devuelve AMBIGUOUS (meta_unavailable) → 503, nunca 200", async () => {
    enviarPlantillaAAprobacionMock.mockRejectedValueOnce(
      new TemplateErrorMock("meta_unavailable", "YCloud no confirmó el resultado de la creación")
    );
    const { POST } = await import("@/app/api/admin/templates/[id]/submit/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/submit", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
  });

  it("J.2: segundo submit sobre un envío ambiguo previo → reconciliation_required (409)", async () => {
    enviarPlantillaAAprobacionMock.mockRejectedValueOnce(
      new TemplateErrorMock("reconciliation_required", "Ya existe un envío anterior sin confirmar")
    );
    const { POST } = await import("@/app/api/admin/templates/[id]/submit/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/submit", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(409);
  });

  it("member intenta enviar a aprobación → 403", async () => {
    sesionActual = MEMBER;
    const { POST } = await import("@/app/api/admin/templates/[id]/submit/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/submit", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(403);
    expect(enviarPlantillaAAprobacionMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/templates/[id]/reconcile", () => {
  it("reconcile confirma y devuelve el template actualizado", async () => {
    reconciliarCreacionTemplateYCloudMock.mockResolvedValueOnce({
      status: "confirmado",
      template: { id: "t1", status: "approved" },
    });
    const { POST } = await import("@/app/api/admin/templates/[id]/reconcile/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/reconcile", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { reconciliation: string };
    expect(data.reconciliation).toBe("confirmado");
  });

  it("member intenta reconciliar → 403", async () => {
    sesionActual = MEMBER;
    const { POST } = await import("@/app/api/admin/templates/[id]/reconcile/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/templates/t1/reconcile", { organizationId: "org_1" }),
      ctx("t1")
    );
    expect(res.status).toBe(403);
    expect(reconciliarCreacionTemplateYCloudMock).not.toHaveBeenCalled();
  });
});
