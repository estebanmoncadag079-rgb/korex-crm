import { beforeAll, describe, expect, it } from "vitest";
import { cargarConBaseDePruebas, hayBase } from "./_db";

/**
 * El motor de citas contra Postgres de verdad: crear, mover y cancelar.
 *
 * La lógica pura de slots ya está cubierta en `appointments-logic.test.ts`, pero
 * eso solo demuestra qué se OFRECE. Lo que decide si dos clientas acaban a la
 * misma hora es el camino de ESCRITURA: `crearCita` y `reprogramarCita`
 * consultan la disponibilidad y luego insertan, y entre esas dos cosas hay una
 * base de datos de por medio. Un doble no puede probar eso.
 *
 * El salón real (46 servicios, duraciones de 15 a 180 min, cinco especialistas)
 * es justo el caso donde importa: un Volumen Americano ocupa tres horas y un
 * retiro de extensiones media.
 *
 * Se salta sola si no hay `TEST_DATABASE_URL`.
 */

const d = hayBase ? describe : describe.skip;

/** Ids fijos: cada corrida limpia y reconstruye lo suyo. */
const ORG = "org_test_citas_motor";
const F = {
  contacto: "ct_citas_1",
  contacto2: "ct_citas_2",
  ruso: "sv_ruso_150",
  retiro: "sv_retiro_30",
  natural: "sv_natural_120",
  hilary: "st_hilary",
  valentina: "st_valentina",
};

/** 09:00–20:00, lunes a sábado: el horario real de Lashen Valen. */
const HOURS = { open: "09:00", close: "20:00", days: "1,2,3,4,5,6" };

/**
 * Un día laborable futuro, en formato DD/MM/AAAA.
 *
 * Futuro a propósito: `esFechaValida` rechaza el pasado y "hoy" descartaría los
 * slots ya vencidos, lo que haría que la prueba pasara o fallara según la hora
 * a la que se ejecute.
 */
function fechaHabilFutura(diasVista: number): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + diasVista);
  // Domingo (0) no se atiende: se corre al lunes.
  if (base.getUTCDay() === 0) base.setUTCDate(base.getUTCDate() + 1);
  const dd = String(base.getUTCDate()).padStart(2, "0");
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${base.getUTCFullYear()}`;
}

function domingoFuturo(): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + ((7 - base.getUTCDay()) % 7 || 7));
  const dd = String(base.getUTCDate()).padStart(2, "0");
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${base.getUTCFullYear()}`;
}

d("motor de citas (Postgres real)", () => {
  let mod: typeof import("@/server/appointments/queries");
  let db: Awaited<ReturnType<typeof cargarConBaseDePruebas>>["getDb"] extends () => infer T
    ? T
    : never;
  let schema: typeof import("@/lib/db").schema;
  let servicios: Record<string, import("@/server/appointments/queries").ServiceRow>;

  const FECHA = fechaHabilFutura(7);
  const OTRA_FECHA = fechaHabilFutura(8);

  beforeAll(async () => {
    const cargado = await cargarConBaseDePruebas();
    db = cargado.getDb();
    schema = cargado.schema;
    mod = await import("@/server/appointments/queries");

    // Borrar la organización arrastra todo lo suyo (cascade).
    await db.delete(schema.organization).where(
      (await import("drizzle-orm")).eq(schema.organization.id, ORG)
    );
    await db.insert(schema.organization).values({ id: ORG, name: "Salón de prueba" });
    await db.insert(schema.agentProfile).values({
      id: "ap_citas_motor",
      organizationId: ORG,
      appointmentsEnabled: true,
      hoursOpen: HOURS.open,
      hoursClose: HOURS.close,
      hoursDays: HOURS.days,
    });
    await db.insert(schema.contact).values([
      { id: F.contacto, organizationId: ORG, phone: "573000000001", name: "Ana" },
      { id: F.contacto2, organizationId: ORG, phone: "573000000002", name: "Beatriz" },
    ]);
    await db.insert(schema.service).values([
      { id: F.ruso, organizationId: ORG, name: "Volumen Ruso", priceCents: 13500000, durationMin: 150 },
      { id: F.retiro, organizationId: ORG, name: "Retiro de extensiones", priceCents: 2000000, durationMin: 30 },
      { id: F.natural, organizationId: ORG, name: "Efecto Natural", priceCents: 9500000, durationMin: 120 },
    ]);
    await db.insert(schema.resource).values([
      { id: F.hilary, organizationId: ORG, name: "Hilary", type: "persona" },
      { id: F.valentina, organizationId: ORG, name: "Valentina", type: "persona" },
    ]);
    await db.insert(schema.resourceService).values(
      [F.ruso, F.retiro, F.natural].flatMap((serviceId) =>
        [F.hilary, F.valentina].map((staffId) => ({
          id: `ss_${serviceId}_${staffId}`,
          organizationId: ORG,
          serviceId,
          resourceId: staffId,
        }))
      )
    );

    const lista = await mod.listServices(ORG);
    servicios = Object.fromEntries(lista.map((s) => [s.id, s]));
    // 60 s: la base de pruebas puede estar al otro lado de un túnel SSH y el
    // montaje son una docena de inserciones de ida y vuelta.
  }, 60_000);

  /** Deja la agenda vacía entre pruebas, sin tocar catálogo ni personal. */
  async function limpiarAgenda() {
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.appointment).where(eq(schema.appointment.organizationId, ORG));
  }

  async function agendar(
    serviceId: string,
    hora: string,
    staffId?: string,
    fecha = FECHA,
    contactId = F.contacto
  ) {
    return mod.crearCita({
      organizationId: ORG,
      contactId,
      service: servicios[serviceId]!,
      fecha,
      hora,
      staffIdPreferido: staffId ?? null,
      hours: HOURS,
    });
  }

  it("agenda una cita y le pone la duración de SU servicio, no una por defecto", async () => {
    await limpiarAgenda();
    const r = await agendar(F.ruso, "09:00", F.hilary);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const minutos = (r.appointment.endsAt.getTime() - r.appointment.startsAt.getTime()) / 60000;
    expect(minutos).toBe(150);
  });

  it("una cita de 150 min tapa las 2,5 horas siguientes de esa especialista", async () => {
    await limpiarAgenda();
    await agendar(F.ruso, "09:00", F.hilary);
    const disp = await mod.disponibilidadReal({
      organizationId: ORG,
      service: servicios[F.retiro]!,
      fecha: FECHA,
      staffIdPreferido: F.hilary,
      hours: HOURS,
    });
    // 09:00 → 11:30 ocupado; a las 11:30 se libera al minuto exacto.
    for (const h of ["09:00", "09:30", "10:00", "10:30", "11:00"]) {
      expect(disp[h] ?? []).not.toContain(F.hilary);
    }
    expect(disp["11:30"] ?? []).toContain(F.hilary);
  });

  it("NO deja crear una segunda cita encima de la primera", async () => {
    await limpiarAgenda();
    await agendar(F.ruso, "09:00", F.hilary);
    const encima = await agendar(F.retiro, "10:00", F.hilary, FECHA, F.contacto2);
    expect(encima.ok).toBe(false);
    if (!encima.ok) expect(encima.reason).toBe("sin_cupo");
  });

  /**
   * El borde exacto de la restricción `appointment_sin_solape`: su rango es
   * semiabierto `[)`. Si alguien lo cerrara, esta reserva legítima —la que
   * empieza al minuto en que la anterior termina, que es justo el hueco que el
   * motor ofrece— empezaría a fallar sin que ninguna otra prueba se enterara.
   */
  it("encadena una cita justo cuando acaba la anterior", async () => {
    await limpiarAgenda();
    const primera = await agendar(F.ruso, "09:00", F.hilary); // 09:00 → 11:30
    expect(primera.ok).toBe(true);
    const pegada = await agendar(F.retiro, "11:30", F.hilary, FECHA, F.contacto2);
    expect(pegada.ok).toBe(true);
  });

  it("otra especialista sí puede a la misma hora: cada agenda es suya", async () => {
    await limpiarAgenda();
    await agendar(F.ruso, "09:00", F.hilary);
    const otra = await agendar(F.ruso, "09:00", F.valentina, FECHA, F.contacto2);
    expect(otra.ok).toBe(true);
  });

  it("un servicio corto entra en el hueco donde no cabe uno largo", async () => {
    await limpiarAgenda();
    // Ocupa de 09:00 a 11:30 y de 12:00 en adelante: queda media hora libre.
    await agendar(F.ruso, "09:00", F.hilary);
    await agendar(F.natural, "12:00", F.hilary);
    const corto = await mod.disponibilidadReal({
      organizationId: ORG,
      service: servicios[F.retiro]!,
      fecha: FECHA,
      staffIdPreferido: F.hilary,
      hours: HOURS,
    });
    const largo = await mod.disponibilidadReal({
      organizationId: ORG,
      service: servicios[F.ruso]!,
      fecha: FECHA,
      staffIdPreferido: F.hilary,
      hours: HOURS,
    });
    expect(corto["11:30"] ?? []).toContain(F.hilary);
    expect(largo["11:30"] ?? []).not.toContain(F.hilary);
  });

  /**
   * 18-ago-2026: caso real reportado por el dueño — "Press on" (120 min)
   * rechazado a las 18:30 con el negocio cerrando a esa misma hora y la
   * especialista libre toda la tarde. El cierre es el límite para EMPEZAR
   * una cita, no para terminarla: un servicio largo agendado justo al
   * cierre sigue después, y eso es lo que quiere el negocio.
   */
  it("un servicio puede empezar justo a la hora de cierre, y corre después si hace falta", async () => {
    await limpiarAgenda();
    const disp = await mod.disponibilidadReal({
      organizationId: ORG,
      service: servicios[F.ruso]!, // 150 min
      fecha: FECHA,
      hours: HOURS,
    });
    // Cierra a las 20:00: sigue ofreciéndose como último slot, no antes.
    expect(disp["20:00"] ?? []).toContain(F.hilary);
    expect(disp["20:30"]).toBeUndefined(); // después del cierre, ya no se ofrece
    const tarde = await agendar(F.ruso, "20:00", F.hilary);
    expect(tarde.ok).toBe(true);
    if (tarde.ok) {
      const minutos =
        (tarde.appointment.endsAt.getTime() - tarde.appointment.startsAt.getTime()) / 60000;
      expect(minutos).toBe(150); // corre hasta las 22:30, pasado el cierre
    }
  });

  it("rechaza un día que el salón no atiende (domingo)", async () => {
    await limpiarAgenda();
    const r = await agendar(F.retiro, "10:00", F.hilary, domingoFuturo());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("fuera_de_horario");
  });

  describe("correr una cita (reprogramar)", () => {
    it("la mueve, recalcula el final y libera el hueco viejo", async () => {
      await limpiarAgenda();
      const creada = await agendar(F.ruso, "09:00", F.hilary);
      expect(creada.ok).toBe(true);
      if (!creada.ok) return;

      const movida = await mod.reprogramarCita({
        organizationId: ORG,
        appointmentId: creada.appointment.id,
        service: servicios[F.ruso]!,
        staffId: F.hilary,
        nuevaFecha: FECHA,
        nuevaHora: "14:00",
        hours: HOURS,
      });
      expect(movida.ok).toBe(true);

      const disp = await mod.disponibilidadReal({
        organizationId: ORG,
        service: servicios[F.ruso]!,
        fecha: FECHA,
        staffIdPreferido: F.hilary,
        hours: HOURS,
      });
      expect(disp["09:00"] ?? []).toContain(F.hilary);
      expect(disp["14:00"] ?? []).not.toContain(F.hilary);

      const { eq } = await import("drizzle-orm");
      const filas = await db
        .select()
        .from(schema.appointment)
        .where(eq(schema.appointment.id, creada.appointment.id));
      const cita = filas[0]!;
      expect(cita.status).toBe("reagendada");
      expect((cita.endsAt.getTime() - cita.startsAt.getTime()) / 60000).toBe(150);
    });

    it("moverla a la misma hora donde ya hay otra cita: no se puede", async () => {
      await limpiarAgenda();
      const primera = await agendar(F.ruso, "09:00", F.hilary);
      await agendar(F.natural, "12:00", F.hilary, FECHA, F.contacto2);
      if (!primera.ok) throw new Error("no se pudo preparar la prueba");

      const choque = await mod.reprogramarCita({
        organizationId: ORG,
        appointmentId: primera.appointment.id,
        service: servicios[F.ruso]!,
        staffId: F.hilary,
        nuevaFecha: FECHA,
        nuevaHora: "12:30",
        hours: HOURS,
      });
      expect(choque.ok).toBe(false);
      if (!choque.ok) expect(choque.reason).toBe("sin_cupo");
    });

    it("moverla a otro día también libera el día viejo", async () => {
      await limpiarAgenda();
      const creada = await agendar(F.ruso, "09:00", F.hilary);
      if (!creada.ok) throw new Error("no se pudo preparar la prueba");
      const movida = await mod.reprogramarCita({
        organizationId: ORG,
        appointmentId: creada.appointment.id,
        service: servicios[F.ruso]!,
        staffId: F.hilary,
        nuevaFecha: OTRA_FECHA,
        nuevaHora: "09:00",
        hours: HOURS,
      });
      expect(movida.ok).toBe(true);
      const dispViejo = await mod.disponibilidadReal({
        organizationId: ORG,
        service: servicios[F.ruso]!,
        fecha: FECHA,
        staffIdPreferido: F.hilary,
        hours: HOURS,
      });
      expect(dispViejo["09:00"] ?? []).toContain(F.hilary);
    });

    /**
     * Fase 10U — bug real: `reprogramarCita` pasaba el `staffId` de la cita
     * directo a `disponibilidadReal` como `staffIdPreferido`, una rama que
     * evita el filtro `isNull(archivedAt)` que SÍ aplica `crearCita`. Si la
     * especialista original se dio de baja después de la cita, esto dejaba
     * reprogramar hacia ella sin ningún rechazo — tanto desde el agente como
     * desde el panel (`moverCita`, que delega aquí).
     */
    it("Fase 10U: NO deja reprogramar hacia una especialista ya dada de baja (bug real corregido)", async () => {
      await limpiarAgenda();
      const creada = await agendar(F.natural, "09:00", F.valentina);
      if (!creada.ok) throw new Error("no se pudo preparar la prueba");

      const { eq } = await import("drizzle-orm");
      await db
        .update(schema.resource)
        .set({ archivedAt: new Date() })
        .where(eq(schema.resource.id, F.valentina));
      try {
        const movida = await mod.reprogramarCita({
          organizationId: ORG,
          appointmentId: creada.appointment.id,
          service: servicios[F.natural]!,
          staffId: F.valentina,
          nuevaFecha: OTRA_FECHA,
          nuevaHora: "10:00",
          hours: HOURS,
        });
        expect(movida.ok).toBe(false);
        if (!movida.ok) expect(movida.reason).toBe("especialista_no_disponible");

        // La cita original sigue intacta: no se movió a ningún lado.
        const filas = await db
          .select()
          .from(schema.appointment)
          .where(eq(schema.appointment.id, creada.appointment.id));
        expect(filas[0]!.status).toBe("pendiente");
      } finally {
        // No contaminar el resto de la suite: Valentina vuelve a estar activa.
        await db
          .update(schema.resource)
          .set({ archivedAt: null })
          .where(eq(schema.resource.id, F.valentina));
      }
    });
  });

  it("cancelar devuelve el hueco a la agenda", async () => {
    await limpiarAgenda();
    const creada = await agendar(F.ruso, "09:00", F.hilary);
    if (!creada.ok) throw new Error("no se pudo preparar la prueba");
    await mod.cancelarCita(ORG, creada.appointment.id);
    const disp = await mod.disponibilidadReal({
      organizationId: ORG,
      service: servicios[F.ruso]!,
      fecha: FECHA,
      staffIdPreferido: F.hilary,
      hours: HOURS,
    });
    expect(disp["09:00"] ?? []).toContain(F.hilary);
  });

  /**
   * Dos clientas escribiendo a la vez y pidiendo el mismo hueco. Los webhooks
   * de WhatsApp llegan en paralelo, así que los dos turnos pueden consultar la
   * disponibilidad ANTES de que ninguno haya insertado.
   */
  it("dos peticiones simultáneas al mismo hueco: solo una debe entrar", async () => {
    const { eq } = await import("drizzle-orm");

    /*
     * El pool se precalienta a propósito. `postgres-js` abre las conexiones
     * cuando hacen falta, y a través de un túnel el handshake de la segunda
     * tarda lo suficiente como para que la primera petición termine antes de
     * que la segunda consulte: la prueba pasaría sin que hubiera habido nunca
     * dos peticiones a la vez. Un verde por timing no prueba nada.
     */
    await Promise.all(
      Array.from({ length: 4 }, () =>
        db.select().from(schema.service).where(eq(schema.service.organizationId, ORG))
      )
    );

    // Varias rondas: una carrera perdida una vez puede ganarse a la siguiente.
    const horas = ["09:00", "12:00", "14:30", "17:00"];
    const resultados: { hora: string; aceptadas: number; filas: number }[] = [];

    for (const hora of horas) {
      await limpiarAgenda();
      const [a, b] = await Promise.all([
        agendar(F.ruso, hora, F.hilary, FECHA, F.contacto),
        agendar(F.ruso, hora, F.hilary, FECHA, F.contacto2),
      ]);
      const filas = await db
        .select()
        .from(schema.appointment)
        .where(eq(schema.appointment.organizationId, ORG));
      resultados.push({
        hora,
        aceptadas: [a, b].filter((r) => r.ok).length,
        filas: filas.length,
      });
    }

    console.log("carreras:", resultados);
    expect(resultados.every((r) => r.aceptadas === 1 && r.filas === 1)).toBe(true);
  });

  /**
   * La prueba anterior valida el camino de la APLICACIÓN (`crearCita`
   * consulta y luego inserta). Esta valida la restricción de la BASE de forma
   * directa e independiente de ese código — el EXCLUDE se movió de
   * `appointment` a `appointment_resource` en el paso 4 (18-ago-2026,
   * docs/korexia/83-RECURSOS-Y-RESERVAS.md), y tiene que seguir siendo lo
   * único que de verdad impide vender dos veces la misma hora.
   */
  it("el EXCLUDE de appointment_resource rechaza un segundo vínculo solapado, insertado directo", async () => {
    await limpiarAgenda();
    const creada = await agendar(F.ruso, "09:00", F.hilary); // 09:00–11:30
    if (!creada.ok) throw new Error("no se pudo preparar la prueba");

    await expect(
      db.insert(schema.appointmentResource).values({
        id: "aptr_prueba_directa",
        organizationId: ORG,
        appointmentId: creada.appointment.id,
        resourceId: F.hilary,
        // 10:00–10:30: dentro del rango 09:00–11:30 que ya ocupa Hilary.
        startsAt: new Date(creada.appointment.startsAt.getTime() + 60 * 60000),
        endsAt: new Date(creada.appointment.startsAt.getTime() + 90 * 60000),
        status: "pendiente",
      })
    ).rejects.toMatchObject({ code: "23P01" });
  });

  /**
   * Mover una cita desde el PANEL (`moverCita`).
   *
   * El equipo solo podía confirmar, cancelar o marcar: para "muévela media hora"
   * había que cancelar y crear otra, perdiendo el historial de la cita. Ahora
   * pasa por el mismo camino que el agente, y esto comprueba que hereda de
   * verdad sus defensas — no basta con que exista el botón.
   */
  describe("mover una cita desde el panel", () => {
    const FECHA_PANEL = fechaHabilFutura(9);

    async function crear(serviceId: string, hora: string, staffId: string, contactId = F.contacto) {
      return mod.crearCita({
        organizationId: ORG,
        contactId,
        service: servicios[serviceId]!,
        fecha: FECHA_PANEL,
        hora,
        staffIdPreferido: staffId,
        hours: HOURS,
      });
    }

    it("la mueve y recalcula el final con la duración de su servicio", async () => {
      const { eq } = await import("drizzle-orm");
      await db.delete(schema.appointment).where(eq(schema.appointment.organizationId, ORG));
      const creada = await crear(F.ruso, "09:00", F.hilary);
      if (!creada.ok) throw new Error("no se pudo preparar la prueba");

      const r = await mod.moverCita({
        organizationId: ORG,
        appointmentId: creada.appointment.id,
        nuevaFecha: FECHA_PANEL,
        nuevaHora: "15:00",
      });
      expect(r.ok).toBe(true);

      const filas = await db
        .select()
        .from(schema.appointment)
        .where(eq(schema.appointment.id, creada.appointment.id));
      const cita = filas[0]!;
      expect((cita.endsAt.getTime() - cita.startsAt.getTime()) / 60000).toBe(150);
    });

    it("NO la deja encima de otra cita de la misma especialista", async () => {
      const { eq } = await import("drizzle-orm");
      await db.delete(schema.appointment).where(eq(schema.appointment.organizationId, ORG));
      const primera = await crear(F.ruso, "09:00", F.hilary);
      await crear(F.natural, "13:00", F.hilary, F.contacto2);
      if (!primera.ok) throw new Error("no se pudo preparar la prueba");

      const r = await mod.moverCita({
        organizationId: ORG,
        appointmentId: primera.appointment.id,
        nuevaFecha: FECHA_PANEL,
        nuevaHora: "13:30",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("sin_cupo");
    });

    it("una cita que no existe no revienta: lo dice", async () => {
      const r = await mod.moverCita({
        organizationId: ORG,
        appointmentId: "apt_no_existe",
        nuevaFecha: FECHA_PANEL,
        nuevaHora: "10:00",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("no_existe");
    });
  });

  /**
   * Selección múltiple en citas (18-ago-2026, docs/korexia/88-AUDITORIA-
   * SELECCION-MULTIPLE.md paso 4): "manos y pies" son DOS servicios en una
   * sola visita, un solo bloque de tiempo. Lo que protege esta sección es que
   * el bloque completo —no solo el del primer servicio— queda reservado.
   */
  describe("reserva de varios servicios en una misma visita", () => {
    // Retiro (30 min) + Efecto Natural (120 min) = 150 min de visita.
    async function agendarMultiple(hora: string, staffId?: string, contactId = F.contacto) {
      return mod.crearCitaMultiple({
        organizationId: ORG,
        contactId,
        services: [servicios[F.retiro]!, servicios[F.natural]!],
        fecha: FECHA,
        hora,
        staffIdPreferido: staffId ?? null,
        hours: HOURS,
      });
    }

    it("la duración de la visita es la SUMA de sus servicios, no la del primero", async () => {
      await limpiarAgenda();
      const r = await agendarMultiple("09:00", F.hilary);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const minutos = (r.appointment.endsAt.getTime() - r.appointment.startsAt.getTime()) / 60000;
      expect(minutos).toBe(150); // 30 + 120, no los 30 del primer servicio (appointment.service_id)
    });

    it("guarda una fila appointment_service por servicio, en el orden pedido", async () => {
      await limpiarAgenda();
      const r = await agendarMultiple("09:00", F.hilary);
      if (!r.ok) throw new Error("no se pudo preparar la prueba");

      const { eq, asc } = await import("drizzle-orm");
      const filas = await db
        .select()
        .from(schema.appointmentService)
        .where(eq(schema.appointmentService.appointmentId, r.appointment.id))
        .orderBy(asc(schema.appointmentService.position));
      expect(filas).toHaveLength(2);
      expect(filas[0]).toMatchObject({ serviceId: F.retiro, position: 0, durationMin: 30 });
      expect(filas[1]).toMatchObject({ serviceId: F.natural, position: 1, durationMin: 120 });
    });

    it("bloquea TODO el bloque combinado: un choque a mitad de la visita también se rechaza", async () => {
      await limpiarAgenda();
      const primera = await agendarMultiple("09:00", F.hilary); // 09:00 → 11:30
      expect(primera.ok).toBe(true);

      // 10:00 está DENTRO del bloque de 150 min, pero fuera de los 30 min del
      // primer servicio (appointment.service_id): si algo solo protegiera el
      // primero, este choque pasaría colado.
      const enMedio = await agendar(F.retiro, "10:00", F.hilary, FECHA, F.contacto2);
      expect(enMedio.ok).toBe(false);
      if (!enMedio.ok) expect(enMedio.reason).toBe("sin_cupo");
    });

    it("libera el hueco exactamente cuando termina el bloque combinado (11:30, no a los 30 min del primer servicio)", async () => {
      await limpiarAgenda();
      await agendarMultiple("09:00", F.hilary);
      const disp = await mod.disponibilidadRealMultiple({
        organizationId: ORG,
        services: [servicios[F.retiro]!, servicios[F.natural]!],
        fecha: FECHA,
        staffIdPreferido: F.hilary,
        hours: HOURS,
      });
      expect(disp["09:30"] ?? []).not.toContain(F.hilary); // dentro del bloque
      expect(disp["11:00"] ?? []).not.toContain(F.hilary); // sigue dentro
      expect(disp["11:30"] ?? []).toContain(F.hilary); // justo al terminar
    });

    /**
     * El bug que este cambio corrige: `reprogramarCita` calculaba `endsAt`
     * con la duración de un solo servicio. Sin el arreglo, mover esta visita
     * habría dejado los últimos 120 min del bloque sin protección.
     */
    it("reprogramar una visita multiservicio conserva la duración COMBINADA, no la del primer servicio", async () => {
      await limpiarAgenda();
      const creada = await agendarMultiple("09:00", F.hilary);
      if (!creada.ok) throw new Error("no se pudo preparar la prueba");

      const movida = await mod.reprogramarCita({
        organizationId: ORG,
        appointmentId: creada.appointment.id,
        // A propósito, el primer servicio SOLO (30 min): si el arreglo no
        // sumara appointment_service, esto truncaría la reserva a 30 min.
        service: servicios[F.retiro]!,
        staffId: F.hilary,
        nuevaFecha: FECHA,
        nuevaHora: "14:00",
        hours: HOURS,
      });
      expect(movida.ok).toBe(true);

      const { eq } = await import("drizzle-orm");
      const filas = await db
        .select()
        .from(schema.appointment)
        .where(eq(schema.appointment.id, creada.appointment.id));
      const cita = filas[0]!;
      expect((cita.endsAt.getTime() - cita.startsAt.getTime()) / 60000).toBe(150);

      // Y el EXCLUDE (appointment_resource) protege el bloque completo en la
      // nueva hora: 14:00–16:30, no solo 14:00–14:30.
      const choque = await agendar(F.retiro, "15:00", F.hilary, FECHA, F.contacto2);
      expect(choque.ok).toBe(false);
    });

    it("citasActivasDeContacto trae TODOS los servicios de la visita, no solo el principal", async () => {
      await limpiarAgenda();
      const creada = await agendarMultiple("09:00", F.hilary);
      if (!creada.ok) throw new Error("no se pudo preparar la prueba");

      const activas = await mod.citasActivasDeContacto(ORG, F.contacto);
      const visita = activas.find((a) => a.id === creada.appointment.id);
      expect(visita?.serviceNames).toEqual(["Retiro de extensiones", "Efecto Natural"]);
    });
  });
});
