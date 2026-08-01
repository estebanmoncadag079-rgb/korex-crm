"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Appointment = {
  id: string;
  serviceName: string;
  staffName: string;
  contactName: string | null;
  contactPhone: string;
  startsAt: string;
  endsAt: string;
  status: "pendiente" | "confirmada" | "reagendada" | "cancelada" | "completada" | "no_show";
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
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Appointment["status"] | "">("");

  const refetch = useCallback(async (status: Appointment["status"] | "") => {
    const qs = status ? `?status=${status}` : "";
    const res = await fetch(`/api/appointments${qs}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) return;
    const data = (await res.json()) as { appointments: Appointment[] };
    setAppointments(data.appointments);
  }, []);

  useEffect(() => {
    setLoading(true);
    void refetch(filtro);
  }, [filtro, refetch]);

  async function cambiarEstado(id: string, status: Appointment["status"]) {
    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    void refetch(filtro);
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
          <p className="text-sm text-muted-foreground">No hay citas para este filtro.</p>
        )}

        <div className="space-y-2">
          {appointments.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {a.serviceName}
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
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
