import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * Fase 9B: el camino de BORRADOR de plantillas contra Postgres real —
 * columnas nuevas (`provider`/`providerStatus`/`providerLastSyncAt`),
 * aislamiento multi-tenant, y la restricción UNIQUE(organizationId, name,
 * language) ya existente. Nunca llama a YCloud/Meta reales.
 */

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;

const ORG_A = "org_test_borrador_a";
const ORG_B = "org_test_borrador_b";

async function limpiar() {
  for (const org of [ORG_A, ORG_B]) {
    await db.execute(sql`DELETE FROM template WHERE organization_id = ${org}`);
  }
}

describe.skipIf(!hayBase)("crearBorradorDePlantilla / enviarPlantillaAAprobacion (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    for (const org of [ORG_A, ORG_B]) {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, created_at)
        VALUES (${org}, 'Test Borrador', ${org}, now())
        ON CONFLICT (id) DO NOTHING
      `);
    }
  });

  beforeEach(async () => {
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
  });

  it("crea un draft real: status='draft', provider/providerStatus/providerLastSyncAt en null", async () => {
    const fila = await m.templates.crearBorradorDePlantilla(ORG_A, {
      name: "Confirmación de prueba",
      language: "es",
      category: "UTILITY",
      body: "Hola {{1}}, esto es una prueba",
    });
    expect(fila.status).toBe("draft");
    expect(fila.waTemplateId).toBeNull();

    const [row] = (await db.execute(
      sql`SELECT status, provider, provider_status, provider_last_sync_at, wa_template_id FROM template WHERE id = ${fila.id}`
    )) as unknown as Array<{
      status: string;
      provider: string | null;
      provider_status: string | null;
      provider_last_sync_at: string | null;
      wa_template_id: string | null;
    }>;
    expect(row!.status).toBe("draft");
    expect(row!.provider).toBeNull();
    expect(row!.provider_status).toBeNull();
    expect(row!.provider_last_sync_at).toBeNull();
    expect(row!.wa_template_id).toBeNull();
  });

  it("duplicado real (mismo organizationId+name+language): rechazado por el UNIQUE existente", async () => {
    await m.templates.crearBorradorDePlantilla(ORG_A, {
      name: "duplicada",
      language: "es",
      category: "UTILITY",
      body: "Hola",
    });

    const err = await m.templates
      .crearBorradorDePlantilla(ORG_A, { name: "duplicada", language: "es", category: "UTILITY", body: "Hola" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(m.templates.TemplateError);
    expect((err as { code: string }).code).toBe("invalid");

    const filas = (await db.execute(
      sql`SELECT id FROM template WHERE organization_id = ${ORG_A} AND name = 'duplicada' AND language = 'es'`
    )) as unknown as Array<{ id: string }>;
    expect(filas).toHaveLength(1); // nunca se duplicó
  });

  it("multi-tenant: mismo name+language en organizaciones DISTINTAS no colisiona entre sí", async () => {
    const filaA = await m.templates.crearBorradorDePlantilla(ORG_A, {
      name: "misma_plantilla",
      language: "es",
      category: "UTILITY",
      body: "Hola A",
    });
    const filaB = await m.templates.crearBorradorDePlantilla(ORG_B, {
      name: "misma_plantilla",
      language: "es",
      category: "UTILITY",
      body: "Hola B",
    });
    expect(filaA.id).not.toBe(filaB.id);
    expect(filaA.organizationId).toBe(ORG_A);
    expect(filaB.organizationId).toBe(ORG_B);

    const filas = (await db.execute(
      sql`SELECT organization_id, body FROM template WHERE name = 'misma_plantilla' ORDER BY organization_id`
    )) as unknown as Array<{ organization_id: string; body: string }>;
    expect(filas).toHaveLength(2);
  });

  it("enviarPlantillaAAprobacion sobre un draft real: lanza not_implemented, nunca escribe pending", async () => {
    const fila = await m.templates.crearBorradorDePlantilla(ORG_A, {
      name: "para_enviar",
      language: "es",
      category: "UTILITY",
      body: "Hola {{1}}",
    });

    const err = await m.templates.enviarPlantillaAAprobacion(ORG_A, fila.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(m.templates.TemplateError);
    expect((err as { code: string }).code).toBe("not_implemented");

    const [row] = (await db.execute(
      sql`SELECT status FROM template WHERE id = ${fila.id}`
    )) as unknown as Array<{ status: string }>;
    expect(row!.status).toBe("draft"); // intacto — nunca pasó a pending sin proveedor real
  });

  it("enviarPlantillaAAprobacion cross-tenant: organización B no puede tocar un draft de A", async () => {
    const fila = await m.templates.crearBorradorDePlantilla(ORG_A, {
      name: "solo_de_a",
      language: "es",
      category: "UTILITY",
      body: "Hola",
    });

    const err = await m.templates.enviarPlantillaAAprobacion(ORG_B, fila.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(m.templates.TemplateError);
    expect((err as { code: string }).code).toBe("not_found");
  });
});
