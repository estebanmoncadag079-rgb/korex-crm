import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Encender/apagar el agente afecta a TODO el negocio a la vez — a
 * diferencia de pasar una conversación puntual a una persona (eso sigue
 * abierto a cualquiera del equipo, ver `ModoAtencion`). Un empleado del
 * negocio apagándolo sin querer deja a todos sus clientes sin respuesta
 * hasta que alguien se dé cuenta — por eso el interruptor global queda
 * restringido a `platformRole === 'superadmin'` (la agencia), tanto en la
 * UI (`AgentClient`, gateado por `esAgencia`) como aquí, en el servidor,
 * que es lo único que de verdad protege contra un cliente HTTP directo.
 */

type Sesion = { userId: string; organizationId: string; platformRole: "superadmin" | null };
let sesionActual: Sesion | null = null;
class UnauthorizedErrorMock extends Error {}
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: UnauthorizedErrorMock,
  requireSession: async () => {
    if (!sesionActual) throw new UnauthorizedErrorMock();
    return sesionActual;
  },
}));

const updatedValues: Record<string, unknown>[] = [];
const FILA_ACTUAL = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: false,
  notifyPhones: null,
  notifyTemplate: null,
  notifyTemplateLang: null,
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([FILA_ACTUAL]),
        limit: () => Promise.resolve([FILA_ACTUAL]),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updatedValues.push(values);
            return Promise.resolve([{ ...FILA_ACTUAL, ...values }]);
          },
        }),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const SUPERADMIN: Sesion = { userId: "u_admin", organizationId: "org_1", platformRole: "superadmin" };
const MIEMBRO_DEL_NEGOCIO: Sesion = { userId: "u_cliente", organizationId: "org_1", platformRole: null };

function putRequest(body: unknown) {
  return new Request("http://localhost/api/agent/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updatedValues.length = 0;
  sesionActual = null;
});

describe("PUT /api/agent/profile — encender/apagar el agente, solo superadmin", () => {
  it("A: un miembro del negocio (no superadmin) intenta encender/apagar el agente -> 403, CERO escritura", async () => {
    sesionActual = MIEMBRO_DEL_NEGOCIO;
    const { PUT } = await import("@/app/api/agent/profile/route");
    const res = await PUT(putRequest({ enabled: true }));

    expect(res.status).toBe(403);
    expect(updatedValues).toHaveLength(0);
  });

  it("B: el mismo miembro del negocio SÍ puede seguir editando notifyPhones (no es el interruptor global)", async () => {
    sesionActual = MIEMBRO_DEL_NEGOCIO;
    const { PUT } = await import("@/app/api/agent/profile/route");
    const res = await PUT(putRequest({ notifyPhones: "3001234567" }));

    expect(res.status).toBe(200);
    expect(updatedValues).toHaveLength(1);
    expect(updatedValues[0]).toMatchObject({ notifyPhones: "3001234567" });
  });

  it("C: superadmin SÍ puede encender el agente", async () => {
    sesionActual = SUPERADMIN;
    const { PUT } = await import("@/app/api/agent/profile/route");
    const res = await PUT(putRequest({ enabled: true }));

    expect(res.status).toBe(200);
    expect(updatedValues).toHaveLength(1);
    expect(updatedValues[0]).toMatchObject({ enabled: true });
  });

  it("D: un miembro del negocio que manda 'enabled' MEZCLADO con otro campo permitido -> 403 entero, no aplica ni el campo permitido", async () => {
    sesionActual = MIEMBRO_DEL_NEGOCIO;
    const { PUT } = await import("@/app/api/agent/profile/route");
    const res = await PUT(putRequest({ enabled: true, notifyPhones: "3001234567" }));

    expect(res.status).toBe(403);
    expect(updatedValues).toHaveLength(0);
  });
});
