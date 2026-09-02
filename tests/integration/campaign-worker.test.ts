import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * El motor y el worker de campañas de punta a punta, contra Postgres real
 * (Fase 6A). El proveedor SIEMPRE es un mock inyectado — en ningún momento
 * de este archivo se llama a YCloud/Meta reales.
 */

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;

const ORG_A = "org_test_campworker_a";
const ORG_B = "org_test_campworker_b";
const TPL_A = "tpl_test_campworker_a";

async function limpiar() {
  for (const org of [ORG_A, ORG_B]) {
    await db.execute(sql`DELETE FROM message WHERE organization_id = ${org}`);
    await db.execute(sql`DELETE FROM campaign_send_job WHERE organization_id = ${org}`);
    await db.execute(sql`DELETE FROM campaign_recipient WHERE organization_id = ${org}`);
    await db.execute(sql`DELETE FROM campaign WHERE organization_id = ${org}`);
    await db.execute(sql`DELETE FROM conversation WHERE organization_id = ${org}`);
    await db.execute(sql`DELETE FROM contact WHERE organization_id = ${org}`);
    await db.execute(sql`DELETE FROM template WHERE organization_id = ${org}`);
  }
}

let n = 0;
async function crearCampanaLista(org = ORG_A, templateId = TPL_A) {
  n += 1;
  const { campaignMotor } = m;
  const { id } = await campaignMotor.crearCampana({
    organizationId: org,
    name: `Campaña test ${n}`,
    templateId,
  });
  await campaignMotor.prepararCampana(org, id);
  return id;
}

function proveedorMock(resultado: unknown) {
  return async () => resultado as never;
}

describe.skipIf(!hayBase)("motor y worker de campañas (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();
    for (const org of [ORG_A, ORG_B]) {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, created_at)
        VALUES (${org}, 'Test Camp Worker', ${org}, now())
        ON CONFLICT (id) DO NOTHING
      `);
    }
    await db.execute(sql`
      INSERT INTO template (id, organization_id, name, language, category, body, status, created_at, updated_at)
      VALUES (${TPL_A}, ${ORG_A}, 'seguimiento', 'es', 'MARKETING', 'Hola {{1}}', 'approved', now(), now())
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await limpiar();
    await db.execute(sql`
      INSERT INTO template (id, organization_id, name, language, category, body, status, created_at, updated_at)
      VALUES (${TPL_A}, ${ORG_A}, 'seguimiento', 'es', 'MARKETING', 'Hola {{1}}', 'approved', now(), now())
      ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    await limpiar();
  });

  it("A — campaign → recipients → jobs: iniciar una campaña materializa audiencia y encola jobs reales", async () => {
    const ct = "ct_a_a1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050001', 'Cliente A1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const recipients = (await db.execute(
      sql`SELECT id, status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string; status: string }>;
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.status).toBe("pending");

    const jobs = (await db.execute(
      sql`SELECT id FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;
    expect(jobs).toHaveLength(1);
  });

  it("B — dos workers, mismo job: solo uno obtiene el claim (SKIP LOCKED real, ya validado en Fase 4D)", async () => {
    const ct = "ct_a_b1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050002', 'Cliente B1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const [a, b] = await Promise.all([
      m.campaignWorker.procesarUnEnvioDeCampana({ worker: "wA", proveedor: proveedorMock({ kind: "AMBIGUOUS_FAILURE", error: "no importa", causa: null }) }),
      m.campaignWorker.procesarUnEnvioDeCampana({ worker: "wB", proveedor: proveedorMock({ kind: "AMBIGUOUS_FAILURE", error: "no importa", causa: null }) }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    // Uno procesó el único job real (queda "ambiguo"), el otro no encontró nada.
    expect(outcomes).toEqual(["ambiguo", "sin_trabajo"]);
  });

  it("C — opt-out cambiado DESPUÉS de crear el recipient: el worker lo salta sin llamar al proveedor", async () => {
    const ct = "ct_a_c1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050003', 'Cliente C1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    // El opt-out llega DESPUÉS de que el recipient ya existía en la campaña.
    await db.execute(sql`UPDATE contact SET marketing_opt_out = true, marketing_opt_out_at = now() WHERE id = ${ct}`);

    let llamado = false;
    const proveedor = async () => {
      llamado = true;
      return { kind: "SUCCESS", waMessageId: "no_deberia_pasar", renderedText: "x" } as never;
    };
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado.outcome).toBe("omitido_opt_out");
    expect(llamado).toBe(false);

    const [recipient] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(recipient!.status).toBe("skipped");
  });

  it("D — SUCCESS del mock: recipient=sent, message creado, job cerrado", async () => {
    const ct = "ct_a_d1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050004', 'Cliente D1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const proveedor = proveedorMock({
      kind: "SUCCESS",
      waMessageId: "wamid.integ.d1",
      renderedText: "Hola Cliente D1",
    });
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado.outcome).toBe("enviado");

    const [recipient] = (await db.execute(
      sql`SELECT status, message_id FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string; message_id: string | null }>;
    expect(recipient!.status).toBe("sent");
    expect(recipient!.message_id).not.toBeNull();

    const [msg] = (await db.execute(
      sql`SELECT wa_message_id FROM message WHERE id = ${recipient!.message_id}`
    )) as unknown as Array<{ wa_message_id: string }>;
    expect(msg!.wa_message_id).toBe("wamid.integ.d1");

    const jobs = (await db.execute(
      sql`SELECT id FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;
    expect(jobs).toHaveLength(0); // cerrado, igual que agent_job
  });

  it("E — EXPLICIT_FAILURE retryable=true: recipient queda pending para reintento (intentos restantes)", async () => {
    const ct = "ct_a_e1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050005', 'Cliente E1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const proveedor = proveedorMock({
      kind: "EXPLICIT_FAILURE",
      error: "rate limited (429)",
      retryable: true,
      causa: null,
    });
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado.outcome).toBe("fallido");

    const [recipient] = (await db.execute(
      sql`SELECT status, error FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string; error: string | null }>;
    // attempts=1 tras el primer claim, MAX_INTENTOS_CAMPANA=2, retryable=true → reintenta.
    expect(recipient!.status).toBe("pending");
    expect(recipient!.error).toContain("rate limited");

    // La campaña sigue con trabajo activo (el recipient volvió a pending):
    // NUNCA se completa mientras haya algo por reintentar.
    const [campana] = (await db.execute(
      sql`SELECT status FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(campana!.status).toBe("processing");
  });

  // Fase 6C, hallazgo #4 de la Fase 6B: antes esto se reintentaba igual que
  // un 429, aunque el proveedor certificara que reintentar no tiene caso.
  it("E2 — EXPLICIT_FAILURE retryable=false: falla definitivo AUNQUE queden intentos, y completa la campaña", async () => {
    const ct = "ct_a_e2";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050013', 'Cliente E2', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const proveedor = proveedorMock({
      kind: "EXPLICIT_FAILURE",
      error: "número inválido (400)",
      retryable: false,
      causa: null,
    });
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado.outcome).toBe("fallido");

    const [recipient] = (await db.execute(
      sql`SELECT status, error FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string; error: string | null }>;
    // attempts=1, muy por debajo de MAX_INTENTOS_CAMPANA=2 — pero retryable=false
    // cierra definitivo igual: NUNCA vuelve a pending.
    expect(recipient!.status).toBe("failed");
    expect(recipient!.error).toContain("número inválido");

    const jobs = (await db.execute(
      sql`SELECT status FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("fallido");

    // El job cerró para siempre: era el único recipient — la campaña se completa sola.
    const [campana] = (await db.execute(
      sql`SELECT status FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(campana!.status).toBe("completed");
  });

  it("F — AMBIGUOUS_FAILURE: recipient permanece sending, recovery posterior lo pasa a indeterminado", async () => {
    const ct = "ct_a_f1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050006', 'Cliente F1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const proveedor = proveedorMock({ kind: "AMBIGUOUS_FAILURE", error: "timeout", causa: null });
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado.outcome).toBe("ambiguo");

    const [antes] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(antes!.status).toBe("sending");

    await db.execute(sql`UPDATE campaign_send_job SET locked_at = now() - interval '10 minutes' WHERE campaign_id = ${campaignId}`);
    const recovery = await m.campaignRecovery.rescatarHuerfanosDeCampana(0);
    expect(recovery.marcadosIndeterminado).toBe(1);

    const [despues] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(despues!.status).toBe("indeterminado");
  });

  it("G — reconexión requerida: pausa la campaña, no procesa el resto de destinatarios", async () => {
    const ct1 = "ct_a_g1";
    const ct2 = "ct_a_g2";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct1}, ${ORG_A}, '570000050007', 'Cliente G1', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct2}, ${ORG_A}, '570000050008', 'Cliente G2', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const { TemplateError } = await import("@/server/whatsapp/templates");
    const proveedorQueFalla = async () => {
      throw new TemplateError("reconnect_required", "reconecta el número");
    };
    const primero = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor: proveedorQueFalla });
    expect(primero.outcome).toBe("reconexion_requerida");

    const [campana] = (await db.execute(
      sql`SELECT status FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(campana!.status).toBe("paused");

    // El segundo destinatario NUNCA llega al proveedor: la campaña ya no está processing.
    let llamadoDeNuevo = false;
    const proveedorQueNoDeberiaLlamarse = async () => {
      llamadoDeNuevo = true;
      return { kind: "SUCCESS", waMessageId: "x", renderedText: "x" } as never;
    };
    const segundo = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorQueNoDeberiaLlamarse,
    });
    expect(segundo.outcome).toBe("campana_no_activa");
    expect(llamadoDeNuevo).toBe(false);
  });

  it("H — multi-tenant: iniciar la campaña de A nunca crea recipients con contactos de B", async () => {
    const ctA = "ct_a_h1";
    const ctB = "ct_b_h1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ctA}, ${ORG_A}, '570000050009', 'Cliente A H1', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ctB}, ${ORG_B}, '570000050010', 'Cliente B H1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const recipients = (await db.execute(
      sql`SELECT contact_id FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ contact_id: string }>;
    expect(recipients.map((r) => r.contact_id)).toEqual([ctA]);
    expect(recipients.map((r) => r.contact_id)).not.toContain(ctB);
  });

  it("I — Fase 6B, hallazgo #1: el snapshot congelado NO cambia aunque el template original se edite después de ready, pero el worker sigue usando templateId vivo", async () => {
    const campaignId = await crearCampanaLista();

    const [campanaListaAntes] = (await db.execute(
      sql`SELECT template_snapshot FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ template_snapshot: { body: string } }>;
    expect(campanaListaAntes!.template_snapshot.body).toBe("Hola {{1}}");

    // T2: alguien edita el template original DESPUÉS de que la campaña ya
    // congeló su snapshot en "ready" — simula createTemplate() reescribiendo
    // el mismo id con body nuevo (en la práctica pondría status='pending',
    // aquí se deja 'approved' a propósito para aislar la pregunta: ¿el
    // snapshot se entera del cambio, o no?).
    await db.execute(sql`
      UPDATE template SET body = 'Promo B: 50% de descuento {{1}}', updated_at = now()
      WHERE id = ${TPL_A}
    `);

    const [campanaDespues] = (await db.execute(
      sql`SELECT template_snapshot FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ template_snapshot: { body: string } }>;
    // El snapshot es inmutable en sí mismo: sigue diciendo "promoción A".
    expect(campanaDespues!.template_snapshot.body).toBe("Hola {{1}}");

    const [templateActual] = (await db.execute(
      sql`SELECT body FROM template WHERE id = ${TPL_A}`
    )) as unknown as Array<{ body: string }>;
    // Pero el contenido real quedó desincronizado: "promoción B".
    expect(templateActual!.body).toBe("Promo B: 50% de descuento {{1}}");
    expect(templateActual!.body).not.toBe(campanaDespues!.template_snapshot.body);

    // Confirmación del hallazgo #1 en sí: worker.ts pasa `campana.templateId`
    // (constante) al proveedor — nunca `campana.templateSnapshot` — así que
    // en producción sería `enviarTemplateAlProveedor` (Fase 5C, no tocado
    // aquí) quien re-consulte `template` en vivo y use el body B, no el
    // snapshot congelado.
    const [campanaRow] = (await db.execute(
      sql`SELECT template_id FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ template_id: string }>;
    expect(campanaRow!.template_id).toBe(TPL_A);
  });

  it("J — mismo contacto en dos campañas distintas: misma conversación, sin cruce de campaignId/messageId", async () => {
    const ct = "ct_a_j1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050011', 'Cliente J1', now(), now())
    `);
    const campaignA = await crearCampanaLista();
    const campaignB = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignA);
    await m.campaignMotor.iniciarCampana(ORG_A, campaignB);

    const resultadoA = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorMock({ kind: "SUCCESS", waMessageId: "wamid.j.a", renderedText: "Hola A" }),
    });
    expect(resultadoA.outcome).toBe("enviado");

    const resultadoB = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorMock({ kind: "SUCCESS", waMessageId: "wamid.j.b", renderedText: "Hola B" }),
    });
    expect(resultadoB.outcome).toBe("enviado");

    const recipients = (await db.execute(
      sql`SELECT campaign_id, conversation_id, message_id FROM campaign_recipient WHERE contact_id = ${ct} ORDER BY campaign_id`
    )) as unknown as Array<{ campaign_id: string; conversation_id: string; message_id: string }>;
    expect(recipients).toHaveLength(2);
    // Misma conversación para el mismo contacto: no se duplica.
    expect(recipients[0]!.conversation_id).toBe(recipients[1]!.conversation_id);
    // Pero cada recipient/mensaje es independiente: sin cruce de campaignId ni messageId.
    expect(recipients[0]!.campaign_id).not.toBe(recipients[1]!.campaign_id);
    expect(recipients[0]!.message_id).not.toBe(recipients[1]!.message_id);

    const conversations = (await db.execute(
      sql`SELECT id FROM conversation WHERE contact_id = ${ct}`
    )) as unknown as Array<{ id: string }>;
    expect(conversations).toHaveLength(1);
  });

  it("K — campaña pausada manualmente (no por reconexión): el job reclamado se revierte, el proveedor nunca se llama", async () => {
    const ct = "ct_a_k1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050012', 'Cliente K1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    // Alguien pausa la campaña ANTES de que un worker llegue a procesarla —
    // el job ya existe en 'pendiente' en la tabla.
    await m.campaignMotor.pausarCampana(ORG_A, campaignId);

    let llamado = false;
    const proveedor = async () => {
      llamado = true;
      return { kind: "SUCCESS", waMessageId: "no_deberia_pasar", renderedText: "x" } as never;
    };
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor });
    expect(resultado.outcome).toBe("campana_no_activa");
    expect(llamado).toBe(false);

    const [recipient] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(recipient!.status).toBe("pending");

    const [job] = (await db.execute(
      sql`SELECT status, locked_at, locked_by FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string; locked_at: string | null; locked_by: string | null }>;
    expect(job!.status).toBe("pendiente");
    expect(job!.locked_at).toBeNull();
    expect(job!.locked_by).toBeNull();
  });

  it("L — timeout: sin timeoutMs explícito usa TIMEOUT_ENVIO_CAMPANA_MS; con timeoutMs explícito, lo respeta", async () => {
    const ct1 = "ct_a_l1";
    const ct2 = "ct_a_l2";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct1}, ${ORG_A}, '570000050014', 'Cliente L1', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct2}, ${ORG_A}, '570000050015', 'Cliente L2', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const timeoutsRecibidos: Array<number | undefined> = [];
    const proveedorQueCaptura = async (input: { timeoutMs?: number }) => {
      timeoutsRecibidos.push(input.timeoutMs);
      return { kind: "SUCCESS", waMessageId: `wamid.l.${timeoutsRecibidos.length}`, renderedText: "x" } as never;
    };

    await m.campaignWorker.procesarUnEnvioDeCampana({ worker: "w1", proveedor: proveedorQueCaptura });
    expect(timeoutsRecibidos[0]).toBe(m.campaignWorker.TIMEOUT_ENVIO_CAMPANA_MS);

    await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorQueCaptura,
      timeoutMs: 5_000,
    });
    expect(timeoutsRecibidos[1]).toBe(5_000);
  });

  it("M — contentSnapshot: el worker pasa el snapshot congelado, NUNCA el template.body editado después de ready", async () => {
    const ct = "ct_a_m1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050016', 'Cliente M1', now(), now())
    `);
    const campaignId = await crearCampanaLista(); // congela snapshot con body "Hola {{1}}"

    // T2: alguien edita el template original DESPUÉS de "ready", antes de iniciar.
    await db.execute(sql`
      UPDATE template SET body = 'Contenido editado después de ready {{1}}', updated_at = now()
      WHERE id = ${TPL_A}
    `);
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    let snapshotRecibido: { name: string; language: string; body: string } | null = null;
    const proveedorQueCaptura = async (input: {
      contentSnapshot: { name: string; language: string; body: string };
    }) => {
      snapshotRecibido = input.contentSnapshot;
      return { kind: "SUCCESS", waMessageId: "wamid.m", renderedText: "x" } as never;
    };
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorQueCaptura,
    });
    expect(resultado.outcome).toBe("enviado");
    expect(snapshotRecibido).toEqual({ name: "seguimiento", language: "es", body: "Hola {{1}}" });
  });

  it("N — reanudarCampana: paused → processing, y el trabajo pendiente se procesa después de reanudar", async () => {
    const ct = "ct_a_n1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050017', 'Cliente N1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);
    await m.campaignMotor.pausarCampana(ORG_A, campaignId);

    const revertida = await m.campaignMotor.reanudarCampana(ORG_A, campaignId);
    expect(revertida.status).toBe("processing");

    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorMock({ kind: "SUCCESS", waMessageId: "wamid.n", renderedText: "x" }),
    });
    expect(resultado.outcome).toBe("enviado");
  });

  it("N2 — reanudarCampana rechaza desde cualquier estado que no sea paused", async () => {
    const campaignId = await crearCampanaLista(); // queda en "ready", no "paused"
    await expect(m.campaignMotor.reanudarCampana(ORG_A, campaignId)).rejects.toThrow(
      /solo aplica desde "paused"/
    );
  });

  it("O — reconexión + reanudación manual: el ciclo completo processing → paused → processing procesa al resto", async () => {
    const ct1 = "ct_a_o1";
    const ct2 = "ct_a_o2";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct1}, ${ORG_A}, '570000050018', 'Cliente O1', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct2}, ${ORG_A}, '570000050019', 'Cliente O2', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const { TemplateError } = await import("@/server/whatsapp/templates");
    const primero = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: async () => {
        throw new TemplateError("reconnect_required", "reconecta el número");
      },
    });
    expect(primero.outcome).toBe("reconexion_requerida");

    const [pausada] = (await db.execute(
      sql`SELECT status FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(pausada!.status).toBe("paused");

    // Reanudación EXPLÍCITA de un operador — nunca automática.
    await m.campaignMotor.reanudarCampana(ORG_A, campaignId);

    const segundo = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: proveedorMock({ kind: "SUCCESS", waMessageId: "wamid.o", renderedText: "x" }),
    });
    expect(segundo.outcome).toBe("enviado");
  });

  it("P — rate limit: pospone run_at de forma razonable (la ventana configurada), no lo deja disponible de inmediato", async () => {
    const ct = "ct_a_p1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, '570000050020', 'Cliente P1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    let llamado = false;
    const resultado = await m.campaignWorker.procesarUnEnvioDeCampana({
      worker: "w1",
      proveedor: async () => {
        llamado = true;
        return { kind: "SUCCESS", waMessageId: "no_deberia_pasar", renderedText: "x" } as never;
      },
      rateLimit: { windowMs: 60_000, max: 0 }, // max:0 → siempre bloqueado
    });
    expect(resultado.outcome).toBe("rate_limited");
    expect(llamado).toBe(false);

    const [job] = (await db.execute(
      sql`SELECT status, run_at, (run_at > now() + interval '30 seconds') AS pospuesto FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string; run_at: string; pospuesto: boolean }>;
    expect(job!.status).toBe("pendiente");
    expect(job!.pospuesto).toBe(true); // no disponible de inmediato

    const [recipient] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(recipient!.status).toBe("pending"); // nunca failed
  });

  it("Q — race de completion: dos workers cerrando el penúltimo y el último recipient a la vez completan la campaña UNA sola vez", async () => {
    const ct1 = "ct_a_q1";
    const ct2 = "ct_a_q2";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct1}, ${ORG_A}, '570000050021', 'Cliente Q1', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct2}, ${ORG_A}, '570000050022', 'Cliente Q2', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const jobsAntes = (await db.execute(
      sql`SELECT id FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;
    expect(jobsAntes).toHaveLength(2); // la premisa de la carrera: dos jobs reales

    const [a, b] = await Promise.all([
      m.campaignWorker.procesarUnEnvioDeCampana({
        worker: "wA",
        proveedor: proveedorMock({ kind: "SUCCESS", waMessageId: "wamid.q.a", renderedText: "x" }),
      }),
      m.campaignWorker.procesarUnEnvioDeCampana({
        worker: "wB",
        proveedor: proveedorMock({ kind: "SUCCESS", waMessageId: "wamid.q.b", renderedText: "x" }),
      }),
    ]);
    expect([a.outcome, b.outcome]).toEqual(["enviado", "enviado"]);

    const [campana] = (await db.execute(
      sql`SELECT status, finished_at FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ status: string; finished_at: string | null }>;
    expect(campana!.status).toBe("completed");
    expect(campana!.finished_at).not.toBeNull();

    const recipientsPendientes = (await db.execute(
      sql`SELECT id FROM campaign_recipient WHERE campaign_id = ${campaignId} AND status NOT IN ('sent')`
    )) as unknown as Array<{ id: string }>;
    expect(recipientsPendientes).toHaveLength(0);

    const jobsRestantes = (await db.execute(
      sql`SELECT id FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;
    expect(jobsRestantes).toHaveLength(0);
  });

  it("R — Fase 7B, test OBLIGATORIO 'solo uno': procesarUnEnvioControladoDeCampana con 3 recipients reales procesa EXACTAMENTE 1, nunca los otros 2", async () => {
    const ct1 = "ct_a_r1";
    const ct2 = "ct_a_r2";
    const ct3 = "ct_a_r3";
    for (const [ct, phone, name] of [
      [ct1, "570000050023", "Cliente R1"],
      [ct2, "570000050024", "Cliente R2"],
      [ct3, "570000050025", "Cliente R3"],
    ] as const) {
      await db.execute(sql`
        INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
        VALUES (${ct}, ${ORG_A}, ${phone}, ${name}, now(), now())
      `);
    }
    const campaignId = await crearCampanaLista();
    // Camino NORMAL (no el controlado): materializa los 3 contactos elegibles
    // de la organización, a propósito, para probar la garantía sobre una
    // campaña con más de un destinatario real.
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const recipientsAntes = (await db.execute(
      sql`SELECT id FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;
    expect(recipientsAntes).toHaveLength(3);

    // Los 3 jobs se crearon en la misma transacción, con el mismo `run_at`
    // (Postgres resuelve `now()` una sola vez por transacción) — el claim
    // real (`ORDER BY run_at`, sin desempate) no tiene un orden determinista
    // entre ellos. Se escalona explícitamente para poder predecir CUÁL será
    // el primero, y así probar la garantía real: que el resto NUNCA se toque.
    await db.execute(sql`
      WITH numerados AS (
        SELECT id, row_number() OVER (ORDER BY id) AS n
          FROM campaign_send_job WHERE campaign_id = ${campaignId}
      )
      UPDATE campaign_send_job j
         SET run_at = now() - ((4 - numerados.n) || ' seconds')::interval
        FROM numerados
       WHERE j.id = numerados.id
    `);

    const [primerJob] = (await db.execute(
      sql`SELECT recipient_id FROM campaign_send_job WHERE campaign_id = ${campaignId} ORDER BY run_at LIMIT 1`
    )) as unknown as Array<{ recipient_id: string }>;
    const recipientEsperado = primerJob!.recipient_id;

    let llamadas = 0;
    const proveedor = async () => {
      llamadas++;
      return { kind: "SUCCESS", waMessageId: "wamid.r", renderedText: "x" } as never;
    };

    const resultado = await m.campaignPruebaControlada.procesarUnEnvioControladoDeCampana({
      organizationId: ORG_A,
      campaignId,
      recipientId: recipientEsperado,
      proveedor,
    });
    expect(resultado.outcome).toBe("enviado");
    expect(llamadas).toBe(1);

    const recipientsDespues = (await db.execute(
      sql`SELECT id, status FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string; status: string }>;
    expect(recipientsDespues.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(recipientsDespues.filter((r) => r.status === "pending")).toHaveLength(2);
    expect(recipientsDespues.find((r) => r.id === recipientEsperado)!.status).toBe("sent");

    const jobsDespues = (await db.execute(
      sql`SELECT recipient_id, status, locked_at FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ recipient_id: string; status: string; locked_at: string | null }>;
    // El job del recipient enviado se cerró (borrado); los otros dos ni
    // siquiera se reclamaron — nunca tocados.
    expect(jobsDespues).toHaveLength(2);
    for (const job of jobsDespues) {
      expect(job.recipient_id).not.toBe(recipientEsperado);
      expect(job.status).toBe("pendiente");
      expect(job.locked_at).toBeNull();
    }
  });

  it("S — Fase 7B, multi-tenant: organización B no puede procesar ni preparar nada de una campaña de la organización A", async () => {
    const ctA = "ct_a_s1";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ctA}, ${ORG_A}, '570000050026', 'Cliente S1', now(), now())
    `);
    const campaignId = await crearCampanaLista();
    await m.campaignMotor.iniciarCampana(ORG_A, campaignId);

    const [recipientA] = (await db.execute(
      sql`SELECT id FROM campaign_recipient WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;

    let llamado = false;
    const proveedor = async () => {
      llamado = true;
      return { kind: "SUCCESS", waMessageId: "no_deberia_pasar", renderedText: "x" } as never;
    };

    // organizationId = B, pero campaignId/recipientId son de A.
    const resultado = await m.campaignPruebaControlada.procesarUnEnvioControladoDeCampana({
      organizationId: ORG_B,
      campaignId,
      recipientId: recipientA!.id,
      proveedor,
    });
    // El claim acotado (organizationId+campaignId) de B nunca encuentra el
    // job real de A — aborta ANTES de escribir o llamar a nada.
    expect(resultado.outcome).toBe("sin_trabajo");
    expect(llamado).toBe(false);

    const [recipientDespues] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE id = ${recipientA!.id}`
    )) as unknown as Array<{ status: string }>;
    expect(recipientDespues!.status).toBe("pending");
    const [jobDespues] = (await db.execute(
      sql`SELECT status, locked_at FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ status: string; locked_at: string | null }>;
    expect(jobDespues!.status).toBe("pendiente");
    expect(jobDespues!.locked_at).toBeNull();

    // El camino de PREPARACIÓN también debe rechazar cross-tenant: una
    // campaña nueva de A, pero materializada con organizationId de B.
    const campaignId2 = await crearCampanaLista();
    const ctPrueba = "ct_a_s2";
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ctPrueba}, ${ORG_A}, '570000050027', 'Cliente S2', now(), now())
    `);
    const err = await m.campaignPruebaControlada
      .materializarAudienciaUnica({ organizationId: ORG_B, campaignId: campaignId2, contactId: ctPrueba })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(m.campaignPruebaControlada.PruebaControladaError);
    expect((err as { code: string }).code).toBe("not_found");

    const recipientsCreados = (await db.execute(
      sql`SELECT id FROM campaign_recipient WHERE campaign_id = ${campaignId2}`
    )) as unknown as Array<{ id: string }>;
    expect(recipientsCreados).toHaveLength(0);
  });

  /**
   * Fase 8A: el EJECUTOR — deja un recipient en READY_TO_SEND exactamente
   * como lo dejaría `scripts/primer-envio-controlado.ts --confirmar-unico-envio`,
   * usando el mismo camino de preparación (`prueba-controlada.ts`, sin tocar).
   */
  async function prepararReadyToSend(ct: string, phone: string, name: string) {
    await db.execute(sql`
      INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
      VALUES (${ct}, ${ORG_A}, ${phone}, ${name}, now(), now())
    `);
    const campaignId = await crearCampanaLista();
    const { recipientId } = await m.campaignPruebaControlada.materializarAudienciaUnica({
      organizationId: ORG_A,
      campaignId,
      contactId: ct,
    });
    await m.campaignPruebaControlada.encolarJobUnicoDeCampana({
      organizationId: ORG_A,
      campaignId,
      recipientId,
    });
    await m.campaignPruebaControlada.activarCampanaParaPruebaControlada(ORG_A, campaignId);
    return { campaignId, recipientId };
  }

  it("U — Fase 8A, test OBLIGATORIO 'exactamente un POST': ejecución completa, 1 llamada, 1 message, job cerrado, campaña completa", async () => {
    const { campaignId, recipientId } = await prepararReadyToSend("ct_a_u1", "570000050028", "Cliente U1");

    let llamadas = 0;
    const proveedor = async () => {
      llamadas++;
      return { kind: "SUCCESS", waMessageId: "wamid.u1", renderedText: "Hola Cliente U1" } as never;
    };

    const ejecucion = await m.campaignEjecutarPrimerEnvio.ejecutarPrimerEnvioControlado({
      organizationId: ORG_A,
      campaignId,
      recipientId,
      proveedor,
    });
    expect(ejecucion.resultado.outcome).toBe("enviado");
    expect(llamadas).toBe(1); // exactamente un POST — no dos, no cero

    const [recipient] = (await db.execute(
      sql`SELECT status, message_id FROM campaign_recipient WHERE id = ${recipientId}`
    )) as unknown as Array<{ status: string; message_id: string | null }>;
    expect(recipient!.status).toBe("sent");
    expect(recipient!.message_id).not.toBeNull();

    const messages = (await db.execute(
      sql`SELECT wa_message_id FROM message WHERE id = ${recipient!.message_id}`
    )) as unknown as Array<{ wa_message_id: string }>;
    expect(messages).toHaveLength(1); // un único message
    expect(messages[0]!.wa_message_id).toBe("wamid.u1");

    const jobs = (await db.execute(
      sql`SELECT id FROM campaign_send_job WHERE campaign_id = ${campaignId}`
    )) as unknown as Array<{ id: string }>;
    expect(jobs).toHaveLength(0); // job cerrado, sin segundo intento interno posible

    const [campana] = (await db.execute(
      sql`SELECT status FROM campaign WHERE id = ${campaignId}`
    )) as unknown as Array<{ status: string }>;
    expect(campana!.status).toBe("completed"); // era el único recipient
  });

  it("V — Fase 8A, doble ejecución: la segunda NUNCA genera una segunda llamada al proveedor", async () => {
    const { campaignId, recipientId } = await prepararReadyToSend("ct_a_v1", "570000050029", "Cliente V1");

    let llamadas = 0;
    const proveedor = async () => {
      llamadas++;
      return { kind: "SUCCESS", waMessageId: "wamid.v1", renderedText: "x" } as never;
    };

    const primera = await m.campaignEjecutarPrimerEnvio.ejecutarPrimerEnvioControlado({
      organizationId: ORG_A,
      campaignId,
      recipientId,
      proveedor,
    });
    expect(primera.resultado.outcome).toBe("enviado");
    expect(llamadas).toBe(1);

    // Segunda ejecución del MISMO recipient — el precheck debe rechazarla
    // ANTES de siquiera intentar el claim. Como era el ÚNICO recipient de
    // la campaña, el éxito de la primera ejecución ya disparó
    // `intentarCompletarCampana` (Fase 6C) y dejó `campaign.status =
    // "completed"` — el precheck valida `campaign.status` ANTES que
    // `recipient.status`, así que el rechazo real es "invalid_transition"
    // (campaña ya no "processing"), no "already_processed" — ambos códigos
    // significan lo mismo en la práctica ("esto ya se resolvió, no
    // reintentar"), pero el orden de las validaciones hace que este sea el
    // que efectivamente dispara primero en este escenario concreto.
    const err = await m.campaignEjecutarPrimerEnvio
      .ejecutarPrimerEnvioControlado({ organizationId: ORG_A, campaignId, recipientId, proveedor })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(m.campaignEjecutarPrimerEnvio.EjecucionControladaError);
    expect((err as { code: string }).code).toBe("invalid_transition");
    expect(llamadas).toBe(1); // sigue en 1 — nunca llega a 2

    const [recipient] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE id = ${recipientId}`
    )) as unknown as Array<{ status: string }>;
    expect(recipient!.status).toBe("sent"); // intacto, no se tocó de nuevo
  });

  it("W — Fase 8A, multi-tenant: organización B no puede ejecutar ni precheckear un recipient de la organización A", async () => {
    const { campaignId, recipientId } = await prepararReadyToSend("ct_a_w1", "570000050030", "Cliente W1");

    let llamadas = 0;
    const proveedor = async () => {
      llamadas++;
      return { kind: "SUCCESS", waMessageId: "no_deberia_pasar", renderedText: "x" } as never;
    };

    const errPrecheck = await m.campaignEjecutarPrimerEnvio
      .precheckPrimerEnvioControlado({ organizationId: ORG_B, campaignId, recipientId })
      .catch((e: unknown) => e);
    expect(errPrecheck).toBeInstanceOf(m.campaignEjecutarPrimerEnvio.EjecucionControladaError);
    expect((errPrecheck as { code: string }).code).toBe("not_found");

    const errEjecucion = await m.campaignEjecutarPrimerEnvio
      .ejecutarPrimerEnvioControlado({ organizationId: ORG_B, campaignId, recipientId, proveedor })
      .catch((e: unknown) => e);
    expect(errEjecucion).toBeInstanceOf(m.campaignEjecutarPrimerEnvio.EjecucionControladaError);
    expect(llamadas).toBe(0);

    const [recipient] = (await db.execute(
      sql`SELECT status FROM campaign_recipient WHERE id = ${recipientId}`
    )) as unknown as Array<{ status: string }>;
    expect(recipient!.status).toBe("pending"); // intacto
  });
});
