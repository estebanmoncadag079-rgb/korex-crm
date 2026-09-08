import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * Programa de mejora integral, Prioridad 3 — el token de concurrencia
 * optimista de `conversation_state` (`version`, mismo principio que
 * `generation` en `agent_job`, Fase 10Q) contra Postgres real.
 *
 * `tests/unit/estado-concurrencia-pipeline.test.ts` prueba el CABLEADO en
 * `pipeline.ts` con mocks; esto prueba la semántica real del
 * `ON CONFLICT ... DO UPDATE ... WHERE version = $esperada` — algo que un
 * doble no puede demostrar de verdad.
 *
 * Se salta sola si no hay `TEST_DATABASE_URL`.
 */

const d = hayBase ? describe : describe.skip;

const ORG = "org_test_estado_concurrencia";
const CONVERSACION = "cv_test_estado_concurrencia";
const CONTACTO = "ct_test_estado_concurrencia";

d("conversation_state: version (Postgres real)", () => {
  let mod: typeof import("@/server/orders/estado");
  let db: Awaited<ReturnType<typeof cargarConBaseDePruebas>>["getDb"] extends () => infer T
    ? T
    : never;
  let schema: typeof import("@/lib/db").schema;

  beforeAll(async () => {
    const cargado = await cargarConBaseDePruebas();
    db = cargado.getDb();
    schema = cargado.schema;
    mod = cargado.estado;

    const { eq } = await import("drizzle-orm");
    await db.delete(schema.organization).where(eq(schema.organization.id, ORG));
    await db.insert(schema.organization).values({ id: ORG, name: "Test concurrencia" });
    await db.insert(schema.contact).values({
      id: CONTACTO,
      organizationId: ORG,
      phone: "573000000099",
      name: "Test",
    });
    await db.insert(schema.conversation).values({
      id: CONVERSACION,
      organizationId: ORG,
      contactId: CONTACTO,
    });
  }, 60_000);

  beforeEach(async () => {
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.conversationState).where(eq(schema.conversationState.conversationId, CONVERSACION));
  });

  function estadoDePrueba(paso: string) {
    return {
      schema_version: 5,
      items: [],
      datos: {},
      paso,
      confirmado: false,
      totalCents: null,
    };
  }

  it("una escritura sin versionEsperada siempre se aplica (comportamiento de siempre, sin romper compatibilidad)", async () => {
    const r = await mod.guardarEstado({
      conversationId: CONVERSACION,
      organizationId: ORG,
      estado: estadoDePrueba("paso 1"),
      actor: "pipeline",
      proceso: "test",
    });
    expect(r.ok).toBe(true);
    const leido = await mod.leerEstado(CONVERSACION, ORG);
    expect(leido?.paso).toBe("paso 1");
  });

  it("BUG REAL corregido: una escritura con versionEsperada OBSOLETA no se aplica — el estado más nuevo no se pisa", async () => {
    // Turno A lee la versión inicial (0, fila nueva).
    const filaA = await mod.leerEstadoConVersion(CONVERSACION, ORG);
    expect(filaA).toBeNull(); // todavía no existe

    // Turno A escribe primero (crea la fila, version pasa a 0 -> el INSERT
    // no incrementa, arranca en 0 por DEFAULT).
    await mod.guardarEstado({
      conversationId: CONVERSACION,
      organizationId: ORG,
      estado: estadoDePrueba("turno A"),
      actor: "pipeline",
      proceso: "turno-A",
    });

    // Turno B (una segunda ejecución VIVA de runAgentTurn para la misma
    // conversación — el escenario real que rescatarHuerfanos puede crear)
    // lee la fila que A acaba de crear.
    const filaB = await mod.leerEstadoConVersion(CONVERSACION, ORG);
    expect(filaB).not.toBeNull();
    const versionQueVioB = filaB!.version;

    // Turno A escribe DE NUEVO (otro turno, mismo hilo lógico) antes de que
    // B alcance a escribir — la versión avanza.
    await mod.guardarEstado({
      conversationId: CONVERSACION,
      organizationId: ORG,
      estado: estadoDePrueba("turno A, segunda vez"),
      actor: "pipeline",
      proceso: "turno-A-2",
    });

    // B, con la versión VIEJA que leyó (antes del segundo escrito de A),
    // intenta escribir. Antes de esta fase: esto pisaba silenciosamente el
    // estado de A. Ahora: la escritura de B no debe aplicarse.
    const resultadoB = await mod.guardarEstado({
      conversationId: CONVERSACION,
      organizationId: ORG,
      estado: estadoDePrueba("turno B (con datos viejos)"),
      actor: "pipeline",
      proceso: "turno-B",
      versionEsperada: versionQueVioB,
    });
    expect(resultadoB.ok).toBe(false);

    // El estado que queda en la base es el de A, no el de B.
    const final = await mod.leerEstado(CONVERSACION, ORG);
    expect(final?.paso).toBe("turno A, segunda vez");
  });

  it("una escritura con versionEsperada VIGENTE sí se aplica y avanza la versión", async () => {
    await mod.guardarEstado({
      conversationId: CONVERSACION,
      organizationId: ORG,
      estado: estadoDePrueba("inicial"),
      actor: "pipeline",
      proceso: "test",
    });
    const fila = await mod.leerEstadoConVersion(CONVERSACION, ORG);
    expect(fila).not.toBeNull();

    const resultado = await mod.guardarEstado({
      conversationId: CONVERSACION,
      organizationId: ORG,
      estado: estadoDePrueba("actualizado"),
      actor: "pipeline",
      proceso: "test",
      versionEsperada: fila!.version,
    });
    expect(resultado.ok).toBe(true);

    const filaTras = await mod.leerEstadoConVersion(CONVERSACION, ORG);
    expect(filaTras?.estado.paso).toBe("actualizado");
    expect(filaTras!.version).toBeGreaterThan(fila!.version);
  });
});
