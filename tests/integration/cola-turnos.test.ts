import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, FIXTURE, hayBase } from "./_db";

/**
 * La cola de turnos contra Postgres real (fases 1 y 2,
 * `docs/korexia/33-ESCALABILIDAD.md`).
 *
 * Cada prueba de aquí corresponde a un fallo concreto que el diseño anterior
 * —un `Map` en memoria con `setTimeout`— tenía o habría tenido al levantar una
 * segunda réplica.
 */

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;

describe.skipIf(!hayBase)("cola de turnos del agente (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${FIXTURE.org}, 'Test Cola', 'test-cola', now())
      ON CONFLICT (id) DO NOTHING
    `);
    const contactos = [
      [FIXTURE.contacto, "570000000001", FIXTURE.conversacion],
      [FIXTURE.contacto2, "570000000002", FIXTURE.conversacion2],
    ] as const;
    for (const [ct, tel, cv] of contactos) {
      await db.execute(sql`
        INSERT INTO contact (id, organization_id, phone, name, created_at)
        VALUES (${ct}, ${FIXTURE.org}, ${tel}, 'Test', now())
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO conversation (id, organization_id, contact_id, created_at)
        VALUES (${cv}, ${FIXTURE.org}, ${ct}, now())
        ON CONFLICT (id) DO NOTHING
      `);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM agent_job WHERE organization_id = ${FIXTURE.org}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM agent_job WHERE organization_id = ${FIXTURE.org}`);
  });

  it("una ráfaga de mensajes deja UN solo turno pendiente (coalescencia)", async () => {
    for (let i = 0; i < 5; i++) {
      await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 6000 });
    }
    const estado = await m.cola.estadoDeLaCola();
    expect(estado.pendientes).toBe(1);
  });

  it("cada mensaje nuevo aplaza el turno: es el debounce", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const [antes] = (await db.execute(sql`
      SELECT run_at FROM agent_job WHERE conversation_id = ${FIXTURE.conversacion}
    `)) as unknown as Array<{ run_at: Date }>;

    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 5000 });
    const [despues] = (await db.execute(sql`
      SELECT run_at FROM agent_job WHERE conversation_id = ${FIXTURE.conversacion}
    `)) as unknown as Array<{ run_at: Date }>;

    expect(antes).toBeDefined();
    expect(despues).toBeDefined();
    expect(new Date(despues!.run_at).getTime()).toBeGreaterThan(
      new Date(antes!.run_at).getTime()
    );
  });

  it("un trabajo aplazado no se toma antes de tiempo", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 60_000 });
    expect(await m.cola.tomarTrabajo("w1")).toBeNull();
  });

  it("dos workers no toman el mismo trabajo (esto duplicaba respuestas)", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const [a, b] = await Promise.all([
      m.cola.tomarTrabajo("w1"),
      m.cola.tomarTrabajo("w2"),
    ]);
    const tomados = [a, b].filter(Boolean);
    expect(tomados).toHaveLength(1);
  });

  it("mientras un turno corre, otro de la MISMA conversación espera su vuelta", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const primero = await m.cola.tomarTrabajo("w1");
    expect(primero).not.toBeNull();

    // Llega otro mensaje del cliente mientras el agente piensa.
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    expect(await m.cola.tomarTrabajo("w2")).toBeNull();

    // Al terminar el primero, el segundo ya se puede atender.
    await m.cola.completarTrabajo(primero!.id);
    expect(await m.cola.tomarTrabajo("w2")).not.toBeNull();
  });

  it("conversaciones distintas SÍ se atienden en paralelo", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    await m.cola.encolarTurno(FIXTURE.conversacion2, { delayMs: 0 });
    const a = await m.cola.tomarTrabajo("w1");
    const b = await m.cola.tomarTrabajo("w2");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.conversationId).not.toBe(b!.conversationId);
  });

  it("un turno que se queda colgado vuelve a la cola (antes se perdía para siempre)", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const tomado = await m.cola.tomarTrabajo("worker-que-se-muere");
    expect(tomado).not.toBeNull();

    // Simula que ese proceso murió hace rato.
    await db.execute(sql`
      UPDATE agent_job SET locked_at = now() - interval '30 minutes'
       WHERE id = ${tomado!.id}
    `);
    expect(await m.cola.rescatarHuerfanos()).toBe(1);

    const recuperado = await m.cola.tomarTrabajo("worker-nuevo");
    expect(recuperado?.conversationId).toBe(FIXTURE.conversacion);
  });

  it("un fallo se reintenta con espera, no se pierde", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const t = await m.cola.tomarTrabajo("w1");
    const r = await m.cola.fallarTrabajo(t!.id, new Error("el modelo falló"), t!.attempts);

    expect(r.reintenta).toBe(true);
    const estado = await m.cola.estadoDeLaCola();
    expect(estado.pendientes).toBe(1);
    // Reprogramado al futuro: no se reintenta en bucle inmediato.
    expect(await m.cola.tomarTrabajo("w1")).toBeNull();
  });

  it("tras agotar los intentos queda como fallido, con el error a la vista", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const t = await m.cola.tomarTrabajo("w1");
    const r = await m.cola.fallarTrabajo(
      t!.id,
      new Error("causa raíz"),
      m.cola.MAX_INTENTOS
    );

    expect(r.reintenta).toBe(false);
    const estado = await m.cola.estadoDeLaCola();
    expect(estado.fallidos).toBe(1);
    const [fila] = (await db.execute(sql`
      SELECT last_error FROM agent_job WHERE id = ${t!.id}
    `)) as unknown as Array<{ last_error: string }>;
    expect(fila).toBeDefined();
    expect(fila!.last_error).toContain("causa raíz");
  });

  it("si al fallar ya hay otro turno pendiente, no se duplica", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });
    const t = await m.cola.tomarTrabajo("w1");
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 0 });

    await m.cola.fallarTrabajo(t!.id, new Error("x"), t!.attempts);

    const estado = await m.cola.estadoDeLaCola();
    expect(estado.pendientes).toBe(1);
    expect(estado.corriendo).toBe(0);
  });

  it("un cliente con mucho volumen NO ocupa toda la cola", async () => {
    // Cuatro conversaciones de la MISMA organización listas a la vez: es la
    // hora pico de un negocio grande. Sin tope se llevaría los cuatro huecos
    // del worker y los demás clientes esperarían detrás.
    const extra = ["cv_test_cola_3", "cv_test_cola_4"];
    const contactosExtra = ["ct_test_cola_3", "ct_test_cola_4"];
    for (let i = 0; i < extra.length; i++) {
      await db.execute(sql`
        INSERT INTO contact (id, organization_id, phone, name, created_at)
        VALUES (${contactosExtra[i]!}, ${FIXTURE.org}, ${`57000000001${i}`}, 'Test', now())
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO conversation (id, organization_id, contact_id, created_at)
        VALUES (${extra[i]!}, ${FIXTURE.org}, ${contactosExtra[i]!}, now())
        ON CONFLICT (id) DO NOTHING
      `);
    }

    for (const cv of [
      FIXTURE.conversacion,
      FIXTURE.conversacion2,
      ...extra,
    ]) {
      await m.cola.encolarTurno(cv, { delayMs: 0 });
    }

    const tomados = [];
    for (let i = 0; i < 4; i++) {
      const t = await m.cola.tomarTrabajo(`w${i}`);
      if (t) tomados.push(t);
    }
    expect(tomados).toHaveLength(m.cola.CONCURRENCIA_POR_ORG);

    // Al liberar uno, entra el siguiente de esa organización: es un tope de
    // simultaneidad, no un límite de cuánto se le atiende en total.
    await m.cola.completarTrabajo(tomados[0]!.id);
    expect(await m.cola.tomarTrabajo("w9")).not.toBeNull();
  });

  it("el aplazamiento tiene techo: quien escribe sin parar igual es atendido", async () => {
    await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 1000 });
    // Muchos mensajes seguidos, cada uno pidiendo esperar más.
    for (let i = 0; i < 20; i++) {
      await m.cola.encolarTurno(FIXTURE.conversacion, { delayMs: 60_000 });
    }
    const [fila] = (await db.execute(sql`
      SELECT run_at, created_at FROM agent_job
       WHERE conversation_id = ${FIXTURE.conversacion}
    `)) as unknown as Array<{ run_at: Date; created_at: Date }>;

    expect(fila).toBeDefined();
    const aplazado =
      new Date(fila!.run_at).getTime() - new Date(fila!.created_at).getTime();
    expect(aplazado).toBeLessThanOrEqual(m.cola.ESPERA_MAXIMA_MS + 1000);
  });
});
