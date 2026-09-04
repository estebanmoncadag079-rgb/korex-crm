import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * Fase 10N-A — idempotencia de `notify_order` contra Postgres real: lo que
 * un mock en JS no puede probar de verdad (`tests/unit/confirmacion-de-pedido.test.ts`
 * simula la semántica del `UNIQUE` con un `Set`, en un solo hilo — nunca
 * hay una carrera real ahí). Aquí sí hay dos transacciones concurrentes de
 * verdad contra la misma base, y es el propio `UNIQUE(conversation_id,
 * idempotency_key)` de Postgres quien decide cuál gana.
 *
 * Se salta sola si no hay `TEST_DATABASE_URL` — en el entorno donde se
 * escribió este archivo NO estaba configurada, así que esta parte
 * transaccional real queda pendiente de ejecución; no se afirma que corrió.
 */

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let db: ReturnType<Modulos["getDb"]>;
let registrarConfirmacionDePedido: typeof import("@/server/ai/confirmacion-de-pedido").registrarConfirmacionDePedido;

const ORG = "org_test_notify_order";
const CONTACT = "ct_test_notify_order";
const CONVERSATION = "cv_test_notify_order";

describe.skipIf(!hayBase)("idempotencia de notify_order (Postgres real)", () => {
  beforeAll(async () => {
    const m = await cargarConBaseDePruebas();
    db = m.getDb();
    registrarConfirmacionDePedido = (await import("@/server/ai/confirmacion-de-pedido"))
      .registrarConfirmacionDePedido;

    await db.execute(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${ORG}, 'Test Notify Order', 'test-notify-order', now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at)
      VALUES (${CONTACT}, ${ORG}, '570000008888', 'Test', now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO conversation (id, organization_id, contact_id, created_at)
      VALUES (${CONVERSATION}, ${ORG}, ${CONTACT}, now())
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM order_confirmation WHERE organization_id = ${ORG}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM order_confirmation WHERE organization_id = ${ORG}`);
    await db.execute(sql`DELETE FROM conversation WHERE id = ${CONVERSATION}`);
    await db.execute(sql`DELETE FROM contact WHERE id = ${CONTACT}`);
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`);
  });

  it("dos transacciones CONCURRENTES insertando el mismo pedido (mismo mensaje disparador) — exactamente una gana, la otra ve el conflicto real de Postgres", async () => {
    const input = { organizationId: ORG, conversationId: CONVERSATION, messageIds: ["msg_test_1"] };

    const [a, b] = await Promise.all([
      registrarConfirmacionDePedido(input),
      registrarConfirmacionDePedido(input),
    ]);

    expect([a.primeraVez, b.primeraVez].filter(Boolean)).toHaveLength(1);

    const filas = (await db.execute(sql`
      SELECT count(*)::int AS n FROM order_confirmation WHERE conversation_id = ${CONVERSATION}
    `)) as unknown as Array<{ n: number }>;
    expect(filas[0]!.n).toBe(1);
  });

  it("diez llamadas concurrentes al mismo mensaje disparador — Postgres deja pasar exactamente una", async () => {
    const input = { organizationId: ORG, conversationId: CONVERSATION, messageIds: ["msg_test_2"] };

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => registrarConfirmacionDePedido(input))
    );

    expect(resultados.filter((r) => r.primeraVez)).toHaveLength(1);
  });

  it("un pedido distinto en la misma conversación (otro mensaje disparador) sí se registra aparte (no lo bloquea el anterior)", async () => {
    await registrarConfirmacionDePedido({
      organizationId: ORG,
      conversationId: CONVERSATION,
      messageIds: ["msg_test_3"],
    });
    const otro = await registrarConfirmacionDePedido({
      organizationId: ORG,
      conversationId: CONVERSATION,
      messageIds: ["msg_test_4"],
    });

    expect(otro.primeraVez).toBe(true);
  });
});
