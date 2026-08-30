import { describe, expect, it } from "vitest";
import { provisionOrganization } from "@/server/auth/provisioning";
import { schema } from "@/lib/db";

/**
 * `provisionOrganization` es el ÚNICO punto donde nace un `agent_profile`
 * (docs de la corrección de onboarding, 29-ago-2026): antes solo decidía
 * `appointmentsEnabled` y dejaba `catalogSource`/`stateSource`/
 * `paymentSource`/`consultasVerificadasEnabled` en el default más viejo de
 * la columna — que es exactamente cómo Malía entró con el catálogo moderno
 * pero el estado del pedido en `'prompt'`.
 *
 * Prueba contra un `tx` falso (sin Postgres): lo único que importa aquí es
 * CON QUÉ VALORES se llama a `tx.insert(agentProfile).values(...)`, no que la
 * fila llegue a existir de verdad — eso ya lo cubre `catalogo-de-pedidos.test.ts`
 * y el resto de la suite de integración.
 */
function fakeTx() {
  const inserts: { table: unknown; values: unknown }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
  };
  return { tx: tx as never, inserts };
}

function agentProfileInsertado(inserts: { table: unknown; values: unknown }[]) {
  return inserts.find((i) => i.table === schema.agentProfile)?.values as
    | Record<string, unknown>
    | undefined;
}

describe("provisionOrganization: arquitectura con la que nace un cliente nuevo", () => {
  it("PEDIDOS: nace con catálogo en tabla, estado en backend, pago en ficha y consultas verificadas", async () => {
    const { tx, inserts } = fakeTx();
    await provisionOrganization(tx, {
      organizationId: "org_nuevo_pedidos",
      name: "Negocio Nuevo",
      slug: "negocio-nuevo",
      needsAppointments: false,
    });

    const perfil = agentProfileInsertado(inserts);
    expect(perfil).toEqual({
      id: expect.any(String),
      organizationId: "org_nuevo_pedidos",
      appointmentsEnabled: false,
      catalogSource: "tabla",
      stateSource: "backend",
      paymentSource: "ficha",
      consultasVerificadasEnabled: true,
    });
  });

  it("CITAS: nace con appointments encendido y estado en backend, SIN forzar mecanismos de pedidos", async () => {
    const { tx, inserts } = fakeTx();
    await provisionOrganization(tx, {
      organizationId: "org_nuevo_citas",
      name: "Salón Nuevo",
      slug: "salon-nuevo",
      needsAppointments: true,
    });

    const perfil = agentProfileInsertado(inserts);
    expect(perfil?.appointmentsEnabled).toBe(true);
    expect(perfil?.stateSource).toBe("backend");
    // Ninguno de estos tres es un concepto de citas: deben quedar en su
    // valor neutro de siempre, nunca "encendidos" sin que tengan efecto.
    expect(perfil?.catalogSource).toBe("prompt");
    expect(perfil?.paymentSource).toBe("prompt");
    expect(perfil?.consultasVerificadasEnabled).toBe(false);
  });

  it("sin needsAppointments (undefined) se comporta como pedidos, igual que siempre", async () => {
    const { tx, inserts } = fakeTx();
    await provisionOrganization(tx, {
      organizationId: "org_sin_bandera",
      name: "Negocio",
      slug: "negocio",
    });

    const perfil = agentProfileInsertado(inserts);
    expect(perfil?.appointmentsEnabled).toBe(false);
    expect(perfil?.catalogSource).toBe("tabla");
    expect(perfil?.stateSource).toBe("backend");
  });
});
