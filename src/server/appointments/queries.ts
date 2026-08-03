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
  const cond = opts?.includeArchived
    ? scoped(schema.staffMember.organizationId, organizationId)
    : scoped(
        schema.staffMember.organizationId,
        organizationId,
        isNull(schema.staffMember.archivedAt)
      );
  return db
    .select()
    .from(schema.staffMember)
    .where(cond)
    .orderBy(asc(schema.staffMember.name));
}

/** Sirve para pintar, en cada staff, qué servicios tiene asignados. */
export async function listStaffServiceLinks(
  organizationId: string
): Promise<{ staffId: string; serviceId: string }[]> {
  const db = getDb();
  return db
    .select({
      staffId: schema.staffService.staffId,
      serviceId: schema.staffService.serviceId,
    })
    .from(schema.staffService)
    .where(scoped(schema.staffService.organizationId, organizationId));
}

async function staffIdsForService(
  organizationId: string,
  serviceId: string
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ staffId: schema.staffService.staffId })
    .from(schema.staffService)
    .innerJoin(
      schema.staffMember,
      eq(schema.staffMember.id, schema.staffService.staffId)
    )
    .where(
      scoped(
        schema.staffService.organizationId,
        organizationId,
        and(
          eq(schema.staffService.serviceId, serviceId),
          isNull(schema.staffMember.archivedAt)
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

export async function createStaff(
  organizationId: string,
  input: { name: string; serviceIds: string[] }
) {
  const db = getDb();
  const validServiceIds = await serviceIdsDeLaOrg(organizationId, input.serviceIds);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.staffMember)
      .values({ id: newId("staffMember"), organizationId, name: input.name })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("No se pudo crear el especialista");
    if (validServiceIds.length) {
      await tx.insert(schema.staffService).values(
        validServiceIds.map((serviceId) => ({
          id: newId("staffService"),
          organizationId,
          staffId: row.id,
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
        .update(schema.staffMember)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
        })
        .where(
          scoped(
            schema.staffMember.organizationId,
            organizationId,
            eq(schema.staffMember.id, id)
          )
        );
    }
    if (validServiceIds !== null) {
      await tx
        .delete(schema.staffService)
        .where(
          scoped(
            schema.staffService.organizationId,
            organizationId,
            eq(schema.staffService.staffId, id)
          )
        );
      if (validServiceIds.length) {
        await tx.insert(schema.staffService).values(
          validServiceIds.map((serviceId) => ({
            id: newId("staffService"),
            organizationId,
            staffId: id,
            serviceId,
          }))
        );
      }
    }
  });

  const db2 = getDb();
  const rows = await db2
    .select()
    .from(schema.staffMember)
    .where(
      scoped(schema.staffMember.organizationId, organizationId, eq(schema.staffMember.id, id))
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
      serviceId: schema.staffService.serviceId,
      staffName: schema.staffMember.name,
    })
    .from(schema.staffService)
    .innerJoin(
      schema.staffMember,
      eq(schema.staffMember.id, schema.staffService.staffId)
    )
    .where(
      scoped(
        schema.staffService.organizationId,
        organizationId,
        isNull(schema.staffMember.archivedAt)
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
    .select({ id: schema.staffMember.id, name: schema.staffMember.name })
    .from(schema.staffService)
    .innerJoin(
      schema.staffMember,
      eq(schema.staffMember.id, schema.staffService.staffId)
    )
    .where(
      scoped(
        schema.staffService.organizationId,
        organizationId,
        and(
          eq(schema.staffService.serviceId, serviceId),
          isNull(schema.staffMember.archivedAt)
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
  const rows = await db
    .select({
      id: schema.appointment.id,
      staffId: schema.appointment.staffId,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
    })
    .from(schema.appointment)
    .where(
      scoped(
        schema.appointment.organizationId,
        input.organizationId,
        and(
          inArray(schema.appointment.staffId, staffIds),
          gte(schema.appointment.startsAt, inicio),
          lt(schema.appointment.startsAt, fin),
          inArray(schema.appointment.status, [...CITAS_ACTIVAS])
        )
      )
    );

  const citas: CitaDelDia[] = rows
    .filter((r) => r.id !== input.excluirAppointmentId)
    .map((r) => ({
      staffId: r.staffId,
      startMin: Math.round((r.startsAt.getTime() - inicio.getTime()) / 60000),
      endMin: Math.round((r.endsAt.getTime() - inicio.getTime()) / 60000),
    }));

  const now = input.now ?? new Date();
  return calcularDisponibilidad({
    staffIds,
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
  const inserted = await db
    .insert(schema.appointment)
    .values({
      id: newId("appointment"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      serviceId: input.service.id,
      staffId,
      startsAt,
      endsAt,
      status: "pendiente",
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("No se pudo crear la cita");

  const staffRows = await db
    .select({ name: schema.staffMember.name })
    .from(schema.staffMember)
    .where(eq(schema.staffMember.id, staffId));
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
      staffId: schema.appointment.staffId,
      staffName: schema.staffMember.name,
      startsAt: schema.appointment.startsAt,
      endsAt: schema.appointment.endsAt,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(
      schema.staffMember,
      eq(schema.staffMember.id, schema.appointment.staffId)
    )
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
      staffName: schema.staffMember.name,
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
      schema.staffMember,
      eq(schema.staffMember.id, schema.appointment.staffId)
    )
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
      staffName: schema.staffMember.name,
      startsAt: schema.appointment.startsAt,
      status: schema.appointment.status,
    })
    .from(schema.appointment)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointment.serviceId))
    .innerJoin(
      schema.staffMember,
      eq(schema.staffMember.id, schema.appointment.staffId)
    )
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
