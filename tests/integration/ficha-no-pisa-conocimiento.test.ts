import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cargarConBaseDePruebas, hayBase } from "./_db";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * Aplicar la ficha NO puede pisar lo que el negocio escribió en su pantalla
 * (15-ago-2026).
 *
 * Hasta hoy `aplicarFicha` borraba `kb_entry` entero y lo reponía desde la
 * ficha. Se justificaba como "que no convivan dos versiones del mismo dato",
 * pero el efecto real era que el cuestionario y la pantalla de Conocimiento
 * preguntaban lo mismo y **el cuestionario ganaba en silencio**.
 *
 * Lo que costó: a Lashes Valen se le corrigió a mano una respuesta que prometía
 * que la extensión de pestañas no irrita los ojos —en un asunto de salud—, se
 * verificó contra el agente real y se dio por cerrada. Al enviar el
 * cuestionario volvió la respuesta vieja, porque la corrección estaba en la KB
 * y no en la ficha. Nadie se enteró: el borrado no avisa ni deja rastro.
 *
 * Va en integración porque lo que hay que demostrar es lo que queda **en la
 * base** después de la transacción, no lo que el código dice que hace.
 */

const F = {
  orgConKb: "org_test_kb_viva",
  orgSinKb: "org_test_kb_vacia",
  duenaA: "duena.kb.a@ejemplo-test.com",
  duenaB: "duena.kb.b@ejemplo-test.com",
  clave: "ClaveDeTest123",
};

/** Una ficha mínima pero completa: `aplicarFicha` rechaza las incompletas. */
const FICHA: FichaDelNegocio = {
  nombre: "Salón de Prueba",
  queVende: "Pestañas y cejas.",
  ubicacion: "Cali",
  horario: { dias: [1, 2, 3, 4, 5], abre: "09:00", cierra: "18:00" },
  vertical: "citas",
  catalogo: "",
  variantes: "",
  entrega: {
    haceDomicilios: false,
    como: "",
    quienPagaElDomicilio: "",
    restricciones: "",
    recogerEnLocal: "",
  },
  pago: { formas: "efectivo", compruebaUnaPersona: true },
  tono: "Cercano y amable.",
  regalos: "",
  saludoInicial: "¡Hola!",
  reglasPropias: [],
  preguntasFrecuentes: [
    { pregunta: "¿Me irrita los ojos?", respuesta: "Claro que no, tranquila." },
  ],
  escalarSiempre: ["Cualquier pregunta de salud"],
  nuncaPrometer: ["Que no habrá ninguna reacción"],
};

type Modulos = Awaited<ReturnType<typeof cargarConBaseDePruebas>>;
let m: Modulos;
let db: ReturnType<Modulos["getDb"]>;
let orgConKb: string;
let orgSinKb: string;

async function orgDe(email: string): Promise<string> {
  const filas = (await db.execute(sql`
    SELECT m.organization_id AS id FROM member m
      JOIN "user" u ON u.id = m.user_id
     WHERE u.email = ${email} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return filas[0]!.id;
}

async function conocimientoDe(
  orgId: string
): Promise<Array<{ question: string | null; answer: string | null }>> {
  return (await db.execute(sql`
    SELECT question, answer FROM kb_entry
     WHERE organization_id = ${orgId} ORDER BY created_at
  `)) as unknown as Array<{ question: string | null; answer: string | null }>;
}

describe.skipIf(!hayBase)("la ficha no pisa el conocimiento (Postgres real)", () => {
  beforeAll(async () => {
    m = await cargarConBaseDePruebas();
    db = m.getDb();

    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Con Conocimiento",
      slug: F.orgConKb,
      ownerName: "Dueña A",
      ownerEmail: F.duenaA,
      password: F.clave,
      needsAppointments: true,
    });
    await db.execute(sql`DELETE FROM rate_limit_hit`);
    await m.provisioning.createClientWithOwner({
      organizationName: "Sin Conocimiento",
      slug: F.orgSinKb,
      ownerName: "Dueña B",
      ownerEmail: F.duenaB,
      password: F.clave,
      needsAppointments: true,
    });

    orgConKb = await orgDe(F.duenaA);
    orgSinKb = await orgDe(F.duenaB);
  }, 120_000);

  afterAll(async () => {
    for (const email of [F.duenaA, F.duenaB]) {
      await db.execute(sql`
        DELETE FROM organization WHERE id IN (
          SELECT m.organization_id FROM member m
            JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email}
        )
      `);
      await db.execute(sql`DELETE FROM "user" WHERE email = ${email}`);
    }
  }, 60_000);

  it("NO borra la respuesta que el negocio corrigió a mano", async () => {
    // El caso de Lashes Valen, exactamente: la corrección vive en la KB y la
    // ficha todavía trae la versión vieja y peligrosa.
    await db.execute(sql`
      INSERT INTO kb_entry (id, organization_id, kind, question, answer)
      VALUES ('kb_test_corregida', ${orgConKb}, 'qa', '¿Me irrita los ojos?',
              'Eso lo revisa una persona del equipo antes de agendarte.')
    `);

    await m.generador.aplicarFicha(orgConKb, FICHA);

    const kb = await conocimientoDe(orgConKb);
    expect(kb).toHaveLength(1);
    expect(kb[0]!.answer).toBe(
      "Eso lo revisa una persona del equipo antes de agendarte."
    );
    // Y no ha entrado la de la ficha por detrás.
    expect(kb[0]!.answer).not.toContain("Claro que no");
  }, 60_000);

  it("sí siembra el conocimiento de un cliente que no tiene ninguno", async () => {
    // Que no borre no significa que el alta deje de servir: un cliente nuevo
    // sigue arrancando con lo que trajo en su ficha.
    expect(await conocimientoDe(orgSinKb)).toHaveLength(0);

    const res = await m.generador.aplicarFicha(orgSinKb, FICHA);

    expect(res.entradasDeConocimiento).toBe(1);
    const kb = await conocimientoDe(orgSinKb);
    expect(kb).toHaveLength(1);
    expect(kb[0]!.question).toBe("¿Me irrita los ojos?");
  }, 60_000);

  it("reenviar el cuestionario no duplica ni multiplica las entradas", async () => {
    // Sembrar "solo si está vacío" tiene que aguantar el segundo envío, que es
    // justo cuando el borrado viejo hacía su estropicio.
    await m.generador.aplicarFicha(orgSinKb, FICHA);
    await m.generador.aplicarFicha(orgSinKb, FICHA);

    expect(await conocimientoDe(orgSinKb)).toHaveLength(1);
  }, 60_000);

  it("no borra los teléfonos de aviso cuando no se le pasan", async () => {
    // Mismo borrado silencioso que el conocimiento: el negocio configura sus
    // avisos en la pantalla y reenviar el cuestionario los dejaba en NULL.
    await db.execute(sql`
      UPDATE agent_profile SET notify_phones = '573001112233'
       WHERE organization_id = ${orgConKb}
    `);

    await m.generador.aplicarFicha(orgConKb, FICHA);

    const filas = (await db.execute(sql`
      SELECT notify_phones FROM agent_profile WHERE organization_id = ${orgConKb}
    `)) as unknown as Array<{ notify_phones: string | null }>;
    expect(filas[0]!.notify_phones).toBe("573001112233");
  }, 60_000);

  it("el prompt sí se regenera: eso es lo que debe pisarse", async () => {
    // El contrapunto de todo lo anterior. La conducta es universal y se
    // reescribe a propósito; lo que no se toca es lo que escribió el negocio.
    await db.execute(sql`
      UPDATE agent_profile SET instructions = 'prompt viejo escrito a mano'
       WHERE organization_id = ${orgConKb}
    `);

    await m.generador.aplicarFicha(orgConKb, FICHA);

    const filas = (await db.execute(sql`
      SELECT instructions FROM agent_profile WHERE organization_id = ${orgConKb}
    `)) as unknown as Array<{ instructions: string | null }>;
    expect(filas[0]!.instructions).not.toBe("prompt viejo escrito a mano");
    expect(filas[0]!.instructions!.length).toBeGreaterThan(100);
  }, 60_000);
});
