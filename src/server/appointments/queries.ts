import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  bogotaAUtc,
  calcularDisponibilidad,
  esFechaValida,
  esHoy as esFechaDeHoy,
  partesEnNegocio,
  rangoDelDiaUtc,
  type BusinessHours,
  type CitaDelDia,
  type ServiceRow,
} from "./logic";

/**
 * Capa que toca la base de datos para el vertical de citas. La lógica pura
 * (fechas, horas, cálculo de slots) vive en ./logic — aquí solo se leen/
 * escriben filas, siempre `scoped()` por organización (Constitución III).
 */

const CITAS_ACTIVAS = ["pendiente", "confirmada", "reagendada"] as const;

/**
 * ¿La base rechazó esto por chocar con otra cita?
 *
 * `23P01` es `exclusion_violation`: lo lanza `appointment_sin_solape`
 * (migración 0018), la restricción que impide que una especialista tenga dos
 * citas encima. Es la ÚNICA defensa real contra dos peticiones simultáneas —
 * comprobar la disponibilidad antes de insertar no sirve cuando dos turnos
 * consultan a la vez.
 */
function esSolape(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "23P01";
}

export type { ServiceRow } from "./logic";
export type StaffRow = { id: string; name: string };

/** Gate de los endpoints de citas: 403 si la organización no tiene el vertical encendido. */
export async function appointmentsEnabledFor(organizationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ appointmentsEnabled: schema.agentProfile.appointmentsEnabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId));
  return rows[0]?.appointmentsEnabled ?? false;
}

// ── catálogo: servicios y personal ─────────────────────────────────────────

export async function listServices(
  organizationId: string,
  opts?: { includeArchived?: boolean }
): Promise<ServiceRow[]> {
  const db = getDb();
  const cond = opts?.includeArchived
    ? scoped(schema.service.organizationId, organizationId)
    : scoped(
        schema.service.organizationId,
        organizationId,
        isNull(schema.service.archivedAt)
      );
  return db.select().from(schema.service).where(cond).orderBy(asc(schema.service.name));
}

export async function listStaff(
  organizationId: string,
  opts?: { includeArchived?: boolean }
): Promise<(StaffRow & { archivedAt: Date | null })[]> {
  const db = getDb();
  const esPersona = eq(schema.resource.type, "persona");
  const cond = opts?.includeArchived
    ? scoped(schema.resource.organizationId, organizationId, esPersona)
    : scoped(
        schema.resource.organizationId,
        organizationId,
        and(esPersona, isNull(schema.resource.archivedAt))
      );
  return db
    .select()
    .from(schema.resource)
    .where(cond)
    .orderBy(asc(schema.resource.name));
}

/** Sirve para pintar, en cada staff, qué servicios tiene asignados. */
export async function listStaffServiceLinks(
  organizationId: string
): Promise<{ staffId: string; serviceId: string }[]> {
  const db = getDb();
  return db
    .select({
      staffId: schema.resourceService.resourceId,
      serviceId: schema.resourceService.serviceId,
    })
    .from(schema.resourceService)
    .where(scoped(schema.resourceService.organizationId, organizationId));
}

async function staffIdsForService(
  organizationId: string,
  serviceId: string
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ staffId: schema.resourceService.resourceId })
    .from(schema.resourceService)
    .innerJoin(
      schema.resource,
      eq(schema.resource.id, schema.resourceService.resourceId)
    )
    .where(
      scoped(
        schema.resourceService.organizationId,
        organizationId,
        and(
          eq(schema.resourceService.serviceId, serviceId),
          eq(schema.resource.type, "persona"),
          isNull(schema.resource.archivedAt)
        )
      )
    );
  return rows.map((r) => r.staffId);
}

/**
 * Filtra una lista de serviceIds a los que de verdad existen EN ESTA
 * organización. Sin esto, `staff_service` (cuyas FK no atan organization_id a
 * nivel de constraint) podría enlazar a un especialista con el servicio de
 * OTRO cliente si el body de la API llega manipulado.
 */
async function serviceIdsDeLaOrg(
  organizationId: string,
  serviceIds: string[]
): Promise<string[]> {
  if (!serviceIds.length) return [];
  const db = getDb();
  const rows = await db
    .select({ id: schema.service.id })
    .from(schema.service)
    .where(
      scoped(
        schema.service.organizationId,
        organizationId,
        inArray(schema.service.id, serviceIds)
      )
    );
  return rows.map((r) => r.id);
}

export async function createService(
  organizationId: string,
  input: {
    name: string;
    category?: string | null;
    priceCents: number;
    durationMin: number;
  }
) {
  const db = getDb();
  const [row] = await db
    .insert(schema.service)
    .values({
      id: newId("service"),
      organizationId,
      name: input.name,
      category: input.category ?? null,
      priceCents: input.priceCents,
      durationMin: input.durationMin,
    })
    .returning();
  return row;
}

export async function updateService(
  organizationId: string,
  id: string,
  patch: Partial<{
    name: string;
    category: string | null;
    priceCents: number;
    durationMin: number;
    archivedAt: Date | null;
  }>
) {
  const db = getDb();
  const [row] = await db
    .update(schema.service)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      scoped(schema.service.organizationId, organizationId, eq(schema.service.id, id))
    )
    .returning();
  return row ?? null;
}

/**
 * El mismo filtro, para los ids de personal: quién atiende un servicio no
 * puede acabar apuntando a la especialista de otro cliente.
 */
async function staffIdsDeLaOrg(
  organizationId: string,
  staffIds: string[]
): Promise<string[]> {
  if (!staffIds.length) return [];
  const db = getDb();
  const rows = await db
    .select({ id: schema.resource.id })
    .from(schema.resource)
    .where(
      scoped(
        schema.resource.organizationId,
        organizationId,
        inArray(schema.resource.id, staffIds)
      )
    );
  return rows.map((r) => r.id);
}

/**
 * Quiénes atienden UN servicio (reemplaza la lista entera).
 *
 * El inverso de `updateStaff`, que asigna servicios a una persona. Hace falta
 * porque un servicio recién creado **nace sin nadie**, y un servicio que nadie
 * atiende existe en el catálogo pero no se puede agendar: el agente responde
 * "ese servicio no está disponible para agendar por ahora". Sin esto había que
 * ir persona por persona buscando la casilla.
 */
export async function setEspecialistasDeServicio(
  organizationId: string,
  serviceId: string,
  staffIds: string[]
): Promise<void> {
  const [validService] = await serviceIdsDeLaOrg(organizationId, [serviceId]);
  if (!validService) return;
  const validStaff = await staffIdsDeLaOrg(organizationId, staffIds);

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.resourceService)
      .where(
        scoped(
          schema.resourceService.organizationId,
          organizationId,
          eq(schema.resourceService.serviceId, validService)
        )
      );
    if (validStaff.length) {
      await tx.insert(schema.resourceService).values(
        validStaff.map((staffId) => ({
          id: newId("resourceService"),
          organizationId,
          resourceId: staffId,
          serviceId: validService,
        }))
      );
    }
  });
}

export async function createStaff(
  organizationId: string,
  input: { name: string; serviceIds: string[] }
) {
  const db = getDb();
  const validServiceIds = await serviceIdsDeLaOrg(organizationId, input.serviceIds);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.resource)
      .values({ id: newId("resource"), organizationId, name: input.name, type: "persona" })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("No se pudo crear el especialista");
    if (validServiceIds.length) {
      await tx.insert(schema.resourceService).values(
        validServiceIds.map((serviceId) => ({
          id: newId("resourceService"),
          organizationId,
          resourceId: row.id,
          serviceId,
        }))
      );
    }
    return row;
  });
}

export async function updateStaff(
  organizationId: string,
  id: string,
  patch: { name?: string; archivedAt?: Date | null; serviceIds?: string[] }
) {
  const db = getDb();
  const validServiceIds = patch.serviceIds
    ? await serviceIdsDeLaOrg(organizationId, patch.serviceIds)
    : null;

  await db.transaction(async (tx) => {
    if (patch.name !== undefined || patch.archivedAt !== undefined) {
      await tx
        .update(schema.resource)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
        })
        .where(
          scoped(
            schema.resource.organizationId,
            organizationId,
            eq(schema.resource.id, id)
          )
        );
    }
    if (validServiceIds !== null) {
      await tx
        .delete(schema.resourceService)
        .where(
          scoped(
            schema.resourceService.organizationId,
            organizationId,
            eq(schema.resourceService.resourceId, id)
          )
        );
      if (validServiceIds.length) {
        await tx.insert(schema.resourceService).values(
          validServiceIds.map((serviceId) => ({
            id: newId("resourceService"),
            organizationId,
            resourceId: id,
            serviceId,
          }))
        );
      }
    }
  });

  const db2 = getDb();
  const rows = await db2
    .select()
    .from(schema.resource)
    .where(
      scoped(schema.resource.organizationId, organizationId, eq(schema.resource.id, id))
    );
  return rows[0] ?? null;
}

/** El catálogo, con quién atiende cada servicio — lo que ve el prompt del agente. */
export type CatalogEntry = ServiceRow & { staffNames: string[] };

export async function catalogoParaPrompt(
  organizationId: string
): Promise<CatalogEntry[]> {
  const services = await listServices(organizationId);
  if (!services.length) return [];
  const db = getDb();
  const links = await db
    .select({
      serviceId: schema.resourceService.serviceId,
      staffName: schema.resource.name,
    })
    .from(schema.resourceService)
    .innerJoin(
      schema.resource,
      eq(schema.resource.id, schema.resourceService.resourceId)
    )
    .where(
      scoped(
        schema.resourceService.organizationId,
        organizationId,
        and(eq(schema.resource.type, "persona"), isNull(schema.resource.archivedAt))
      )
    );
  const byService = new Map<string, string[]>();
  for (const l of links) {
    const arr = byService.get(l.serviceId) ?? [];
    arr.push(l.staffName);
    byService.set(l.serviceId, arr);
  }
  return services.map((s) => ({ ...s, staffNames: byService.get(s.id) ?? [] }));
}

/**
 * Resuelve el nombre de especialista que dio el cliente contra quienes de
 * verdad atienden ese servicio. `staffId: null` = sin preferencia (cualquiera).
 */
export async function resolverEspecialista(
  organizationId: string,
  serviceId: string,
  nombre?: string | null
): Promise<{ ok: true; staffId: string | null } | { ok: false; opciones: string[] }> {
  if (!nombre?.trim()) return { ok: true, staffId: null };
  const db = getDb();
  const rows = await db
    .select({ id: schema.resource.id, name: schema.resource.name })
    .from(schema.resourceService)
    .innerJoin(
      schema.resource,
      eq(schema.resource.id, schema.resourceService.resourceId)
    )
    .where(
      scoped(
        schema.resourceService.organizationId,
        organizationId,
        and(
          eq(schema.resourceService.serviceId, serviceId),
          eq(schema.resource.type, "persona"),
          isNull(schema.resource.archivedAt)
        )
      )
    );
  const q = nombre.trim().toLowerCase();
  const match =
    rows.find((r) => r.name.toLowerCase() === q) ??
    rows.find((r) => r.name.toLowerCase().includes(q));
  if (!match) return { ok: false, opciones: rows.map((r) => r.name) };
  return { ok: true, staffId: match.id };
}

// ── disponibilidad ─────────────────────────────────────────────────────────

export async function disponibilidadReal(input: {
  organizationId: string;
  service: ServiceRow;
  fecha: string;
  staffIdPreferido?: string | null;
  hours: BusinessHours;
  now?: Date;
  /** Al reprogramar, la cita que se está moviendo no debe chocar consigo misma. */
  excluirAppointmentId?: string;
}): Promise<Record<string, string[]>> {
  const staffIds = input.staffIdPreferido
    ? [input.staffIdPreferido]
    : await staffIdsForService(input.organizationId, input.service.id);
  if (!staffIds.length) return {};

  const rango = rangoDelDiaUtc(input.fecha);
  if (!rango) return {};
  const [inicio, fin] = rango;

  const db = getDb();
  // Sin joins: organizationId/resourceId/startsAt/endsAt/status ya están
  // todos en la fila de appointment_resource (paso 4, 18-ago-2026).
  const rows = await db
    .select({
      appointmentId: schema.appointmentResource.appointmentId,
      resourceId: schema.appointmentResource.resourceId,
      startsAt: schema.appointmentResource.startsAt,
      endsAt: schema.appointmentResource.endsAt,
    })
    .from(schema.appointmentResource)
    .where(
      scoped(
        schema.appointmentResource.organizationId,
        input.organizationId,
        and(
          inArray(schema.appointmentResource.resourceId, staffIds),
          gte(schema.appointmentResource.startsAt, inicio),
          lt(schema.appointmentResource.startsAt, fin),
          inArray(schema.appointmentResource.status, [...CITAS_ACTIVAS])
        )
      )
    );

  const citas: CitaDelDia[] = rows
    .filter((r) => r.appointmentId !== input.excluirAppointmentId)
    .map((r) => ({
      recursoId: r.resourceId,
      startMin: Math.round((r.startsAt.getTime() - inicio.getTime()) / 60000),
      endMin: Math.round((r.endsAt.getTime() - inicio.getTime()) / 60000),
    }));

  const now = input.now ?? new Date();
  return calcularDisponibilidad({
    recursoIds: staffIds,
    citas,
    duracionMin: input.service.durationMin,
    hours: input.hours,
    esHoy: esFechaDeHoy(input.fecha, now),
    minutosAhoraSiEsHoy: partesEnNegocio(now).minutos,
  });
}

export async function proximasFechasConCupo(input: {
  organizationId: string;
  service: ServiceRow;
  staffIdPreferido?: string | null;
  hours: BusinessHours;
  now?: Date;
  maxFechas?: number;
  maxDiasAdelante?: number;
}): Promise<{ fecha: string; horarios: string[] }[]> {
  const maxFechas = input.maxFechas ?? 5;
  const maxDias = input.maxDiasAdelante ?? 14;
  const now = input.now ?? new Date();
  const hoy = partesEnNegocio(now);
  const resultado: { fecha: string; horarios: string[] }[] = [];

  for (let i = 0; i <= maxDias && resultado.length < maxFechas; i++) {
    const d = new Date(Date.UTC(hoy.y, hoy.m - 1, hoy.d + i, 12));
    const fecha = `${String(d.getUTCDate()).padStart(2, "0")}/${String(
      d.getUTCMonth() + 1
    ).padStart(2, "0")}/${d.getUTCFullYear()}`;
    if (!esFechaValida(fecha, input.hours, now)) continue;
    const disp = await disponibilidadReal({
      organizationId: input.organizationId,
      service: input.service,
      fecha,
      staffIdPreferido: input.staffIdPreferido,
      hours: input.hours,
      now,
    });
    const horarios = Object.keys(disp).sort();
    if (horarios.length) resultado.push({ fecha, horarios });
  }
  return resultado;
}

// ── reservar / reprogramar / cancelar ──────────────────────────────────────

export type Appointment = typeof schema.appointment.$inferSelect;

export async function crearCita(input: {
  organizationId: string;
  contactId: string;
  service: ServiceRow;
  fecha: string;
  hora: string;
  staffIdPreferido?: string | null;
  hours: BusinessHours;
  now?: Date;
}): Promise<
  | { ok: true; appointment: Appointment; staffName: string }
  | { ok: false; reason: "sin_cupo" | "fuera_de_horario" }
> {
  if (!esFechaValida(input.fecha, input.hours, input.now)) {
    return { ok: false, reason: "fuera_de_horario" };
  }
  const disp = await disponibilidadReal({
    organizationId: input.organizationId,
    service: input.service,
    fecha: input.fecha,
    staffIdPreferido: input.staffIdPreferido,
    hours: input.hours,
    now: input.now,
  });
  const candidatos = disp[input.hora];
  if (!candidatos?.length) return { ok: false, reason: "sin_cupo" };

  // candidatos.length ya se comprobó arriba: el primer elemento existe.
  const staffId: string =
    input.staffIdPreferido && candidatos.includes(input.staffIdPreferido)
      ? input.staffIdPreferido
      : candidatos[0]!;

  const startsAt = bogotaAUtc(input.fecha, input.hora)!;
  const endsAt = new Date(startsAt.getTime() + input.service.durationMin * 60000);

  const db = getDb();
  let row: Appointment;
  try {
    // Una transacción: la cita y su recurso nacen juntos, o ninguno de los
    // dos. El EXCLUDE que impide el doble cupo vive en appointment_resource
    // desde el paso 4 (18-ago-2026) — ver docs/korexia/83-RECURSOS-Y-RESERVAS.md
    // y la migración 0024_recursos_y_reservas.sql.
    row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.appointment)
        .values({
          id: newId("appointment"),
          organizationId: input.organizationId,
          contactId: input.contactId,
          serviceId: input.service.id,
          startsAt,
          endsAt,
          status: "pendiente",
        })
        .returning();
      const nueva = inserted[0];
      if (!nueva) throw new Error("No se pudo crear la cita");

      await tx.insert(schema.appointmentResource).values({
        id: newId("appointmentResource"),
        organizationId: input.organizationId,
        appointmentId: nueva.id,
        resourceId: staffId,
        startsAt,
        endsAt,
        status: "pendiente",
      });
      return nueva;
    });
  } catch (e) {
    // La comprobación de arriba puede quedarse vieja: dos clientas escribiendo
    // a la vez consultan el mismo hueco libre antes de que ninguna inserte.
    // Quien pierde la carrera se entera aquí, en la única capa que puede
    // decidirlo de verdad — y para ella es un "sin cupo" normal y corriente.
    if (esSolape(e)) return { ok: false, reason: "sin_cupo" };
    throw e;
  }

  const staffRows = await db
    .select({ name: schema.resource.name })
    .from(schema.resource)
    .where(eq(schema.resource.id, staffId));
  return { ok: true, appointment: row, staffName: staffRows[0]?.name ?? "el equipo" };
}

export type CitaActiva = {
  id: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startsAt: Date;
  endsAt: Date;
};

/** Citas pendientes/confirmadas/reagendadas de un contacto (para reprogramar o cancelar). */
export async function citasActivasDeContacto(
  organizationId: string,
  contactId: string
): Promise<CitaActiva[]> {
  const db = getDb();
  return db
    .select({
      id: schema.appointment.id,
      serviceId: schema.appointment.serviceId,
      serviceName: schema.service.name,
      staffId: schema.appointmentResource.resourceId,
      staffName: schema.resource.name,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(
      schema.appointmentResource,
      eq(schema.appointmentResource.appointmentId, schema.appointment.id)
    )
    .innerJoin(schema.resource, eq(schema.resource.id, schema.appointmentResource.resourceId))
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        and(
          eq(schema.appointment.contactId, contactId),
          inArray(schema.appointment.status, [...CITAS_ACTIVAS])
        )
      )
    )
    .orderBy(asc(schema.appointment.startsAt));
}

export async function reprogramarCita(input: {
  organizationId: string;
  appointmentId: string;
  service: ServiceRow;
  staffId: string;
  nuevaFecha: string;
  nuevaHora: string;
  hours: BusinessHours;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: "sin_cupo" | "fuera_de_horario" }> {
  if (!esFechaValida(input.nuevaFecha, input.hours, input.now)) {
    return { ok: false, reason: "fuera_de_horario" };
  }
  const disp = await disponibilidadReal({
    organizationId: input.organizationId,
    service: input.service,
    fecha: input.nuevaFecha,
    staffIdPreferido: input.staffId,
    hours: input.hours,
    now: input.now,
    excluirAppointmentId: input.appointmentId,
  });
  if (!disp[input.nuevaHora]?.includes(input.staffId)) {
    return { ok: false, reason: "sin_cupo" };
  }

  const startsAt = bogotaAUtc(input.nuevaFecha, input.nuevaHora)!;
  const endsAt = new Date(startsAt.getTime() + input.service.durationMin * 60000);
  const db = getDb();
  try {
    await db
      .update(schema.appointment)
      .set({ startsAt, endsAt, status: "reagendada", updatedAt: new Date() })
      .where(
        scoped(
          schema.appointment.organizationId,
          input.organizationId,
          eq(schema.appointment.id, input.appointmentId)
        )
      );
  } catch (e) {
    // Mover una cita puede perder la misma carrera que crearla.
    if (esSolape(e)) return { ok: false, reason: "sin_cupo" };
    throw e;
  }
  return { ok: true };
}

export async function cancelarCita(
  organizationId: string,
  appointmentId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(schema.appointment)
    .set({ status: "cancelada", updatedAt: new Date() })
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        eq(schema.appointment.id, appointmentId)
      )
    )
    .returning();
  return rows.length > 0;
}

// ── panel de citas (UI) ─────────────────────────────────────────────────────

export type AppointmentStatus = Appointment["status"];

export type AppointmentRow = {
  id: string;
  serviceName: string;
  staffName: string;
  contactName: string | null;
  contactPhone: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  remindedAt: Date | null;
};

export async function listAppointments(
  organizationId: string,
  opts?: { status?: AppointmentStatus }
): Promise<AppointmentRow[]> {
  const db = getDb();
  const cond = opts?.status
    ? scoped(
        schema.appointment.organizationId,
        organizationId,
        eq(schema.appointment.status, opts.status)
      )
    : scoped(schema.appointment.organizationId, organizationId);
  return db
    .select({
      id: schema.appointment.id,
      serviceName: schema.service.name,
      staffName: schema.resource.name,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
      status: schema.appointment.status,
      remindedAt: schema.appointment.remindedAt,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(
      schema.appointmentResource,
      eq(schema.appointmentResource.appointmentId, schema.appointment.id)
    )
    .innerJoin(schema.resource, eq(schema.resource.id, schema.appointmentResource.resourceId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.appointment.contactId))
    .where(cond)
    .orderBy(desc(schema.appointment.startsAt))
    .limit(200);
}

/** Datos para componer y mandar el recordatorio de una cita puntual. */
export type CitaParaRecordar = {
  contactId: string;
  serviceName: string;
  staffName: string;
  startsAt: Date;
  status: AppointmentStatus;
};

export async function getCitaParaRecordar(
  organizationId: string,
  appointmentId: string
): Promise<CitaParaRecordar | null> {
  const db = getDb();
  const rows = await db
    .select({
      contactId: schema.appointment.contactId,
      serviceName: schema.service.name,
      staffName: schema.resource.name,
      startsAt: schema.appointment.startsAt,
      status: schema.appointment.status,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(
      schema.appointmentResource,
      eq(schema.appointmentResource.appointmentId, schema.appointment.id)
    )
    .innerJoin(schema.resource, eq(schema.resource.id, schema.appointmentResource.resourceId))
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        eq(schema.appointment.id, appointmentId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function marcarCitaRecordada(
  organizationId: string,
  appointmentId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.appointment)
    .set({ remindedAt: new Date() })
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        eq(schema.appointment.id, appointmentId)
      )
    );
}

export async function updateAppointmentStatus(
  organizationId: string,
  id: string,
  status: "confirmada" | "cancelada" | "completada" | "no_show"
) {
  const db = getDb();
  const rows = await db
    .update(schema.appointment)
    .set({ status, updatedAt: new Date() })
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        eq(schema.appointment.id, id)
      )
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Guarda los horarios que el agente acaba de ofrecerle al cliente,
 * reemplazando los de la consulta anterior: lo que se ofreció antes ya no
 * vale.
 *
 * Sostiene la regla "solo se agenda lo que se ofreció" (ver `offeredSlot` en
 * el esquema). Un fallo aquí no puede tumbar el turno: en el peor caso se
 * queda sin registro y `estaEntreLosOfrecidos` deja pasar, que es el
 * comportamiento que había antes de esto.
 */
export async function registrarOfrecidos(input: {
  organizationId: string;
  conversationId: string;
  serviceId: string;
  /** Pares fecha (DD/MM/AAAA) + hora (HH:MM) tal como se le muestran al cliente. */
  slots: { fecha: string; hora: string }[];
}): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.offeredSlot)
    .where(
      scoped(
        schema.offeredSlot.organizationId,
        input.organizationId,
        eq(schema.offeredSlot.conversationId, input.conversationId)
      )
    );
  if (!input.slots.length) return;
  await db.insert(schema.offeredSlot).values(
    input.slots.map((s) => ({
      id: newId("offeredSlot"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      serviceId: input.serviceId,
      fecha: s.fecha,
      hora: s.hora,
    }))
  );
}

export async function ofrecidosDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<{ fecha: string; hora: string }[]> {
  const db = getDb();
  const rows = await db
    .select({
      fecha: schema.offeredSlot.fecha,
      hora: schema.offeredSlot.hora,
    })
    .from(schema.offeredSlot)
    .where(
      scoped(
        schema.offeredSlot.organizationId,
        organizationId,
        eq(schema.offeredSlot.conversationId, conversationId)
      )
    );
  return rows;
}

/**
 * ¿Este horario es uno de los que el agente ofreció?
 *
 * **Sin nada ofrecido devuelve `true` a propósito**: hay conversaciones donde
 * el cliente pide un día y una hora concretos y el agente agenda directo sin
 * pasar por la consulta. Ese camino funciona hoy y `crearCita` lo valida
 * igual contra la disponibilidad real; bloquearlo sería romper algo que sirve.
 * La regla muerde donde está el riesgo: cuando SÍ se ofrecieron horarios y el
 * modelo termina reservando otro distinto.
 */
export async function estaEntreLosOfrecidos(input: {
  organizationId: string;
  conversationId: string;
  fecha: string;
  hora: string;
}): Promise<{ ok: true } | { ok: false; ofrecidos: { fecha: string; hora: string }[] }> {
  const ofrecidos = await ofrecidosDeConversacion(
    input.organizationId,
    input.conversationId
  );
  if (!ofrecidos.length) return { ok: true };
  const coincide = ofrecidos.some(
    (o) => o.fecha === input.fecha && o.hora === input.hora
  );
  return coincide ? { ok: true } : { ok: false, ofrecidos };
}

/** Tras agendar: lo ofrecido dejó de tener sentido. */
export async function limpiarOfrecidos(
  organizationId: string,
  conversationId: string
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.offeredSlot)
    .where(
      scoped(
        schema.offeredSlot.organizationId,
        organizationId,
        eq(schema.offeredSlot.conversationId, conversationId)
      )
    );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Cascada: mover o liberar la agenda de una especialista de un día entero.
 *
 * Herramienta de administración del negocio, no algo que un cliente pida por
 * chat: "Laura se enfermó, pasa sus citas de hoy a Camila" o "libera el
 * viernes de Laura". Portado de `BOT VALENTINA CON IA` a petición del dueño
 * (7-ago-2026), al entrar el primer cliente real de citas.
 * ───────────────────────────────────────────────────────────────────────── */

export type CitaDeAgenda = {
  id: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  contactName: string;
  startsAt: Date;
  endsAt: Date;
};

/** Las citas activas de una especialista en un día (fecha DD/MM/AAAA). */
export async function agendaDelDia(input: {
  organizationId: string;
  staffId: string;
  fecha: string;
}): Promise<CitaDeAgenda[]> {
  const rango = rangoDelDiaUtc(input.fecha);
  if (!rango) return [];
  const [desdeUtc, hastaUtc] = rango;
  const db = getDb();
  return db
    .select({
      id: schema.appointment.id,
      contactId: schema.appointment.contactId,
      serviceId: schema.appointment.serviceId,
      serviceName: schema.service.name,
      durationMin: schema.service.durationMin,
      contactName: schema.contact.name,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.appointment.contactId))
    .innerJoin(
      schema.appointmentResource,
      eq(schema.appointmentResource.appointmentId, schema.appointment.id)
    )
    .where(
      scoped(
        schema.appointment.organizationId,
        input.organizationId,
        and(
          eq(schema.appointmentResource.resourceId, input.staffId),
          inArray(schema.appointment.status, [...CITAS_ACTIVAS]),
          gte(schema.appointment.startsAt, desdeUtc),
          lt(schema.appointment.startsAt, hastaUtc)
        )
      )
    )
    .orderBy(asc(schema.appointment.startsAt));
}

export type ResultadoCascada = {
  /** Citas que sí se movieron o cancelaron. */
  aplicadas: CitaDeAgenda[];
  /**
   * Las que NO se tocaron y por qué. **No se fuerzan**: dejar dos clientas a
   * la misma hora con la misma persona es peor que avisar de un choque.
   */
  conflictos: { cita: CitaDeAgenda; motivo: string }[];
};

/**
 * Pasa las citas de una especialista a otra, el mismo día y a la misma hora.
 *
 * Dos comprobaciones antes de mover cada una, y si alguna falla la cita se
 * queda donde está y sale en `conflictos`:
 *  1. La nueva especialista ATIENDE ese servicio (no basta con que exista).
 *  2. Su hueco está libre a esa hora.
 */
export async function reasignarAgenda(input: {
  organizationId: string;
  staffOrigenId: string;
  staffDestinoId: string;
  fecha: string;
}): Promise<ResultadoCascada> {
  const db = getDb();
  const citas = await agendaDelDia({
    organizationId: input.organizationId,
    staffId: input.staffOrigenId,
    fecha: input.fecha,
  });
  const aplicadas: CitaDeAgenda[] = [];
  const conflictos: { cita: CitaDeAgenda; motivo: string }[] = [];

  const atiende = new Set(
    (
      await db
        .select({ serviceId: schema.resourceService.serviceId })
        .from(schema.resourceService)
        .where(
          scoped(
            schema.resourceService.organizationId,
            input.organizationId,
            eq(schema.resourceService.resourceId, input.staffDestinoId)
          )
        )
    ).map((r) => r.serviceId)
  );

  for (const cita of citas) {
    if (!atiende.has(cita.serviceId)) {
      conflictos.push({ cita, motivo: `no atiende ${cita.serviceName}` });
      continue;
    }
    const ocupado = await haySolapamiento({
      organizationId: input.organizationId,
      staffId: input.staffDestinoId,
      desde: cita.startsAt,
      hasta: cita.endsAt,
    });
    if (ocupado) {
      conflictos.push({ cita, motivo: "ya tiene otra cita a esa hora" });
      continue;
    }
    try {
      await db
        .update(schema.appointmentResource)
        .set({ resourceId: input.staffDestinoId })
        .where(
          scoped(
            schema.appointmentResource.organizationId,
            input.organizationId,
            eq(schema.appointmentResource.appointmentId, cita.id)
          )
        );
    } catch (e) {
      // `haySolapamiento` de arriba puede quedarse viejo entre dos
      // reasignaciones a la vez — el EXCLUDE es la defensa real (18-ago-2026,
      // corrección de un hueco que ya tenían crearCita/reprogramarCita y
      // este escritor no).
      if (esSolape(e)) {
        conflictos.push({ cita, motivo: "ya tiene otra cita a esa hora" });
        continue;
      }
      throw e;
    }
    aplicadas.push(cita);
  }
  return { aplicadas, conflictos };
}

/** Cancela todas las citas activas de una especialista ese día. */
export async function liberarAgenda(input: {
  organizationId: string;
  staffId: string;
  fecha: string;
}): Promise<ResultadoCascada> {
  const db = getDb();
  const citas = await agendaDelDia(input);
  for (const cita of citas) {
    await db
      .update(schema.appointment)
      .set({ status: "cancelada", updatedAt: new Date() })
      .where(
        scoped(
          schema.appointment.organizationId,
          input.organizationId,
          eq(schema.appointment.id, cita.id)
        )
      );
  }
  return { aplicadas: citas, conflictos: [] };
}

/** ¿La especialista tiene algo que se cruce con este rango? */
async function haySolapamiento(input: {
  organizationId: string;
  staffId: string;
  desde: Date;
  hasta: Date;
}): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.appointmentResource.id })
    .from(schema.appointmentResource)
    .where(
      scoped(
        schema.appointmentResource.organizationId,
        input.organizationId,
        and(
          eq(schema.appointmentResource.resourceId, input.staffId),
          inArray(schema.appointmentResource.status, [...CITAS_ACTIVAS]),
          lt(schema.appointmentResource.startsAt, input.hasta),
          gte(schema.appointmentResource.endsAt, input.desde)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** El horario del negocio, para quien agenda desde el panel. */
export async function horarioDeLaOrganizacion(
  organizationId: string
): Promise<BusinessHours | null> {
  const db = getDb();
  const rows = await db
    .select({
      open: schema.agentProfile.hoursOpen,
      close: schema.agentProfile.hoursClose,
      days: schema.agentProfile.hoursDays,
      openSunday: schema.agentProfile.hoursOpenSunday,
      closeSunday: schema.agentProfile.hoursCloseSunday,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Las citas de UN día, con la misma forma que `listAppointments`.
 *
 * El calendario pide su día al servidor en vez de filtrar en el navegador
 * sobre la lista general (limitada a 200): al saltar a un día lejano podía
 * pintarlo vacío teniendo citas. Trae también las canceladas — la vista las
 * distingue, y ocultarlas haría creer que ese hueco nunca existió.
 */
export async function citasDelDia(
  organizationId: string,
  fecha: string
): Promise<AppointmentRow[]> {
  const rango = rangoDelDiaUtc(fecha);
  if (!rango) return [];
  const [desdeUtc, hastaUtc] = rango;
  const db = getDb();
  return db
    .select({
      id: schema.appointment.id,
      serviceName: schema.service.name,
      staffName: schema.resource.name,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
      status: schema.appointment.status,
      remindedAt: schema.appointment.remindedAt,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(
      schema.appointmentResource,
      eq(schema.appointmentResource.appointmentId, schema.appointment.id)
    )
    .innerJoin(schema.resource, eq(schema.resource.id, schema.appointmentResource.resourceId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.appointment.contactId))
    .where(
      scoped(
        schema.appointment.organizationId,
        organizationId,
        and(
          gte(schema.appointment.startsAt, desdeUtc),
          lt(schema.appointment.startsAt, hastaUtc)
        )
      )
    )
    .orderBy(asc(schema.appointment.startsAt));
}

/**
 * Mover una cita desde el PANEL, sabiendo solo su id y la hora nueva.
 *
 * El agente ya sabía reprogramar por WhatsApp (`reprogramarCita`), pero el
 * equipo no tenía cómo: desde el panel solo podía confirmar, cancelar o marcar
 * la cita, así que "muévela media hora" obligaba a cancelar y crear otra —
 * perdiendo el historial y dejando a la clienta con la hora vieja si el
 * recordatorio ya había salido.
 *
 * Reutiliza el mismo camino del agente a propósito: hereda la comprobación de
 * solapes, el recálculo del final según la duración del servicio y la
 * liberación del hueco anterior. Aquí solo se buscan los datos que el panel no
 * manda (el servicio, la especialista y el horario del negocio).
 */
export async function moverCita(input: {
  organizationId: string;
  appointmentId: string;
  nuevaFecha: string;
  nuevaHora: string;
  now?: Date;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "no_existe" | "sin_horario" | "sin_cupo" | "fuera_de_horario" }
> {
  const db = getDb();
  const filas = await db
    .select({
      staffId: schema.appointmentResource.resourceId,
      serviceId: schema.appointment.serviceId,
      status: schema.appointment.status,
    })
    .from(schema.appointment)
    .innerJoin(
      schema.appointmentResource,
      eq(schema.appointmentResource.appointmentId, schema.appointment.id)
    )
    .where(
      scoped(
        schema.appointment.organizationId,
        input.organizationId,
        eq(schema.appointment.id, input.appointmentId)
      )
    )
    .limit(1);
  const cita = filas[0];
  if (!cita) return { ok: false, reason: "no_existe" };

  const servicios = await db
    .select()
    .from(schema.service)
    .where(
      scoped(
        schema.service.organizationId,
        input.organizationId,
        eq(schema.service.id, cita.serviceId)
      )
    )
    .limit(1);
  const service = servicios[0];
  if (!service) return { ok: false, reason: "no_existe" };

  const hours = await horarioDeLaOrganizacion(input.organizationId);
  // Sin horario no se puede saber si la hora nueva cae dentro: mejor decirlo
  // que agendar a ciegas (es lo que dejó una agenda entera sin huecos el 12-ago).
  if (!hours?.open || !hours.close) return { ok: false, reason: "sin_horario" };

  return reprogramarCita({
    organizationId: input.organizationId,
    appointmentId: input.appointmentId,
    service,
    staffId: cita.staffId,
    nuevaFecha: input.nuevaFecha,
    nuevaHora: input.nuevaHora,
    hours,
    now: input.now,
  });
}
