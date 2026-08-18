"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NuevaCita } from "./nueva-cita";

/**
 * La agenda del día, una columna por especialista.
 *
 * Una lista ordenada por fecha sirve para buscar una cita concreta, pero no
 * para lo que el salón hace cada mañana: mirar cómo va el día y ver dónde
 * quedan huecos. Con 5 especialistas y jornadas de 10 horas, eso solo se lee
 * en rejilla.
 */

type Cita = {
  id: string;
  serviceName: string;
  /** TODOS los servicios de la visita ("manos y pies" son dos), no solo el principal. */
  serviceNames?: string[];
  staffName: string;
  contactName: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
};

/** "Diwpower" o "Diwpower + Tradicionales", según cuántos servicios lleve la visita. */
function nombreDeLaVisita(c: Cita): string {
  return (c.serviceNames?.length ? c.serviceNames : [c.serviceName]).join(" + ");
}

const ACTIVAS = ["pendiente", "confirmada", "reagendada"];

/** Hora de Bogotá de un ISO, en minutos desde medianoche. */
function minutosBogota(iso: string): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const [h, m] = p.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fechaBogota(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function hoyBogota(): string {
  return fechaBogota(new Date().toISOString());
}

/** Minutos desde medianoche, ahora mismo, en Bogotá. */
function ahoraBogota(): number {
  return minutosBogota(new Date().toISOString());
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + dias));
  return t.toISOString().slice(0, 10);
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Etiqueta compacta de la regla de horas: siempre en punto ("9 AM", "12 PM"). */
function hLabel(min: number): string {
  const h = Math.floor(min / 60);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

/** Alto de una hora en la rejilla. 60 px = 1 px por minuto: cuentas fáciles. */
const PX_POR_MIN = 1;
/** Alto de la cabecera de cada columna; la regla de horas lo replica para cuadrar. */
const CABECERA = 36;

export function CalendarioDia({
  dia,
  onDiaChange,
  refresco,
  onCambio,
}: {
  /**
   * El día mostrado, controlado por el padre — para que la lista de abajo
   * (`AppointmentsClient`) muestre las citas de ESE mismo día, en vez de
   * mantener su propio selector aparte y arriesgarse a desincronizar.
   */
  dia: string;
  onDiaChange: (dia: string) => void;
  /** Cambia cuando algo de fuera tocó la agenda: fuerza recargar el día. */
  refresco: number;
  onCambio: () => void;
}) {
  const [citas, setCitas] = useState<Cita[]>([]);
  const [personal, setPersonal] = useState<{ id: string; name: string }[]>([]);
  const [nueva, setNueva] = useState(false);
  const [ahora, setAhora] = useState(ahoraBogota);

  useEffect(() => {
    void fetch("/api/staff")
      .then((r) => (r.ok ? r.json() : { staff: [] }))
      .then((d) => setPersonal(d.staff ?? []))
      .catch(() => setPersonal([]));
  }, []);

  /**
   * El día se le pide al servidor, no se filtra de la lista de abajo: esa
   * viene limitada a 200 y al saltar a un día lejano lo pintaba vacío
   * teniendo citas.
   */
  useEffect(() => {
    let vigente = true;
    void fetch(`/api/appointments?fecha=${dia}`)
      .then((r) => (r.ok ? r.json() : { appointments: [] }))
      .then((d) => {
        if (vigente) setCitas(d.appointments ?? []);
      })
      .catch(() => {
        if (vigente) setCitas([]);
      });
    return () => {
      vigente = false;
    };
  }, [dia, refresco]);

  // La línea de "ahora" avanza sola cada minuto sin recargar la agenda.
  useEffect(() => {
    const t = setInterval(() => setAhora(ahoraBogota()), 60_000);
    return () => clearInterval(t);
  }, []);

  // El servidor ya devuelve solo ese día; aquí solo se quitan las canceladas,
  // que no ocupan hueco en la agenda.
  const delDia = useMemo(
    () => citas.filter((c) => ACTIVAS.includes(c.status)),
    [citas]
  );

  // La rejilla se ajusta a lo que hay: si nadie madruga, no se pintan las 6am.
  const { desde, hasta } = useMemo(() => {
    if (!delDia.length) return { desde: 8 * 60, hasta: 20 * 60 };
    const inicios = delDia.map((c) => minutosBogota(c.startsAt));
    const fines = delDia.map((c) => minutosBogota(c.endsAt));
    return {
      desde: Math.floor(Math.min(...inicios) / 60) * 60,
      hasta: Math.ceil(Math.max(...fines) / 60) * 60,
    };
  }, [delDia]);

  const horas: number[] = [];
  for (let m = desde; m <= hasta; m += 60) horas.push(m);

  // Alto del cuerpo de la rejilla (bajo las cabeceras). Un margen final de 60px
  // deja respirar la última cita y la etiqueta de la última hora.
  const cuerpoAlto = (hasta - desde) * PX_POR_MIN + 60;

  // Solo las columnas que hacen falta: personal con cita ese día, y si no hay
  // nadie, todos (para poder ver la rejilla vacía y agendar encima).
  const columnas = useMemo(() => {
    const conCita = new Set(delDia.map((c) => c.staffName));
    const lista = personal.filter((p) => conCita.has(p.name));
    return lista.length ? lista : personal;
  }, [personal, delDia]);

  const etiquetaDia = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dia}T12:00:00Z`));

  const esHoy = dia === hoyBogota();
  const marcaAhora = esHoy && ahora >= desde && ahora <= hasta;

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
            <span className="truncate font-medium capitalize">{etiquetaDia}</span>
            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {delDia.length} {delDia.length === 1 ? "cita" : "citas"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                aria-label="Día anterior"
                onClick={() => onDiaChange(sumarDias(dia, -1))}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button
                variant={esHoy ? "secondary" : "outline"}
                size="sm"
                onClick={() => onDiaChange(hoyBogota())}
              >
                Hoy
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Día siguiente"
                onClick={() => onDiaChange(sumarDias(dia, 1))}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            </div>

            {/*
              Ir a un día concreto sin dar veinte clics en la flecha: mirar
              "el martes de la otra semana" es lo normal en un salón, y con
              solo ‹ › eso son ocho pulsaciones.
            */}
            <Input
              type="date"
              aria-label="Ir a una fecha"
              className="h-9 w-[9.5rem] px-2"
              value={dia}
              onChange={(e) => {
                if (e.target.value) onDiaChange(e.target.value);
              }}
            />

            <Button size="sm" onClick={() => setNueva((v) => !v)}>
              <Plus className="h-4 w-4" strokeWidth={1.7} />
              Nueva cita
            </Button>
          </div>
        </div>

        {nueva && (
          <NuevaCita
            fechaSugerida={dia}
            onListo={() => {
              setNueva(false);
              onCambio();
            }}
            onCancelar={() => setNueva(false)}
          />
        )}

        {columnas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay especialistas. Créalos en <strong>Servicios</strong>.
          </p>
        ) : (
          /* La rejilla se desplaza de lado dentro de su caja: la página nunca se
             mueve. La regla de horas queda fija a la izquierda al hacer scroll. */
          <div className="overflow-x-auto rounded-md border">
            <div className="flex min-w-max">
              {/* Regla de horas (fija a la izquierda) */}
              <div className="sticky left-0 z-20 w-14 shrink-0 border-r bg-card">
                <div style={{ height: CABECERA }} className="border-b" />
                <div className="relative" style={{ height: cuerpoAlto }}>
                  {horas.map((m) => (
                    <span
                      key={m}
                      className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-text-3"
                      style={{ top: (m - desde) * PX_POR_MIN }}
                    >
                      {hLabel(m)}
                    </span>
                  ))}
                  {marcaAhora && (
                    <span
                      className="absolute right-0 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-destructive"
                      style={{ top: (ahora - desde) * PX_POR_MIN }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>

              {columnas.map((p) => {
                const suyas = delDia.filter((c) => c.staffName === p.name);
                return (
                  <div key={p.id} className="w-48 shrink-0 border-r last:border-r-0">
                    <div
                      className="flex items-center justify-center border-b px-2"
                      style={{ height: CABECERA }}
                    >
                      <span className="truncate text-sm font-medium">{p.name}</span>
                    </div>
                    <div className="relative" style={{ height: cuerpoAlto }}>
                      {horas.map((m) => (
                        <div
                          key={m}
                          className="absolute inset-x-0 border-t border-border"
                          style={{ top: (m - desde) * PX_POR_MIN }}
                        />
                      ))}
                      {suyas.map((c) => {
                        const ini = minutosBogota(c.startsAt);
                        const fin = minutosBogota(c.endsAt);
                        const alto = Math.max((fin - ini) * PX_POR_MIN, 22);
                        const compacta = alto < 34;
                        // La cinta lateral da el estado de un vistazo, con el mismo
                        // lenguaje de color que las tarjetas de abajo.
                        const cinta = c.status === "confirmada" ? "bg-success" : "bg-warning";
                        return (
                          <div
                            key={c.id}
                            title={`${hhmm(ini)}–${hhmm(fin)} · ${nombreDeLaVisita(c)}${
                              c.contactName ? ` · ${c.contactName}` : ""
                            }`}
                            className="absolute inset-x-1 flex overflow-hidden rounded-md border border-brand-soft bg-brand-tint text-brand-text shadow-sm"
                            style={{
                              top: (ini - desde) * PX_POR_MIN,
                              height: alto - 2,
                            }}
                          >
                            <span className={cn("w-1 shrink-0", cinta)} aria-hidden />
                            <div
                              className={cn(
                                "min-w-0 flex-1 overflow-hidden px-1.5 leading-tight",
                                compacta ? "py-0.5" : "py-1"
                              )}
                            >
                              {compacta ? (
                                <p className="truncate text-[11px]">
                                  <span className="font-medium tabular-nums">{hhmm(ini)}</span>
                                  {" · "}
                                  {nombreDeLaVisita(c)}
                                </p>
                              ) : (
                                <>
                                  <p className="truncate text-[11px] font-medium tabular-nums">
                                    {hhmm(ini)}
                                    {alto >= 40 ? `–${hhmm(fin)}` : ""}
                                  </p>
                                  {/*
                                    Sin `truncate`: una visita de "manos y
                                    pies" no cabe en una sola línea de 176px,
                                    y verla cortada ("Semipermanente +
                                    Semip…") es justo lo que hace pensar que
                                    la reserva quedó incompleta. Estas tarjetas
                                    ya tienen alto de sobra (vienen de la
                                    duración real de la cita), así que
                                    envolver es seguro.
                                  */}
                                  <p className="break-words text-[11px] leading-snug">
                                    {nombreDeLaVisita(c)}
                                  </p>
                                  {c.contactName && alto >= 52 && (
                                    <p className="truncate text-[11px] text-text-3">
                                      {c.contactName}
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {marcaAhora && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 border-t border-destructive"
                          style={{ top: (ahora - desde) * PX_POR_MIN }}
                          aria-hidden
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
