import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  bogotaAUtc,
  calcularDisponibilidad,
  diaDeSemana,
  esFechaValida,
  esHoy as esFechaDeHoy,
  partesEnNegocio,
  rangoDelDiaUtc,
  type BusinessHours,
  type CitaDelDia,
  type ServiceRow,
} from "./logic";
import {
  franjaDelDia,
  horarioDeLaFila,
  sinHorarioConfigurado,
  type FranjaDelDia,
} from "@/server/horario";

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
 * Quiénes atienden TODOS los servicios de una visita a la vez — la
 * intersección, no la unión. Es el caso real de un salón pequeño: una sola
 * especialista hace manos, pies, cejas y pestañas seguidas, y una reserva
 * multiservicio solo puede caer en quien las cubra todas.
 *
 * Una consulta, reducción en memoria: para un salón con un puñado de
 * especialistas y servicios no vale la pena una segunda ida a la base por
 * cada servicio pedido.
 */
async function staffIdsForServices(
  organizationId: string,
  serviceIds: string[]
): Promise<string[]> {
  if (!serviceIds.length) return [];
  const db = getDb();
  const rows = await db
    .select({
      staffId: schema.resourceService.resourceId,
      serviceId: schema.resourceService.serviceId,
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
        and(
          inArray(schema.resourceService.serviceId, serviceIds),
          eq(schema.resource.type, "persona"),
          isNull(schema.resource.archivedAt)
        )
      )
    );
  const porRecurso = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = porRecurso.get(r.staffId) ?? new Set<string>();
    set.add(r.serviceId);
    porRecurso.set(r.staffId, set);
  }
  return [...porRecurso.entries()]
    .filter(([, servicios]) => serviceIds.every((id) => servicios.has(id)))
    .map(([staffId]) => staffId);
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
 * Renombra una categoría en TODOS los servicios que la usan, o la quita si
 * `hasta` es `null`.
 *
 * Es una sola operación porque renombrar y eliminar son lo mismo visto de
 * cerca: una categoría no existe por sí sola —no hay tabla— sino como el valor
 * que comparten varios servicios. Borrarla es dejar a esos servicios sin
 * categoría; nunca borra un servicio.
 *
 * Va en lote y no servicio por servicio a propósito: con 46 servicios, hacerlo
 * desde el navegador serían decenas de peticiones que pueden fallar a medias y
 * dejar media categoría renombrada.
 *
 * Devuelve cuántos servicios cambiaron, para poder decírselo a quien lo pidió.
 */
export async function renombrarCategoria(
  organizationId: string,
  desde: string,
  hasta: string | null
): Promise<number> {
  const db = getDb();
  const filas = await db
    .update(schema.service)
    .set({ category: hasta, updatedAt: new Date() })
    .where(
      scoped(
        schema.service.organizationId,
        organizationId,
        eq(schema.service.category, desde)
      )
    )
    .returning({ id: schema.service.id });
  return filas.length;
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

/**
 * Igual que `resolverEspecialista`, pero para una visita de varios
 * servicios: el candidato tiene que atenderlos TODOS (`staffIdsForServices`),
 * no solo uno. `opciones: []` cuando NADIE cubre esa combinación completa —
 * distinto de "el nombre que dio el cliente no calza", que si hay candidatos
 * sigue devolviendo sus nombres para que el agente pregunte con quién.
 */
export async function resolverEspecialistaMultiple(
  organizationId: string,
  serviceIds: string[],
  nombre?: string | null
): Promise<{ ok: true; staffId: string | null } | { ok: false; opciones: string[] }> {
  const candidatos = await staffIdsForServices(organizationId, serviceIds);
  if (!candidatos.length) return { ok: false, opciones: [] };
  if (!nombre?.trim()) return { ok: true, staffId: null };

  const db = getDb();
  const rows = await db
    .select({ id: schema.resource.id, name: schema.resource.name })
    .from(schema.resource)
    .where(
      scoped(
        schema.resource.organizationId,
        organizationId,
        and(inArray(schema.resource.id, candidatos), eq(schema.resource.type, "persona"))
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

/**
 * Lo que comparten `disponibilidadReal` y `disponibilidadRealMultiple`: leer
 * las citas del día de un grupo de recursos y reducirlas a minutos-desde-
 * medianoche. Sin joins: organizationId/resourceId/startsAt/endsAt/status ya
 * están todos en la fila de appointment_resource (paso 4, 18-ago-2026).
 */
async function citasDelDiaDeRecursos(
  organizationId: string,
  staffIds: string[],
  fecha: string,
  excluirAppointmentId?: string
): Promise<{ inicio: Date; citas: CitaDelDia[] } | null> {
  const rango = rangoDelDiaUtc(fecha);
  if (!rango) return null;
  const [inicio, fin] = rango;

  const db = getDb();
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
        organizationId,
        and(
          inArray(schema.appointmentResource.resourceId, staffIds),
          gte(schema.appointmentResource.startsAt, inicio),
          lt(schema.appointmentResource.startsAt, fin),
          inArray(schema.appointmentResource.status, [...CITAS_ACTIVAS])
        )
      )
    );

  const citas: CitaDelDia[] = rows
    .filter((r) => r.appointmentId !== excluirAppointmentId)
    .map((r) => ({
      recursoId: r.resourceId,
      startMin: Math.round((r.startsAt.getTime() - inicio.getTime()) / 60000),
      endMin: Math.round((r.endsAt.getTime() - inicio.getTime()) / 60000),
    }));
  return { inicio, citas };
}

/**
 * La franja que rige una fecha concreta, o `null` si ese día el negocio
 * cierra. Existe porque la disponibilidad es **de un día**, no de la semana:
 * con el modelo viejo se calculaban los huecos de un sábado corto usando la
 * hora de cierre de entre semana.
 */
function franjaDelDiaDeLaFecha(hours: BusinessHours, fecha: string): FranjaDelDia | null {
  const dow = diaDeSemana(fecha);
  return dow === null ? null : franjaDelDia(hours, dow);
}

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

  const dia = await citasDelDiaDeRecursos(
    input.organizationId,
    staffIds,
    input.fecha,
    input.excluirAppointmentId
  );
  if (!dia) return {};

  const now = input.now ?? new Date();
  return calcularDisponibilidad({
    recursoIds: staffIds,
    citas: dia.citas,
    duracionMin: input.service.durationMin,
    franja: franjaDelDiaDeLaFecha(input.hours, input.fecha),
    esHoy: esFechaDeHoy(input.fecha, now),
    minutosAhoraSiEsHoy: partesEnNegocio(now).minutos,
  });
}

/**
 * Igual que `disponibilidadReal`, pero para una visita de varios servicios:
 * los recursos válidos son quienes los atienden TODOS
 * (`staffIdsForServices`), y la duración es la SUMA de sus `durationMin` —
 * `calcularDisponibilidad` no sabe ni le importa si ese número viene de uno o
 * de tres servicios, así que no cambia.
 */
export async function disponibilidadRealMultiple(input: {
  organizationId: string;
  services: ServiceRow[];
  fecha: string;
  staffIdPreferido?: string | null;
  hours: BusinessHours;
  now?: Date;
  excluirAppointmentId?: string;
}): Promise<Record<string, string[]>> {
  const staffIds = input.staffIdPreferido
    ? [input.staffIdPreferido]
    : await staffIdsForServices(
        input.organizationId,
        input.services.map((s) => s.id)
      );
  if (!staffIds.length) return {};

  const dia = await citasDelDiaDeRecursos(
    input.organizationId,
    staffIds,
    input.fecha,
    input.excluirAppointmentId
  );
  if (!dia) return {};

  const duracionMin = input.services.reduce((acc, s) => acc + s.durationMin, 0);
  const now = input.now ?? new Date();
  return calcularDisponibilidad({
    recursoIds: staffIds,
    citas: dia.citas,
    duracionMin,
    franja: franjaDelDiaDeLaFecha(input.hours, input.fecha),
    esHoy: esFechaDeHoy(input.fecha, now),
    minutosAhoraSiEsHoy: partesEnNegocio(now).minutos,
  });
}

/** Lo que comparten `proximasFechasConCupo` y su variante multiservicio: recorrer los días y quedarse con los que tienen algo libre. */
async function fechasConCupo(
  hours: BusinessHours,
  now: Date,
  maxFechas: number,
  maxDias: number,
  dispDelDia: (fecha: string) => Promise<Record<string, string[]>>
): Promise<{ fecha: string; horarios: string[] }[]> {
  const hoy = partesEnNegocio(now);
  const resultado: { fecha: string; horarios: string[] }[] = [];

  for (let i = 0; i <= maxDias && resultado.length < maxFechas; i++) {
    const d = new Date(Date.UTC(hoy.y, hoy.m - 1, hoy.d + i, 12));
    const fecha = `${String(d.getUTCDate()).padStart(2, "0")}/${String(
      d.getUTCMonth() + 1
    ).padStart(2, "0")}/${d.getUTCFullYear()}`;
    if (!esFechaValida(fecha, hours, now)) continue;
    const disp = await dispDelDia(fecha);
    const horarios = Object.keys(disp).sort();
    if (horarios.length) resultado.push({ fecha, horarios });
  }
  return resultado;
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
  const now = input.now ?? new Date();
  return fechasConCupo(input.hours, now, input.maxFechas ?? 5, input.maxDiasAdelante ?? 14, (fecha) =>
    disponibilidadReal({
      organizationId: input.organizationId,
      service: input.service,
      fecha,
      staffIdPreferido: input.staffIdPreferido,
      hours: input.hours,
      now,
    })
  );
}

/** Igual que `proximasFechasConCupo`, pero para una visita de varios servicios. */
export async function proximasFechasConCupoMultiple(input: {
  organizationId: string;
  services: ServiceRow[];
  staffIdPreferido?: string | null;
  hours: BusinessHours;
  now?: Date;
  maxFechas?: number;
  maxDiasAdelante?: number;
}): Promise<{ fecha: string; horarios: string[] }[]> {
  const now = input.now ?? new Date();
  return fechasConCupo(input.hours, now, input.maxFechas ?? 5, input.maxDiasAdelante ?? 14, (fecha) =>
    disponibilidadRealMultiple({
      organizationId: input.organizationId,
      services: input.services,
      fecha,
      staffIdPreferido: input.staffIdPreferido,
      hours: input.hours,
      now,
    })
  );
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

/**
 * Igual que `crearCita`, pero para una visita de varios servicios en el
 * mismo bloque de tiempo ("manos y pies tradicional"). `appointment.service_id`
 * sigue siendo NOT NULL y único — se queda con el PRIMERO de la lista, en el
 * orden en que el cliente los pidió, y pasa a significar "el servicio
 * principal de la visita". Nada de lo que hoy hace `innerJoin` contra él
 * necesita tocarse: la lista completa vive en `appointment_service`.
 */
export async function crearCitaMultiple(input: {
  organizationId: string;
  contactId: string;
  services: ServiceRow[];
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
  const disp = await disponibilidadRealMultiple({
    organizationId: input.organizationId,
    services: input.services,
    fecha: input.fecha,
    staffIdPreferido: input.staffIdPreferido,
    hours: input.hours,
    now: input.now,
  });
  const candidatos = disp[input.hora];
  if (!candidatos?.length) return { ok: false, reason: "sin_cupo" };

  const staffId: string =
    input.staffIdPreferido && candidatos.includes(input.staffIdPreferido)
      ? input.staffIdPreferido
      : candidatos[0]!;

  const duracionMin = input.services.reduce((acc, s) => acc + s.durationMin, 0);
  const startsAt = bogotaAUtc(input.fecha, input.hora)!;
  const endsAt = new Date(startsAt.getTime() + duracionMin * 60000);
  const primero = input.services[0]!;

  const db = getDb();
  let row: Appointment;
  try {
    // Misma transacción que crearCita, con una fila appointment_service por
    // servicio además de la cita y su recurso. El EXCLUDE sigue viviendo en
    // appointment_resource y protege el bloque de tiempo completo sin saber
    // cuántos servicios contiene.
    //
    // ⚠️ appointment.service_id (abajo) y la fila de appointment_service con
    // position=0 representan el MISMO hecho por partida doble, y no hay
    // trigger que los mantenga sincronizados (a diferencia de
    // appointment_resource, que sí lo tiene). La única defensa hoy es que
    // esta es la ÚNICA función que escribe las dos tablas, en la misma
    // transacción y desde el mismo valor (`primero`). Si algún día se agrega
    // una función que edite los servicios de una cita ya creada, tiene que
    // actualizar ambas — o las dos fuentes divergen sin que nada lo avise.
    row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.appointment)
        .values({
          id: newId("appointment"),
          organizationId: input.organizationId,
          contactId: input.contactId,
          serviceId: primero.id,
          startsAt,
          endsAt,
          status: "pendiente",
        })
        .returning();
      const nueva = inserted[0];
      if (!nueva) throw new Error("No se pudo crear la cita");

      await tx.insert(schema.appointmentService).values(
        input.services.map((s, i) => ({
          id: newId("appointmentService"),
          organizationId: input.organizationId,
          appointmentId: nueva.id,
          serviceId: s.id,
          position: i,
          durationMin: s.durationMin,
        }))
      );

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
  /**
   * TODOS los servicios de la visita, en el orden pedido — incluye el
   * principal. Para citas de antes de este cambio (o creadas sin
   * `appointment_service`) es `[serviceName]`, igual que se comportaba antes.
   */
  serviceNames: string[];
  staffId: string;
  staffName: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * TODOS los servicios de un grupo de citas, no solo el principal — segunda
 * consulta liviana, acotada a los `appointmentId` que ya se leyeron (nunca a
 * toda la tabla). Compartida por `citasActivasDeContacto`, `citasDelDia`,
 * `listAppointments` y `reasignarAgenda`: las cuatro necesitaban la misma
 * pregunta ("¿qué más lleva esta visita, aparte del servicio principal?"),
 * antes cada una hubiera tenido que repetirla — id y nombre en la misma
 * fila porque unas quieren mostrar el nombre y otra necesita el id para
 * comprobar quién atiende qué.
 *
 * `appointment_service` es aditiva (paso 4, 18-ago-2026): una cita creada
 * con `crearCita` (singular) o de antes de ese cambio no tiene filas ahí, así
 * que el `Map` devuelto simplemente no trae esa cita — quien llama decide el
 * fallback (`[servicio principal]`), porque cada uno construye su fila distinto.
 */
async function serviciosDeCitas(
  organizationId: string,
  appointmentIds: string[]
): Promise<Map<string, { id: string; name: string }[]>> {
  const porCita = new Map<string, { id: string; name: string }[]>();
  if (!appointmentIds.length) return porCita;
  const db = getDb();
  const extra = await db
    .select({
      appointmentId: schema.appointmentService.appointmentId,
      serviceId: schema.appointmentService.serviceId,
      serviceName: schema.service.name,
    })
    .from(schema.appointmentService)
    .innerJoin(schema.service, eq(schema.service.id, schema.appointmentService.serviceId))
    .where(
      scoped(
        schema.appointmentService.organizationId,
        organizationId,
        inArray(schema.appointmentService.appointmentId, appointmentIds)
      )
    )
    .orderBy(asc(schema.appointmentService.position));
  for (const e of extra) {
    const arr = porCita.get(e.appointmentId) ?? [];
    arr.push({ id: e.serviceId, name: e.serviceName });
    porCita.set(e.appointmentId, arr);
  }
  return porCita;
}

/** Citas pendientes/confirmadas/reagendadas de un contacto (para reprogramar o cancelar). */
export async function citasActivasDeContacto(
  organizationId: string,
  contactId: string
): Promise<CitaActiva[]> {
  const db = getDb();
  const base = await db
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
  const porCita = await serviciosDeCitas(
    organizationId,
    base.map((c) => c.id)
  );
  return base.map((c) => ({
    ...c,
    serviceNames: porCita.get(c.id)?.length
      ? porCita.get(c.id)!.map((s) => s.name)
      : [c.serviceName],
  }));
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
}): Promise<
  { ok: true } | { ok: false; reason: "sin_cupo" | "fuera_de_horario" | "especialista_no_disponible" }
> {
  if (!esFechaValida(input.nuevaFecha, input.hours, input.now)) {
    return { ok: false, reason: "fuera_de_horario" };
  }
  /**
   * Fase 10U — bug real: a diferencia de `crearCita`/`crearCitaMultiple`
   * (que SIEMPRE resuelven contra `staffIdsForService`, filtrado por
   * `isNull(archivedAt)`), `reprogramarCita` pasaba `input.staffId` directo
   * a `disponibilidadReal` como `staffIdPreferido` — una rama que
   * DELIBERADAMENTE evita ese filtro (línea ~600 de este archivo). Si la
   * especialista de la cita original fue dada de baja después, esto permitía
   * reprogramar (por el cliente o por el panel, vía `moverCita`) hacia una
   * especialista que el catálogo ya no ofrece — sin ningún rechazo. Se
   * revalida aquí, ANTES de calcular disponibilidad, con la misma fuente que
   * usa la creación.
   */
  const staffActivosParaElServicio = await staffIdsForService(
    input.organizationId,
    input.service.id
  );
  if (!staffActivosParaElServicio.includes(input.staffId)) {
    return { ok: false, reason: "especialista_no_disponible" };
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

  const db = getDb();
  // La visita puede llevar varios servicios (appointment_service): sin sumar
  // sus duraciones, reprogramar truncaría el bloque a la del primero y
  // dejaría el resto de la visita sin protección contra el doble cupo.
  // Fallback a la duración simple para citas creadas antes de este cambio.
  const serviciosDeLaCita = await db
    .select({ durationMin: schema.appointmentService.durationMin })
    .from(schema.appointmentService)
    .where(
      scoped(
        schema.appointmentService.organizationId,
        input.organizationId,
        eq(schema.appointmentService.appointmentId, input.appointmentId)
      )
    );
  const duracionMin = serviciosDeLaCita.length
    ? serviciosDeLaCita.reduce((acc, s) => acc + s.durationMin, 0)
    : input.service.durationMin;

  const startsAt = bogotaAUtc(input.nuevaFecha, input.nuevaHora)!;
  const endsAt = new Date(startsAt.getTime() + duracionMin * 60000);
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
  /** TODOS los servicios de la visita, en el orden pedido — ver `serviciosDeCitas`. */
  serviceNames: string[];
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
  const base = await db
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
  const porCita = await serviciosDeCitas(
    organizationId,
    base.map((c) => c.id)
  );
  return base.map((c) => ({
    ...c,
    serviceNames: porCita.get(c.id)?.length
      ? porCita.get(c.id)!.map((s) => s.name)
      : [c.serviceName],
  }));
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
  /**
   * TODOS los servicios de la visita que se ofreció junto para estos horarios
   * (p. ej. "manos y pies" son dos). Se guarda una fila por cada combinación
   * (slot × servicio) para que `book_appointment` pueda comprobar, servicio a
   * servicio, que la combinación que intenta agendar es la misma que se
   * consultó — no solo el primero (docs/korexia/149).
   */
  serviceIds: string[];
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
  if (!input.slots.length || !input.serviceIds.length) return;
  await db.insert(schema.offeredSlot).values(
    input.slots.flatMap((s) =>
      input.serviceIds.map((serviceId) => ({
        id: newId("offeredSlot"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        serviceId,
        fecha: s.fecha,
        hora: s.hora,
      }))
    )
  );
}

/**
 * Los servicios (ids DISTINCT) que el agente ofreció para una fecha+hora
 * EXACTAS en esta conversación. Vacío = no hay nada registrado para ese
 * horario (p. ej. el cliente dio fecha/hora directa sin pasar por una
 * consulta de disponibilidad) — el que llama decide qué hacer con eso; aquí
 * solo se lee lo que hay.
 *
 * Sostiene el guardarraíl "no agendes un servicio que nunca se consultó junto"
 * de `book_appointment` (docs/korexia/149): permite comparar la combinación
 * que el modelo intenta agendar contra la que efectivamente se ofreció para
 * ese horario.
 */
export async function serviciosOfrecidosPara(
  organizationId: string,
  conversationId: string,
  fecha: string,
  hora: string
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ serviceId: schema.offeredSlot.serviceId })
    .from(schema.offeredSlot)
    .where(
      scoped(
        schema.offeredSlot.organizationId,
        organizationId,
        eq(schema.offeredSlot.conversationId, conversationId),
        eq(schema.offeredSlot.fecha, fecha),
        eq(schema.offeredSlot.hora, hora)
      )
    );
  return [...new Set(rows.map((r) => r.serviceId))];
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
  /** TODOS los ids de servicio de la visita — ver `serviciosDeCitas`. */
  serviceIds: string[];
  /** TODOS los nombres, en el mismo orden. */
  serviceNames: string[];
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
  const base = await db
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
  const porCita = await serviciosDeCitas(
    input.organizationId,
    base.map((c) => c.id)
  );
  return base.map((c) => {
    const extra = porCita.get(c.id);
    return {
      ...c,
      serviceIds: extra?.length ? extra.map((s) => s.id) : [c.serviceId],
      serviceNames: extra?.length ? extra.map((s) => s.name) : [c.serviceName],
    };
  });
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
    /*
     * TODOS los servicios de la visita, no solo el principal — 18-ago-2026,
     * corregido tras el primer cliente real: "Diwpower + Tradicionales" se
     * podía reasignar a alguien que solo atendía Diwpower, porque esto
     * comprobaba únicamente `cita.serviceId` (appointment.service_id, "el
     * primero de la visita"). Una visita reasignada mal es peor que una que
     * no se mueve: se queda donde está y sale en `conflictos`.
     */
    const faltantes = cita.serviceIds.filter((id) => !atiende.has(id));
    if (faltantes.length) {
      const nombresFaltantes = cita.serviceNames.filter((_, i) =>
        faltantes.includes(cita.serviceIds[i]!)
      );
      conflictos.push({ cita, motivo: `no atiende ${nombresFaltantes.join(", ")}` });
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
      // La FICHA es la autoridad; las columnas solo se miran si no hay ficha
      // (ver `horarioDeLaFila`). El panel debe ver exactamente el mismo
      // horario que el agente, o la agenda y el bot ofrecen días distintos.
      ficha: schema.agentProfile.ficha,
      hoursDays: schema.agentProfile.hoursDays,
      hoursOpen: schema.agentProfile.hoursOpen,
      hoursClose: schema.agentProfile.hoursClose,
      hoursOpenSunday: schema.agentProfile.hoursOpenSunday,
      hoursCloseSunday: schema.agentProfile.hoursCloseSunday,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!rows[0]) return null;
  return horarioDeLaFila(rows[0]);
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
  const base = await db
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
  const porCita = await serviciosDeCitas(
    organizationId,
    base.map((c) => c.id)
  );
  return base.map((c) => ({
    ...c,
    serviceNames: porCita.get(c.id)?.length
      ? porCita.get(c.id)!.map((s) => s.name)
      : [c.serviceName],
  }));
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
  | {
      ok: false;
      reason:
        | "no_existe"
        | "sin_horario"
        | "sin_cupo"
        | "fuera_de_horario"
        | "especialista_no_disponible";
    }
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
  if (!hours || sinHorarioConfigurado(hours)) return { ok: false, reason: "sin_horario" };

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
