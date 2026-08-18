"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CalendarioDia, hoyBogota } from "./calendario-dia";
import { CascadaAgenda } from "./cascada-agenda";

type Appointment = {
  id: string;
  serviceName: string;
  /** TODOS los servicios de la visita ("manos y pies" son dos), no solo el principal. */
  serviceNames?: string[];
  staffName: string;
  contactName: string | null;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: "pendiente" | "confirmada" | "reagendada" | "cancelada" | "completada" | "no_show";
  remindedAt: string | null;
};

const ETIQUETA_ESTADO: Record<Appointment["status"], string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  reagendada: "Reagendada",
  cancelada: "Cancelada",
  completada: "Completada",
  no_show: "No llegó",
};

const VARIANTE_ESTADO: Record<Appointment["status"], "secondary" | "success" | "destructive" | "warning"> = {
  pendiente: "warning",
  confirmada: "success",
  reagendada: "warning",
  cancelada: "destructive",
  completada: "secondary",
  no_show: "destructive",
};

function formatearFechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

const FILTROS: { label: string; value: Appointment["status"] | "" }[] = [
  { label: "Todas", value: "" },
  { label: "Pendientes", value: "pendiente" },
  { label: "Confirmadas", value: "confirmada" },
  { label: "Reagendadas", value: "reagendada" },
  { label: "Canceladas", value: "cancelada" },
  { label: "Completadas", value: "completada" },
];

export function AppointmentsClient() {
  /**
   * La lista muestra el mismo día que el calendario de arriba — no "todas"
   * las citas. Con una sola cita más cada día que pasa, esa lista sin fin
   * se vuelve imposible de recorrer para encontrar una cita concreta
   * (reportado por el dueño, 18-ago-2026). El filtro de estado sigue
   * existiendo, pero ya no reemplaza al de fecha: se aplican los dos juntos.
   */
  const [dia, setDia] = useState(hoyBogota());
  const [citasDelDia, setCitasDelDia] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Appointment["status"] | "">("");
  /** Sube cuando algo cambia la agenda: el calendario recarga su día. */
  const [refresco, setRefresco] = useState(0);

  const refetch = useCallback(async (fecha: string) => {
    const res = await fetch(`/api/appointments?fecha=${fecha}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) return;
    const data = (await res.json()) as { appointments: Appointment[] };
    setCitasDelDia(data.appointments);
  }, []);

  useEffect(() => {
    setLoading(true);
    void refetch(dia);
  }, [dia, refetch]);

  // El filtro de estado es solo del lado del cliente: el día ya viene
  // acotado del servidor (normalmente menos de 20 citas), así que no hace
  // falta una segunda ida y vuelta por cambiar de pestaña.
  const appointments = filtro ? citasDelDia.filter((a) => a.status === filtro) : citasDelDia;

  /** Algo tocó la agenda: se recargan la lista Y el calendario. */
  function refrescarTodo() {
    setRefresco((n) => n + 1);
    void refetch(dia);
  }

  async function cambiarEstado(id: string, status: Appointment["status"]) {
    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    refrescarTodo();
  }

  /**
   * Mover una cita de hora, desde el panel.
   *
   * Antes solo podía hacerlo el agente por WhatsApp: al equipo le tocaba
   * cancelar y crear otra, perdiendo el historial de esa cita — y dejando a la
   * clienta con la hora vieja si el recordatorio ya había salido.
   */
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [nuevaHora, setNuevaHora] = useState("");
  const [errorMover, setErrorMover] = useState<string | null>(null);

  function abrirMover(a: Appointment) {
    const d = new Date(a.startsAt);
    // Se precarga con la hora que ya tiene: casi siempre se mueve poco (media
    // hora, una hora), así que teclear la fecha entera sobra.
    const enBogota = new Date(d.getTime() - 5 * 60 * 60 * 1000);
    setNuevaFecha(enBogota.toISOString().slice(0, 10));
    setNuevaHora(enBogota.toISOString().slice(11, 16));
    setErrorMover(null);
    setMoviendo(a.id);
  }

  async function mover(id: string) {
    setErrorMover(null);
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fecha: nuevaFecha, hora: nuevaHora }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorMover(data?.error?.message ?? "No se pudo mover la cita.");
      return;
    }
    setMoviendo(null);
    refrescarTodo();
  }

  const [recordando, setRecordando] = useState<Set<string>>(new Set());
  const [erroresRecordatorio, setErroresRecordatorio] = useState<Record<string, string>>({});

  async function recordar(id: string) {
    setRecordando((prev) => new Set(prev).add(id));
    setErroresRecordatorio((prev) => ({ ...prev, [id]: "" }));
    const res = await fetch(`/api/appointments/${id}/remind`, { method: "POST" }).catch(() => null);
    setRecordando((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErroresRecordatorio((prev) => ({
        ...prev,
        [id]: data?.error?.message ?? "No se pudo enviar el recordatorio",
      }));
      return;
    }
    void refetch(dia);
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="font-semibold">Citas</h2>
        <p className="text-sm text-muted-foreground">
          Lo que el agente agendó, reprogramó o canceló por WhatsApp.
        </p>
      </header>
      <div className="space-y-4 p-4 md:p-6">
        <CalendarioDia dia={dia} onDiaChange={setDia} refresco={refresco} onCambio={refrescarTodo} />

        <CascadaAgenda onCambio={refrescarTodo} />

        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filtro === f.value ? "default" : "outline"}
              onClick={() => setFiltro(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!loading && appointments.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {citasDelDia.length === 0
              ? "No hay citas agendadas ese día."
              : "Ninguna cita de ese día tiene este estado."}
          </p>
        )}

        <div className="space-y-2">
          {appointments.map((a) => {
            const activa =
              a.status === "pendiente" || a.status === "confirmada" || a.status === "reagendada";
            return (
              <Card key={a.id}>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {(a.serviceNames?.length ? a.serviceNames : [a.serviceName]).join(" + ")}
                        <Badge variant={VARIANTE_ESTADO[a.status]}>{ETIQUETA_ESTADO[a.status]}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatearFechaHora(a.startsAt)} · {a.staffName} · {a.contactName ?? a.contactPhone}
                      </p>
                    </div>
                    {(a.status === "pendiente" || a.status === "reagendada") && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void cambiarEstado(a.id, "confirmada")}>
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => void cambiarEstado(a.id, "cancelada")}
                        >
                          Cancelar
                        </Button>
                      </div>
                    )}
                    {a.status === "confirmada" && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void cambiarEstado(a.id, "completada")}>
                          Completada
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void cambiarEstado(a.id, "no_show")}>
                          No llegó
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => void cambiarEstado(a.id, "cancelada")}
                        >
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </div>

                  {activa && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={recordando.has(a.id)}
                        onClick={() => void recordar(a.id)}
                      >
                        <Bell className="h-3.5 w-3.5" />
                        {recordando.has(a.id) ? "Enviando…" : "Recordar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          moviendo === a.id ? setMoviendo(null) : abrirMover(a)
                        }
                      >
                        <Clock className="h-3.5 w-3.5" />
                        Cambiar hora
                      </Button>
                      {a.remindedAt && !erroresRecordatorio[a.id] && (
                        <span className="text-xs text-muted-foreground">
                          Recordatorio enviado: {formatearFechaHora(a.remindedAt)}
                        </span>
                      )}
                      {erroresRecordatorio[a.id] && (
                        <span className="text-xs text-destructive">{erroresRecordatorio[a.id]}</span>
                      )}
                    </div>
                  )}

                  {moviendo === a.id && (
                    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground" htmlFor={`f-${a.id}`}>
                            Nueva fecha
                          </label>
                          <Input
                            id={`f-${a.id}`}
                            type="date"
                            className="h-8 w-40"
                            value={nuevaFecha}
                            onChange={(e) => setNuevaFecha(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground" htmlFor={`h-${a.id}`}>
                            Nueva hora
                          </label>
                          <Input
                            id={`h-${a.id}`}
                            type="time"
                            step={900}
                            className="h-8 w-28"
                            value={nuevaHora}
                            onChange={(e) => setNuevaHora(e.target.value)}
                          />
                        </div>
                        <Button size="sm" onClick={() => void mover(a.id)}>
                          Mover cita
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setMoviendo(null)}>
                          Cancelar
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Se comprueba que {a.staffName} esté libre y que la hora esté
                        dentro del horario del negocio. La clienta no recibe aviso:
                        díselo tú.
                      </p>
                      {errorMover && <p className="text-xs text-destructive">{errorMover}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
