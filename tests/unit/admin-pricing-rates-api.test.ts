import { beforeEach, describe, expect, it, vi } from "vitest";

/** Fase 10C — `/api/admin/pricing-rates`: solo superadmin puede cargar/ver tarifas (afectan a TODAS las organizaciones). */

const crearTarifaMock = vi.fn();
const listarTarifasMock = vi.fn();
vi.mock("@/server/pricing/rates", () => ({
  crearTarifa: (...args: unknown[]) => crearTarifaMock(...args),
  listarTarifas: (...args: unknown[]) => listarTarifasMock(...args),
}));

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
  crearTarifaMock.mockReset();
  listarTarifasMock.mockReset();
  sesionActual = SUPERADMIN;
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/pricing-rates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/admin/pricing-rates", () => {
  it("A: cliente (member) intenta GET → 403", async () => {
    sesionActual = CLIENTE;
    const { GET } = await import("@/app/api/admin/pricing-rates/route");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listarTarifasMock).not.toHaveBeenCalled();
  });

  it("B: cliente intenta POST → 403, cero escritura", async () => {
    sesionActual = CLIENTE;
    const { POST } = await import("@/app/api/admin/pricing-rates/route");
    const res = await POST(
      jsonRequest({
        country: "CO",
        currency: "USD",
        category: "marketing",
        provider: "meta",
        unitCostUsd: 0.025,
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        source: "meta_official",
      })
    );
    expect(res.status).toBe(403);
    expect(crearTarifaMock).not.toHaveBeenCalled();
  });

  it("C: superadmin carga una tarifa real — 201", async () => {
    crearTarifaMock.mockResolvedValueOnce({ id: "prate_1" });
    const { POST } = await import("@/app/api/admin/pricing-rates/route");
    const res = await POST(
      jsonRequest({
        country: "CO",
        currency: "USD",
        category: "marketing",
        provider: "meta",
        unitCostUsd: 0.025,
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        source: "meta_official",
        sourceUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
      })
    );
    expect(res.status).toBe(201);
    expect(crearTarifaMock).toHaveBeenCalledWith(expect.objectContaining({ country: "CO", unitCostUsd: 0.025 }));
  });

  it("D: sin sesión → 401", async () => {
    sesionActual = null;
    const { GET } = await import("@/app/api/admin/pricing-rates/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("E: tarifa negativa (dato inválido) → 422, cero escritura", async () => {
    const { POST } = await import("@/app/api/admin/pricing-rates/route");
    const res = await POST(
      jsonRequest({
        country: "CO",
        currency: "USD",
        category: "marketing",
        provider: "meta",
        unitCostUsd: -1,
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        source: "meta_official",
      })
    );
    expect(res.status).toBe(422);
    expect(crearTarifaMock).not.toHaveBeenCalled();
  });
});
