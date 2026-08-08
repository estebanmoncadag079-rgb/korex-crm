"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Agendar a mano, desde el panel.
 *
 * Hasta ahora las citas solo nacían por WhatsApp. La clienta que llama por
 * teléfono, escribe por Instagram o llega al local **no existía en la
 * agenda** — y el agente daba ese hueco por libre y se lo ofrecía a otra.
 *
 * Pasa por el mismo motor que usa el agente: si el horario no cabe o la
 * especialista está ocupada, el servidor lo rechaza igual. Que lo escriba una
 * persona no lo hace más fiable.
 */

type Servicio = { id: string; name: string; durationMin: number; priceCents: number };
type Persona = { id: string; name: string };

export function NuevaCita({
  fechaSugerida,
  onListo,
  onCancelar,
}: {
  fechaSugerida: string;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const uid = useId();
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [personal, setPersonal] = useState<Persona[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [fecha, setFecha] = useState(fechaSugerida);
  const [hora, setHora] = useState("09:00");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch("/api/services").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/staff").then((r) => (r.ok ? r.json() : null)),
    ]).then(([s, p]) => {
      if (s?.services) setServicios(s.services);
      if (p?.staff) setPersonal(p.staff);
    });
  }, []);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(null);
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId,
        staffId: staffId || undefined,
        fecha,
        hora,
        clienteNombre: nombre,
        clienteTelefono: telefono,
      }),
    });
    const data = await res.json().catch(() => null);
    setGuardando(false);
    if (!res.ok) {
      setError(data?.error?.message ?? "No se pudo agendar");
      return;
    }
    setOk(`Agendada con ${data.appointment?.staffName ?? "el equipo"}`);
    setNombre("");
    setTelefono("");
    onListo();
  }

  const listo = serviceId && fecha && hora && nombre.trim() && telefono.trim();

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Nueva cita (por teléfono o en el local)</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${uid}-servicio`}>Servicio</Label>
          <Select
            id={`${uid}-servicio`}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">Elige…</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.durationMin} min)
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${uid}-especialista`}>Especialista</Label>
          <Select
            id={`${uid}-especialista`}
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">La que esté libre</option>
            {personal.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${uid}-fecha`}>Día</Label>
            <Input
              id={`${uid}-fecha`}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-hora`}>Hora</Label>
            <Input
              id={`${uid}-hora`}
              type="time"
              step={900}
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${uid}-nombre`}>Nombre de la clienta</Label>
          <Input
            id={`${uid}-nombre`}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Tatiana Erazo"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${uid}-celular`}>Celular</Label>
          <Input
            id={`${uid}-celular`}
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="300 123 4567"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        El celular sirve para que la cita quede unida a su conversación de
        WhatsApp: así el agente sabe que ya tiene cita y se le puede recordar.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {ok && <p className="text-sm text-success">{ok}</p>}

      <div className="flex gap-2">
        <Button size="sm" disabled={!listo || guardando} onClick={() => void guardar()}>
          {guardando ? "Agendando…" : "Agendar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
