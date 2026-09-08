import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * Fase 10V, Hallazgo A — atomicidad REAL (Postgres) de
 * `registrarConfirmacionDeCita`, el `UNIQUE(conversationId, idempotencyKey)`
 * que decide si una ejecución de `book_appointment` es la primera o no.
 *
 * `tests/unit/pipeline-book-appointment-idempotencia.test.ts` prueba el
 * CABLEADO en pipeline.ts con mocks (incluido el escenario F de concurrencia
 * simulada); esto prueba la garantía real que ese cableado asume — que
 * Postgres, no JavaScript, decide cuál de dos INSERT concurrentes gana.
 *
 * Se salta sola si no hay `TEST_DATABASE_URL`.
 */

const d = hayBase ? describe : describe.skip;

const ORG = "org_test_citas_idempotencia";
const CONVERSACION = "cv_test_citas_idempotencia";
const CONTACTO = "ct_test_citas_idempotencia";

d("registrarConfirmacionDeCita: atomicidad (Postgres real)", () => {
  let mod: typeof import("@/server/ai/confirmacion-de-cita");
  let db: Awaited<ReturnType<typeof cargarConBaseDePruebas>>["getDb"] extends () => infer T
    ? T
    : never;
  let schema: typeof import("@/lib/db").schema;

  beforeAll(async () => {
    const cargado = await cargarConBaseDePruebas();
    db = cargado.getDb();
    schema = cargado.schema;
    mod = await import("@/server/ai/confirmacion-de-cita");

    const { eq } = await import("drizzle-orm");
    await db.delete(schema.organization).where(eq(schema.organization.id, ORG));
    await db.insert(schema.organization).values({ id: ORG, name: "Test idempotencia citas" });
    await db.insert(schema.contact).values({
      id: CONTACTO,
      organizationId: ORG,
      phone: "573000000098",
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
    await db
      .delete(schema.appointmentBookingConfirmation)
      .where(eq(schema.appointmentBookingConfirmation.conversationId, CONVERSACION));
  });

  it("dos registros concurrentes con los MISMOS messageIds: exactamente uno gana (primeraVez:true)", async () => {
    const messageIds = ["msg_a", "msg_b"];
    const [r1, r2] = await Promise.all([
      mod.registrarConfirmacionDeCita({ organizationId: ORG, conversationId: CONVERSACION, messageIds }),
      mod.registrarConfirmacionDeCita({ organizationId: ORG, conversationId: CONVERSACION, messageIds }),
    ]);
    const ganadores = [r1, r2].filter((r) => r.primeraVez);
    expect(ganadores).toHaveLength(1);
  });

  it("el orden de los messageIds no cambia la clave (['a','b'] === ['b','a'])", async () => {
    const r1 = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_x", "msg_y"],
    });
    const r2 = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_y", "msg_x"],
    });
    expect(r1.primeraVez).toBe(true);
    expect(r2.primeraVez).toBe(false);
  });

  it("un lote de mensajes DISTINTO en la misma conversación SÍ es una primera vez propia", async () => {
    await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_1"],
    });
    const r2 = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_2"], // pedido genuinamente distinto, otro turno
    });
    expect(r2.primeraVez).toBe(true);
  });

  it("Fase 8A: 'kind' se guarda tal cual para reschedule/cancel, y NO participa en la clave de unicidad (mismo messageIds, distinto kind -> igual gana solo uno)", async () => {
    const { eq } = await import("drizzle-orm");
    const reprog = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_reschedule"],
      kind: "reprogramacion",
    });
    expect(reprog.primeraVez).toBe(true);
    const [filaReprog] = await db
      .select({ kind: schema.appointmentBookingConfirmation.kind })
      .from(schema.appointmentBookingConfirmation)
      .where(eq(schema.appointmentBookingConfirmation.id, reprog.id));
    expect(filaReprog?.kind).toBe("reprogramacion");

    const cancel = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_cancel"],
      kind: "cancelacion",
    });
    expect(cancel.primeraVez).toBe(true);
    const [filaCancel] = await db
      .select({ kind: schema.appointmentBookingConfirmation.kind })
      .from(schema.appointmentBookingConfirmation)
      .where(eq(schema.appointmentBookingConfirmation.id, cancel.id));
    expect(filaCancel?.kind).toBe("cancelacion");

    // Repetir el MISMO lote de mensajes de la reprogramación, esta vez
    // pidiendo (por error o por una carrera real) kind:"cancelacion": el
    // UNIQUE es (conversationId, idempotencyKey) — kind no participa, así
    // que sigue ganando solo el primer registro, sin importar qué kind pida
    // el segundo intento.
    const repetido = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_reschedule"],
      kind: "cancelacion",
    });
    expect(repetido.primeraVez).toBe(false);
    expect(repetido.id).toBe(reprog.id);
  });

  it("book_appointment sin pasar 'kind' explícito sigue quedando 'reserva' (compatibilidad, Fase 8A no cambia el comportamiento por defecto)", async () => {
    const { eq } = await import("drizzle-orm");
    const r = await mod.registrarConfirmacionDeCita({
      organizationId: ORG,
      conversationId: CONVERSACION,
      messageIds: ["msg_sin_kind"],
    });
    const [f] = await db
      .select({ kind: schema.appointmentBookingConfirmation.kind })
      .from(schema.appointmentBookingConfirmation)
      .where(eq(schema.appointmentBookingConfirmation.id, r.id));
    expect(f?.kind).toBe("reserva");
  });
});
