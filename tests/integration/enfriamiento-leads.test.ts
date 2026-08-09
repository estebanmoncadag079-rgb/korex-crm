import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * El enfriamiento de tarjetas contra Postgres real (9-ago-2026).
 *
 * Va aquí y no en las unitarias porque lo delicado es **una subconsulta SQL**:
 * de qué fecha se mide el silencio, qué pasa cuando esa fecha es NULL y a qué
 * filas alcanza el UPDATE. Nada de eso se puede comprobar con un doble sin
 * acabar comprobando el doble.
 *
 * Contexto: hasta hoy la columna de perdidos no se llenaba sola —el agente solo
 * movía ahí al cliente que ANUNCIABA que se iba— y "En conversación" acumulaba
 * vivos y muertos juntos. Ver `docs/korexia/37-EMBUDO-VENTAS-INVISIBLES.md`.
 */

const F = {
  org: "org_test_enfriar",
  /** Callado hace mucho: debe bajar a "por recuperar". */
  frio: "ct_test_enfriar_frio",
  /** Escribió hace un rato: no se toca. */
  activo: "ct_test_enfriar_activo",
  /** Nunca escribió: `last_inbound_at` en NULL. */
  mudo: "ct_test_enfriar_mudo",
  cvFrio: "cv_test_enfriar_frio",
  cvActivo: "cv_test_enfriar_activo",
  cvMudo: "cv_test_enfriar_mudo",
  nueva: "st_test_enfriar_nueva",
  conversando: "st_test_enfriar_conv",
  ganada: "st_test_enfriar_won",
  porRecuperar: "st_test_enfriar_lost",
};

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;

/** Dónde está la tarjeta de un contacto ahora mismo. */
async function etapaDe(contactId: string): Promise<string | undefined> {
  const filas = (await db.execute(sql`
    SELECT stage_id FROM lead WHERE contact_id = ${contactId}
  `)) as unknown as Array<{ stage_id: string }>;
  return filas[0]?.stage_id;
}

async function ponerLead(contactId: string, stageId: string) {
  await db.execute(sql`
    INSERT INTO lead (id, organization_id, contact_id, stage_id, position, created_at, updated_at)
    VALUES (${"ld_" + contactId}, ${F.org}, ${contactId}, ${stageId}, 0, now(), now())
    ON CONFLICT (contact_id) DO UPDATE SET stage_id = ${stageId}
  `);
}

describe.skipIf(!hayBase)("enfriamiento de tarjetas (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();

    await db.execute(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${F.org}, 'Test Enfriar', 'test-enfriar', now())
      ON CONFLICT (id) DO NOTHING
    `);

    const etapas = [
      [F.nueva, "Nuevo", 0, "open"],
      [F.conversando, "En conversación", 1, "open"],
      [F.ganada, "Cliente", 2, "won"],
      [F.porRecuperar, "Por recuperar", 3, "lost"],
    ] as const;
    for (const [id, nombre, pos, kind] of etapas) {
      await db.execute(sql`
        INSERT INTO pipeline_stage (id, organization_id, name, position, kind, created_at)
        VALUES (${id}, ${F.org}, ${nombre}, ${pos}, ${kind}, now())
        ON CONFLICT (id) DO NOTHING
      `);
    }

    // El silencio se mide desde el último mensaje ENTRANTE de cada uno.
    const gente = [
      [F.frio, "570000000101", F.cvFrio, "now() - interval '9 days'"],
      [F.activo, "570000000102", F.cvActivo, "now() - interval '1 hour'"],
      [F.mudo, "570000000103", F.cvMudo, "NULL"],
    ] as const;
    for (const [ct, tel, cv, inbound] of gente) {
      await db.execute(sql`
        INSERT INTO contact (id, organization_id, phone, name, created_at)
        VALUES (${ct}, ${F.org}, ${tel}, 'Test', now())
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO conversation (id, organization_id, contact_id, last_inbound_at, created_at)
        VALUES (${cv}, ${F.org}, ${ct}, ${sql.raw(inbound)}, now())
        ON CONFLICT (id) DO UPDATE SET last_inbound_at = ${sql.raw(inbound)}
      `);
    }
  });

  beforeEach(async () => {
    await ponerLead(F.frio, F.conversando);
    await ponerLead(F.activo, F.conversando);
    await ponerLead(F.mudo, F.conversando);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM lead WHERE organization_id = ${F.org}`);
  });

  it("baja a por recuperar al que lleva días sin responder", async () => {
    const movidas = await m.leads.enfriarLeadsInactivos(F.org, 2);
    expect(movidas).toBeGreaterThanOrEqual(1);
    expect(await etapaDe(F.frio)).toBe(F.porRecuperar);
  });

  it("no toca al que acaba de escribir", async () => {
    await m.leads.enfriarLeadsInactivos(F.org, 2);
    expect(await etapaDe(F.activo)).toBe(F.conversando);
  });

  it("no enfría a quien nunca escribió: sin fecha no hay silencio que medir", async () => {
    // La subconsulta devuelve NULL y la comparación lo deja fuera. Si esto
    // fallara, un contacto creado por un saliente caería a por recuperar sin
    // haber tenido nunca la oportunidad de contestar.
    await m.leads.enfriarLeadsInactivos(F.org, 2);
    expect(await etapaDe(F.mudo)).toBe(F.conversando);
  });

  it("nunca saca a un cliente ya ganado", async () => {
    // Un ganado que se queda callado sigue siendo una venta. Si el UPDATE
    // alcanzara las etapas cerradas, el tablero perdería clientes solos.
    await ponerLead(F.frio, F.ganada);
    await m.leads.enfriarLeadsInactivos(F.org, 2);
    expect(await etapaDe(F.frio)).toBe(F.ganada);
  });

  it("es idempotente: pasarla dos veces no mueve nada nuevo", async () => {
    await m.leads.enfriarLeadsInactivos(F.org, 2);
    const segunda = await m.leads.enfriarLeadsInactivos(F.org, 2);
    expect(segunda).toBe(0);
  });

  it("el umbral manda: con 30 días ese mismo lead no se enfría", async () => {
    const movidas = await m.leads.enfriarLeadsInactivos(F.org, 30);
    expect(movidas).toBe(0);
    expect(await etapaDe(F.frio)).toBe(F.conversando);
  });

  describe("volver a escribir devuelve la tarjeta a la conversación", () => {
    it("revive al enfriado", async () => {
      // Sin esto, la regla de 2 días sería una trampa: quien vuelve el jueves a
      // pedir se quedaría en "por recuperar" mientras compra.
      await ponerLead(F.frio, F.porRecuperar);
      expect(await m.leads.reactivarLeadPorMensaje(F.org, F.frio)).toBe(true);
      expect(await etapaDe(F.frio)).toBe(F.conversando);
    });

    it("NO degrada a un cliente ganado que escribe de nuevo", async () => {
      // Esa era la razón original de que un lead cerrado no se reabriera, y se
      // respeta: revivir solo alcanza a la etapa de enfriamiento.
      await ponerLead(F.activo, F.ganada);
      expect(await m.leads.reactivarLeadPorMensaje(F.org, F.activo)).toBe(false);
      expect(await etapaDe(F.activo)).toBe(F.ganada);
    });

    it("no hace nada con quien ya estaba conversando", async () => {
      expect(await m.leads.reactivarLeadPorMensaje(F.org, F.activo)).toBe(false);
      expect(await etapaDe(F.activo)).toBe(F.conversando);
    });
  });
});
