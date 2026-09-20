/**
 * Motor de disponibilidad de citas — lógica pura, sin tocar la base de datos.
 *
 * Puerto del motor probado en BOT VALENTINA CON IA (src/lib/appointment/logic.ts
 * de ese proyecto), adaptado a multi-especialista y a la zona horaria fija de
 * Colombia que ya usa el resto de korex.ia (ver server/ai/prompts.ts).
 *
 * Principio central, igual que con el horario de atención: la disponibilidad
 * la calcula el SERVIDOR y se le entrega resuelta al modelo — nunca se le pide
 * que haga la aritmética de fechas él mismo (ver docs/korexia/04-AGENTE-IA.md).
 */

import { horaAMinutos } from "@/lib/hora";
import { franjaDelDia, type FranjaDelDia, type HorarioSemanal } from "@/server/horario";

const BUSINESS_TIMEZONE = "America/Bogota";

export type ServiceRow = {
  id: string;
  name: string;
  category: string | null;
  priceCents: number;
  durationMin: number;
};

/**
 * El horario del negocio, **en su forma canónica** (ver `@/server/horario`).
 *
 * Hasta el 20-sep-2026 esto era `{ open, close, days, openSunday, closeSunday }`:
 * una franja común para toda la semana, una lista de días por su lado y el
 * domingo como caso aparte. Tenía dos consecuencias, y las dos se pagaron:
 *
 *   - los días y las franjas podían contradecirse (el incidente de Lis), y
 *   - **un negocio no podía tener horarios distintos por día** — algo que la
 *     agenda de citas necesita de verdad: sábado hasta las 14:00 es lo normal
 *     en un salón, y aquí se ofrecían huecos hasta las 19:00.
 *
 * Ahora es un alias del modelo por día. Se conserva el nombre porque es el
 * que atraviesa todo el motor de citas y renombrarlo no añadiría nada.
 */
export type BusinessHours = HorarioSemanal;

/** Una cita existente, ya reducida a minutos-desde-medianoche en hora de Colombia. */
export type CitaDelDia = { recursoId: string; startMin: number; endMin: number };

// ─── catálogo: búsqueda difusa de servicio ─────────────────────────────────

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Conectores que no distinguen un servicio de otro (se ignoran al comparar).
const STOP_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "con", "y", "o", "en", "para", "al", "por",
  "un", "una", "unos", "unas", "tus", "mi", "mis",
  "servicio", "servicios", "cita", "citas",
]);

function tokens(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/** Dos palabras "coinciden" si son iguales o comparten una raíz larga (tolera plural/género). */
function coincide(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= 5 || (i === min && min >= 4);
}

/**
 * Busca un servicio del catálogo por nombre, tolerando tildes, mayúsculas y
 * nombres parafraseados por el cliente o por la IA. Si dos servicios encajan
 * igual de bien, devuelve null (ambiguo) para que el agente pregunte en vez
 * de adivinar mal.
 */
export function buscarServicio(
  services: ServiceRow[],
  nombre: string
): ServiceRow | null {
  const q = normalizar(nombre);
  if (!q) return null;

  const exacto = services.find((s) => normalizar(s.name) === q);
  if (exacto) return exacto;

  /**
   * Un ÚNICO candidato por substring es una resolución segura. Más de uno ya
   * no lo es: "retoque" encaja como substring de los 19 servicios "Retoque
   * X" de un salón real (docs/korexia/104-ALGORITMO-BUSCAR-SERVICIO-SUBSTRING-AMBIGUO.md),
   * y tomar el primero por orden alfabético no tiene relación con lo que pide
   * el cliente — así resolvía antes: "Retoque Baby Volumen 2D" sin que nadie
   * lo pidiera, solo porque empieza por B.
   *
   * Con más de un candidato se deja caer al paso de tokens: ya sabe comparar
   * candidatos entre sí (ratio/overlap) y ya marca ambiguo si empatan, así que
   * no hace falta duplicar esa lógica aquí — solo dejar de cortar el camino
   * antes de que le toque actuar.
   */
  const sub = services.filter(
    (s) => normalizar(s.name).includes(q) || q.includes(normalizar(s.name))
  );
  if (sub.length === 1) return sub[0]!;

  const qt = tokens(nombre);
  if (!qt.length) return null;
  let mejor: { srv: ServiceRow; overlap: number; ratio: number } | null = null;
  let ambiguo = false;
  for (const s of services) {
    const st = tokens(s.name);
    if (!st.length) continue;
    const overlap = st.filter((t) => qt.some((u) => coincide(t, u))).length;
    if (!overlap) continue;
    const ratio = overlap / st.length;
    if (!mejor || overlap > mejor.overlap || (overlap === mejor.overlap && ratio > mejor.ratio)) {
      mejor = { srv: s, overlap, ratio };
      ambiguo = false;
    } else if (overlap === mejor.overlap && ratio === mejor.ratio) {
      ambiguo = true;
    }
  }
  if (!mejor || ambiguo) return null;
  return mejor.srv;
}

/**
 * Igual que `buscarServicio`, pero sobre las citas activas de un contacto
 * (para reprogramar/cancelar "la de peluquería" sin decir el nombre exacto).
 * Genérica sobre `T` para no acoplarse al tipo `CitaActiva` de las queries.
 *
 * `serviceNames`, si viene, es TODA la lista de servicios de la visita
 * (manos y pies son dos) — así "cancela mi cita de pies" encuentra la visita
 * aunque su servicio principal sea "Manicure". Sin ese campo, se comporta
 * exactamente igual que antes: busca solo contra `serviceName`.
 */
export function encontrarCitaActiva<
  T extends { id: string; serviceName: string; serviceNames?: string[] },
>(activas: T[], servicioTexto: string): T | undefined {
  const candidatos: ServiceRow[] = activas.flatMap((a) =>
    (a.serviceNames?.length ? a.serviceNames : [a.serviceName]).map((name) => ({
      id: a.id,
      name,
      category: null,
      priceCents: 0,
      durationMin: 0,
    }))
  );
  const encontrado = buscarServicio(candidatos, servicioTexto);
  return encontrado ? activas.find((a) => a.id === encontrado.id) : undefined;
}

// ─── fechas y horas ──────────────────────────────────────────────────────

/**
 * Minutos desde medianoche, o `null` si la hora no se entiende.
 *
 * Devolvía `NaN` en silencio para cualquier cosa que no fuera `HH:MM`, y un
 * `NaN` aquí vacía la agenda entera sin que nada lo delate. Ver `lib/hora.ts`.
 */
export function horaAMin(hhmm: string): number | null {
  return horaAMinutos(hhmm);
}

export function minAHora(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function horaAAmPm(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr ?? 0);
  const mm = String(Number(mStr ?? 0)).padStart(2, "0");
  if (h === 0) return `12:${mm} AM`;
  if (h < 12) return `${h}:${mm} AM`;
  if (h === 12) return `12:${mm} PM`;
  return `${h - 12}:${mm} PM`;
}

/**
 * "D/M/AAAA" o "AAAA-MM-DD" → "DD/MM/AAAA" (o null si no es ninguna).
 *
 * El prompt pide DD/MM/AAAA, pero **el modelo manda ISO a menudo**: es el
 * formato en el que "piensa" un LLM.
 *
 * **Bug real, encontrado el 7-ago-2026** probando el vertical de citas antes
 * de su primer cliente: el agente resolvió "el lunes" como `2026-08-10`, esto
 * devolvía `null`, la fecha se usaba sin normalizar y `esFechaValida` la leía
 * como DD/MM (día "2026") → le respondió a la clienta **"el lunes 10 de
 * agosto ya pasó"**… un viernes 7. Estaba anotado en 19-CITAS.md como una
 * "inconsistencia del modelo con las fechas relativas"; no lo era: era un
 * formato que el servidor no aceptaba.
 */
export function normalizarFecha(texto: string): string | null {
  const t = (texto || "").trim();

  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  }

  const m = t.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
}

/*
 * `diasHabiles` desaparece: era la tercera copia de "qué días abre este
 * negocio" —había otra en `prompts.ts` y otra en `businessStatus`— y cada
 * copia con su propio criterio para el domingo. Ahora se pregunta a
 * `diasAbiertos`/`franjaDelDia`, que es el único sitio que lo sabe.
 */

/** Año/mes/día/día-de-semana (1=lunes…7=domingo) de una fecha, en hora de Colombia. */
export function partesEnNegocio(
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE
): { y: number; m: number; d: number; dow: number; minutos: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow =
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(
      get("weekday").toLowerCase().slice(0, 3)
    ) + 1;
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    dow,
    minutos: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** "DD/MM/AAAA" → { y, m, d } o null si el formato no calza. */
export function partesDeFecha(
  fecha: string
): { y: number; m: number; d: number } | null {
  const match = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

/** Día de la semana (1=lunes…7=domingo) de una fecha DD/MM/AAAA, sin depender del huso del servidor. */
export function diaDeSemana(fecha: string): number | null {
  const p = partesDeFecha(fecha);
  if (!p) return null;
  // Mediodía UTC: lejos de cualquier borde de huso, solo se usa para el día de la semana.
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * ¿Es una fecha agendable? Formato válido, no en el pasado (hora de Colombia)
 * y un día que el negocio atiende. `false` en cualquier caso inválido.
 */
export function esFechaValida(
  fecha: string,
  hours: BusinessHours,
  now: Date = new Date()
): boolean {
  const p = partesDeFecha(fecha);
  if (!p) return false;
  const dow = diaDeSemana(fecha);
  // Un día sin franja está cerrado. No hay lista de días que consultar aparte:
  // esa separación es la que dejó a Lis abierta un domingo desmarcado.
  if (dow === null || !franjaDelDia(hours, dow)) return false;

  const hoy = partesEnNegocio(now);
  if (p.y < hoy.y) return false;
  if (p.y === hoy.y && p.m < hoy.m) return false;
  if (p.y === hoy.y && p.m === hoy.m && p.d < hoy.d) return false;
  return true;
}

export function esHoy(fecha: string, now: Date = new Date()): boolean {
  const p = partesDeFecha(fecha);
  if (!p) return false;
  const hoy = partesEnNegocio(now);
  return p.y === hoy.y && p.m === hoy.m && p.d === hoy.d;
}

/** Bogotá es UTC-5 fijo (sin horario de verano): instante real de una hora local del negocio. */
export function bogotaAUtc(fecha: string, hora: string): Date | null {
  const p = partesDeFecha(fecha);
  if (!p) return null;
  const [hStr, mStr] = hora.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, h + 5, m));
}

/** El instante inverso: de un timestamp UTC a fecha/hora del negocio en Bogotá. */
export function utcAFechaHoraBogota(
  date: Date,
  timeZone: string = BUSINESS_TIMEZONE
): { fecha: string; hora: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    fecha: `${get("day")}/${get("month")}/${get("year")}`,
    hora: `${get("hour")}:${get("minute")}`,
  };
}

/** Rango UTC [inicio, fin) que cubre TODO un día de negocio en Bogotá. */
export function rangoDelDiaUtc(fecha: string): [Date, Date] | null {
  const p = partesDeFecha(fecha);
  if (!p) return null;
  const inicio = new Date(Date.UTC(p.y, p.m - 1, p.d, 5, 0));
  const fin = new Date(Date.UTC(p.y, p.m - 1, p.d + 1, 5, 0));
  return [inicio, fin];
}

// ─── disponibilidad ──────────────────────────────────────────────────────

/**
 * Slots libres para un día y una duración de servicio dados.
 *
 * ⚠️ **Devuelve `Record<hora, recursoId[]>`**, no lo contrario: la clave es la
 * franja (`"09:30"`) y el valor, qué recursos la tienen libre. Se dice aquí
 * porque la auditoría del paso 4 lo describió al revés y una prueba leyó
 * `huecos[recursoId]` — que no falla, devuelve `undefined` y parece una
 * agenda llena.
 *
 * `recursoId` es genérico a propósito (paso 4a, 18-ago-2026): hasta esta
 * fecha era `staffId` — un profesional era el ÚNICO tipo de recurso posible.
 * Esta función siempre fue pura y ajena a qué es un recurso; el cambio es
 * solo de nombre, para que sirva igual de "sala" o "equipo" el día que un
 * negocio lo declare (docs/korexia/83-RECURSOS-Y-RESERVAS.md).
 *
 * Un slot es válido si: EMPIEZA dentro del horario del negocio (`close` es
 * la última hora a la que se puede EMPEZAR, no una hora a la que todo tiene
 * que estar terminado — un servicio largo agendado a la hora de cerrar
 * sigue después, y eso es lo que quiere el negocio: verificado con el
 * dueño el 18-ago-2026 tras un caso real, "Press on" de 120 min rechazado
 * a las 18:30 con el negocio cerrando a esa hora y la especialista libre
 * toda la tarde), no se solapa con ninguna cita existente de ese recurso, y
 * (si es hoy) no quedó en el pasado. Candidatos: la grilla fija de 30
 * minutos MÁS el instante justo en que termina cada cita existente — así
 * la agenda queda libre al minuto exacto en que se desocupa alguien, sin
 * esperar al siguiente redondeo de media hora.
 */
export function calcularDisponibilidad(input: {
  recursoIds: string[];
  citas: CitaDelDia[];
  duracionMin: number;
  /**
   * La franja **de ese día concreto**, ya resuelta, o `null` si está cerrado.
   *
   * Antes esto recibía el horario entero y usaba su franja común para
   * cualquier día — así que un negocio con sábado corto ofrecía huecos hasta
   * la hora de cierre entre semana. La resuelve quien conoce la fecha
   * (`disponibilidadReal`), que es quien puede.
   */
  franja: FranjaDelDia | null;
  esHoy: boolean;
  minutosAhoraSiEsHoy?: number;
}): Record<string, string[]> {
  if (!input.franja) return {};
  const open = horaAMin(input.franja.abre);
  const close = horaAMin(input.franja.cierra);
  // Un horario que no se entiende no puede pasar por "sin huecos": es
  // indistinguible de una agenda llena, y así se rechazaron citas durante dos
  // días con el salón vacío. Sin huecos que ofrecer no hay nada que hacer, pero
  // que quede dicho en el log en vez de fingir normalidad.
  if (open === null || close === null) {
    console.warn(
      `[citas] horario ilegible (abre "${input.franja.abre}", cierra "${input.franja.cierra}"): no se puede calcular disponibilidad`
    );
    return {};
  }
  const corte = input.esHoy
    ? Math.ceil((input.minutosAhoraSiEsHoy ?? 0) / 30) * 30
    : 0;

  const mapa: Record<string, string[]> = {};
  for (const recursoId of input.recursoIds) {
    const citasRecurso = input.citas.filter((c) => c.recursoId === recursoId);
    const candidatos = new Set<number>();
    for (let t = open; t <= close; t += 30) candidatos.add(t);
    for (const c of citasRecurso) {
      if (c.endMin >= open && c.endMin <= close) {
        candidatos.add(c.endMin);
      }
    }
    for (const slotMin of [...candidatos].sort((a, b) => a - b)) {
      if (slotMin < open || slotMin > close) continue;
      if (input.esHoy && slotMin < corte) continue;
      const libre = !citasRecurso.some(
        (c) => slotMin < c.endMin && slotMin + input.duracionMin > c.startMin
      );
      if (libre) {
        const hora = minAHora(slotMin);
        (mapa[hora] ??= []).push(recursoId);
      }
    }
  }
  return mapa;
}
