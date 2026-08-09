import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * El rate-limit contra Postgres real. Antes vivía en un `Map` de este proceso,
 * y con varias réplicas "10 intentos por IP" pasaba a ser 10 por instancia.
 */

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;

const LIMITE = { windowMs: 10 * 60 * 1000, max: 10 };

describe.skipIf(!hayBase)("rate limit por IP (FR-062, en la base)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
  });

  beforeEach(async () => {
    await m.rateLimit.resetRateLimit();
  });

  it("permite hasta el máximo y bloquea el siguiente", async () => {
    for (let i = 0; i < LIMITE.max; i++) {
      const r = await m.rateLimit.checkRateLimit("login:1.2.3.4", LIMITE);
      expect(r.allowed).toBe(true);
    }
    const bloqueado = await m.rateLimit.checkRateLimit("login:1.2.3.4", LIMITE);
    expect(bloqueado.allowed).toBe(false);
  });

  it("claves distintas (IPs) no se afectan entre sí", async () => {
    for (let i = 0; i < LIMITE.max; i++) {
      await m.rateLimit.checkRateLimit("login:1.1.1.1", LIMITE);
    }
    expect(
      (await m.rateLimit.checkRateLimit("login:1.1.1.1", LIMITE)).allowed
    ).toBe(false);
    expect(
      (await m.rateLimit.checkRateLimit("login:2.2.2.2", LIMITE)).allowed
    ).toBe(true);
  });

  it("la ventana desliza: lo viejo deja de contar", async () => {
    const limite = { windowMs: 60_000, max: 2 };
    expect((await m.rateLimit.checkRateLimit("k", limite)).allowed).toBe(true);
    expect((await m.rateLimit.checkRateLimit("k", limite)).allowed).toBe(true);
    expect((await m.rateLimit.checkRateLimit("k", limite)).allowed).toBe(false);

    // Envejecer los intentos en vez de esperar de verdad: así la prueba es
    // determinista y no depende de lo que tarde la red.
    const db = m.getDb();
    await db.execute(
      sql`UPDATE rate_limit_hit SET at = at - interval '2 minutes' WHERE key = 'k'`
    );
    expect((await m.rateLimit.checkRateLimit("k", limite)).allowed).toBe(true);
  });

  it("el conteo es COMPARTIDO: es lo que se rompía con varias réplicas", async () => {
    // Dos llamadas desde "procesos" distintos comparten el mismo cubo, porque
    // el cubo está en la base y no en la memoria de cada uno.
    const corta = { windowMs: 60_000, max: 3 };
    await m.rateLimit.checkRateLimit("compartida", corta);
    await m.rateLimit.checkRateLimit("compartida", corta);
    await m.rateLimit.checkRateLimit("compartida", corta);
    expect(
      (await m.rateLimit.checkRateLimit("compartida", corta)).allowed
    ).toBe(false);
  });
});
