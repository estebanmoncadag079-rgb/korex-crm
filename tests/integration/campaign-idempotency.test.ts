import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * La idempotencia de campañas contra Postgres real (Fase 4C, auditoría
 * 2-sep-2026) — lo que un mock en JS no puede probar de verdad: `SKIP
 * LOCKED` bajo concurrencia real, y que una transacción realmente revierte
 * entera cuando una de sus escrituras falla. Mismo motivo que
 * `tests/integration/cola-turnos.test.ts` para `agent_job`: el SQL **es**
 * la lógica aquí, un doble solo probaría el doble.
 */

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;

const ORG = "org_test_campanas";
const CONTACT = "ct_test_campanas";
const CONVERSATION = "cv_test_campanas";
const CAMPAIGN = "cmp_test_campanas";

let n = 0;
/** Un par recipient+job nuevo por test, para no pisarse entre pruebas. */
async function crearRecipientYJob(status: "pending" = "pending") {
  n += 1;
  const recipientId = `cmpr_test_${n}`;
  const jobId = `cmpj_test_${n}`;
  await db.execute(sql`
    INSERT INTO campaign_recipient
      (id, organization_id, campaign_id, contact_id, conversation_id, status, created_at, updated_at)
    VALUES
      (${recipientId}, ${ORG}, ${CAMPAIGN}, ${CONTACT}, ${CONVERSATION}, ${status}, now(), now())
  `);
  await db.execute(sql`
    INSERT INTO campaign_send_job
      (id, organization_id, campaign_id, recipient_id, status, run_at, attempts, created_at, updated_at)
    VALUES
      (${jobId}, ${ORG}, ${CAMPAIGN}, ${recipientId}, 'pendiente', now(), 0, now(), now())
  `);
  return { recipientId, jobId };
}

async function estadoRecipient(id: string) {
  const [fila] = (await db.execute(sql`
    SELECT status, message_id FROM campaign_recipient WHERE id = ${id}
  `)) as unknown as Array<{ status: string; message_id: string | null }>;
  return fila;
}

async function estadoJob(id: string) {
  const [fila] = (await db.execute(sql`
    SELECT status FROM campaign_send_job WHERE id = ${id}
  `)) as unknown as Array<{ status: string } | undefined>;
  return fila;
}

describe.skipIf(!hayBase)("idempotencia de campañas (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${ORG}, 'Test Campañas', 'test-campanas', now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at)
      VALUES (${CONTACT}, ${ORG}, '570000009999', 'Test', now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO conversation (id, organization_id, contact_id, created_at)
      VALUES (${CONVERSATION}, ${ORG}, ${CONTACT}, now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO campaign (id, organization_id, name, status, created_at, updated_at)
      VALUES (${CAMPAIGN}, ${ORG}, 'Campaña de prueba', 'ready', now(), now())
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM message WHERE organization_id = ${ORG}`);
    await db.execute(sql`DELETE FROM campaign_send_job WHERE organization_id = ${ORG}`);
    await db.execute(sql`DELETE FROM campaign_recipient WHERE organization_id = ${ORG}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM message WHERE organization_id = ${ORG}`);
    await db.execute(sql`DELETE FROM campaign_send_job WHERE organization_id = ${ORG}`);
    await db.execute(sql`DELETE FROM campaign_recipient WHERE organization_id = ${ORG}`);
  });

  it("dos workers, un solo job pendiente: solo uno lo reclama (SKIP LOCKED real)", async () => {
    const { recipientId } = await crearRecipientYJob();
    const [a, b] = await Promise.all([
      m.campaignCola.reclamarTrabajoDeCampana("worker-a"),
      m.campaignCola.reclamarTrabajoDeCampana("worker-b"),
    ]);
    const tomados = [a, b].filter(Boolean);
    expect(tomados).toHaveLength(1);
    expect(tomados[0]!.recipientId).toBe(recipientId);
  });

  it("el claim deja evidencia persistente: recipient pasa a sending ANTES de cualquier llamada externa", async () => {
    const { recipientId } = await crearRecipientYJob();
    const tomado = await m.campaignCola.reclamarTrabajoDeCampana("worker-a");
    expect(tomado).not.toBeNull();
    const estado = await estadoRecipient(recipientId);
    expect(estado!.status).toBe("sending");
  });

  it("atomicidad C — éxito completo: message y recipient se confirman juntos", async () => {
    const { recipientId, jobId } = await crearRecipientYJob();
    await m.campaignCola.reclamarTrabajoDeCampana("worker-a");

    const resultado = await m.campaignCola.registrarEnvioExitosoDeCampana({
      jobId,
      recipientId,
      organizationId: ORG,
      conversationId: CONVERSATION,
      waMessageId: `wamid.integ.${jobId}`,
      text: "hola, esto es una prueba",
    });

    const estado = await estadoRecipient(recipientId);
    expect(estado!.status).toBe("sent");
    expect(estado!.message_id).toBe(resultado.messageId);

    const [msg] = (await db.execute(sql`
      SELECT id, direction, type, ai_generated FROM message WHERE id = ${resultado.messageId}
    `)) as unknown as Array<{ id: string; direction: string; type: string; ai_generated: boolean }>;
    expect(msg).toBeDefined();
    expect(msg!.direction).toBe("out");
    expect(msg!.type).toBe("template");
    expect(msg!.ai_generated).toBe(false);

    // El job se cierra — mismo patrón que agent_job: el historial vive en
    // campaign_recipient/message, no en la cola.
    expect(await estadoJob(jobId)).toBeUndefined();
  });

  it("atomicidad A — waMessageId ya existente: la transacción entera revierte, el recipient NO queda sent", async () => {
    const { recipientId, jobId } = await crearRecipientYJob();
    await m.campaignCola.reclamarTrabajoDeCampana("worker-a");

    const wamidRepetido = `wamid.integ.duplicado.${jobId}`;
    // Un mensaje YA existe con ese wamid — simula que otro proceso (o un
    // reintento) ya lo insertó primero.
    await db.execute(sql`
      INSERT INTO message (id, organization_id, conversation_id, wa_message_id, direction, type, status, ai_generated, created_at)
      VALUES ('msg_test_previo', ${ORG}, ${CONVERSATION}, ${wamidRepetido}, 'out', 'template', 'sent', false, now())
    `);

    await expect(
      m.campaignCola.registrarEnvioExitosoDeCampana({
        jobId,
        recipientId,
        organizationId: ORG,
        conversationId: CONVERSATION,
        waMessageId: wamidRepetido,
        text: "hola",
      })
    ).rejects.toThrow();

    // Rollback real: el recipient sigue exactamente donde el claim lo dejó
    // (sending), NUNCA avanzó a sent sin su mensaje real.
    const estado = await estadoRecipient(recipientId);
    expect(estado!.status).toBe("sending");
    // Y el job JAMÁS se cerró — sigue disponible para diagnóstico, no se
    // perdió silenciosamente.
    expect((await estadoJob(jobId))?.status).toBe("corriendo");

    await db.execute(sql`DELETE FROM message WHERE id = 'msg_test_previo'`);
  });

  it("crash simulado: recipient queda en sending, el recovery lo pasa a indeterminado — NUNCA a pending, NUNCA reintenta", async () => {
    const { recipientId, jobId } = await crearRecipientYJob();
    const tomado = await m.campaignCola.reclamarTrabajoDeCampana("worker-que-muere");
    expect(tomado).not.toBeNull();

    // El worker "muere" aquí: nunca llama a registrarEnvioExitosoDeCampana
    // ni a registrarFalloEnvioDeCampana. Se simula el paso del tiempo.
    await db.execute(sql`
      UPDATE campaign_send_job SET locked_at = now() - interval '10 minutes' WHERE id = ${jobId}
    `);

    const resultado = await m.campaignRecovery.rescatarHuerfanosDeCampana(0);
    expect(resultado.marcadosIndeterminado).toBe(1);
    expect(resultado.recuperadosSeguro).toBe(0);

    const estado = await estadoRecipient(recipientId);
    expect(estado!.status).toBe("indeterminado");
    expect((await estadoJob(jobId))?.status).toBe("fallido");

    // Ningún worker puede volver a reclamarlo: ya no hay ningún job
    // "pendiente" para ese recipient — el índice único garantiza que no se
    // pueda crear uno nuevo por error mientras exista este.
    const reintento = await m.campaignCola.reclamarTrabajoDeCampana("worker-nuevo");
    expect(reintento).toBeNull();
  });

  it("race condition real (Fase 4F): recovery gana la carrera, un worker A tardío NO puede sobrescribir indeterminado", async () => {
    const { recipientId, jobId } = await crearRecipientYJob();

    // Worker A reclama de verdad — el recipient queda en `sending`.
    const tomado = await m.campaignCola.reclamarTrabajoDeCampana("worker-A-lento");
    expect(tomado).not.toBeNull();

    // Worker A ahora está "en camino" (llamando al proveedor real, en la
    // simulación esto es solo el paso del tiempo) cuando Worker B ejecuta el
    // recovery con timeout=0 y gana la carrera: el job ya luce huérfano.
    await db.execute(sql`
      UPDATE campaign_send_job SET locked_at = now() - interval '10 minutes' WHERE id = ${jobId}
    `);
    const recovery = await m.campaignRecovery.rescatarHuerfanosDeCampana(0);
    expect(recovery.marcadosIndeterminado).toBe(1);
    expect((await estadoRecipient(recipientId))!.status).toBe("indeterminado");

    // Worker A "vuelve" ahora, creyendo que su envío tuvo éxito, e intenta
    // persistirlo — la guardia de la Fase 4F debe rechazarlo.
    await expect(
      m.campaignCola.registrarEnvioExitosoDeCampana({
        jobId,
        recipientId,
        organizationId: ORG,
        conversationId: CONVERSATION,
        waMessageId: `wamid.race.${jobId}`,
        text: "este envío no debería registrarse",
      })
    ).rejects.toThrow(/ya no admite pasar a "sent"/);

    // El recipient permanece exactamente donde el recovery lo dejó.
    const estadoFinal = await estadoRecipient(recipientId);
    expect(estadoFinal!.status).toBe("indeterminado");
    expect(estadoFinal!.message_id).toBeNull();

    // No se creó/duplicó ningún message como consecuencia de ese intento.
    const filaConteo = (await db.execute(
      sql`SELECT count(*)::int AS n FROM message WHERE wa_message_id = ${`wamid.race.${jobId}`}`
    )) as unknown as Array<{ n: number }>;
    expect(filaConteo[0]!.n).toBe(0);

    // El job sigue cerrado por el recovery (fallido), no fue reabierto ni
    // eliminado incorrectamente por el intento tardío de A.
    expect((await estadoJob(jobId))?.status).toBe("fallido");
  });

  it("recovery caso A: recipient que nunca salió de pending vuelve la cola sin riesgo", async () => {
    const { recipientId, jobId } = await crearRecipientYJob();
    // Job tomado "a mano" (sin pasar por el claim real) para simular la
    // defensa ante una inconsistencia — el recipient nunca llegó a sending.
    await db.execute(sql`
      UPDATE campaign_send_job
         SET status = 'corriendo', locked_at = now() - interval '10 minutes', locked_by = 'worker-fantasma'
       WHERE id = ${jobId}
    `);

    const resultado = await m.campaignRecovery.rescatarHuerfanosDeCampana(0);
    expect(resultado.recuperadosSeguro).toBe(1);
    expect(resultado.marcadosIndeterminado).toBe(0);
    expect((await estadoJob(jobId))?.status).toBe("pendiente");
    expect((await estadoRecipient(recipientId))!.status).toBe("pending");
  });
});
