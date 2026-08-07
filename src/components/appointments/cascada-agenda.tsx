"use client";

import { useEffect, useState } from "react";
import { CalendarX2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Mover el día entero de una especialista: pasarlo a otra persona o
 * liberarlo. Lo pide el salón cuando alguien se enferma o no llega.
 *
 * Regla de la pantalla: **nada se ejecuta sin ver antes a quién afecta**.
 * Las dos acciones escriben en la agenda y le escriben a clientas reales por
 * WhatsApp — no se deshacen solas.
 */

type CitaResumen = {
  id: string;
  clienta: string;
  servicio: string;
  fecha: string;
  hora: string;
  motivo?: string;
};

type Persona = { id: string; name: string };

type Resultado = {
  aplicadas: CitaResumen[];
  conflictos: CitaResumen[];
  avisos: { avisadas: number; sinAvisar: { clienta: string; motivo: string }[] };
};

/** Hoy en Bogotá, en el formato que espera el endpoint. */
function hoyEnBogota(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return p; // AAAA-MM-DD
}

export function CascadaAgenda({ onCambio }: { onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [personal, setPersonal] = useState<Persona[]>([]);
  const [staffId, setStaffId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [fecha, setFecha] = useState(hoyEnBogota());
  const [previa, setPrevia] = useState<CitaResumen[] | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    void fetch("/api/staff")
      .then((r) => (r.ok ? r.json() : { staff: [] }))
      .then((d) => setPersonal(d.staff ?? []))
      .catch(() => setPersonal([]));
  }, [abierto]);

  async function llamar(accion: "ver" | "reasignar" | "liberar") {
    setCargando(true);
    setError(null);
    const res = await fetch("/api/appointments/agenda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, staffId, fecha, staffDestinoId: destinoId || undefined }),
    });
    const data = await res.json().catch(() => null);
    setCargando(false);
    if (!res.ok) {
      setError(data?.error?.message ?? "No se pudo completar la operación");
      return null;
    }
    return data;
  }

  async function verAgenda() {
    setResultado(null);
    const d = await llamar("ver");
    if (d) setPrevia(d.citas ?? []);
  }

  async function ejecutar(accion: "reasignar" | "liberar") {
    const cuantas = previa?.length ?? 0;
    const aviso =
      accion === "liberar"
        ? `Se van a CANCELAR ${cuantas} cita(s) y se le escribirá a cada clienta. Esto no se deshace. ¿Sigo?`
        : `Se van a pasar ${cuantas} cita(s) a otra persona y se le escribirá a cada clienta. ¿Sigo?`;
    if (!confirm(aviso)) return;
    const d = await llamar(accion);
    if (d) {
      setResultado(d);
      setPrevia(null);
      onCambio();
    }
  }

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <Users className="mr-1.5 h-4 w-4" strokeWidth={1.7} />
        Mover el día de una especialista
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">Mover el día de una especialista</p>
          <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
            Cerrar
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Especialista</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={staffId}
              onChange={(e) => {
                setStaffId(e.target.value);
                setPrevia(null);
              }}
            >
              <option value="">Elige…</option>
              {personal.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">Día</span>
            <input
              type="date"
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value);
                setPrevia(null);
              }}
            />
          </label>

          <label className="text-sm">
            <span className="text-muted-foreground">Pasar sus citas a</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
            >
              <option value="">(solo liberar el día)</option>
              {personal
                .filter((p) => p.id !== staffId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <Button size="sm" onClick={verAgenda} disabled={!staffId || cargando}>
          {cargando ? "Consultando…" : "Ver qué citas tiene ese día"}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {previa && (
          <div className="space-y-2 rounded-md border p-3">
            {previa.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tiene citas activas ese día. No hay nada que mover.
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">{previa.length} cita(s) ese día:</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {previa.map((c) => (
                    <li key={c.id}>
                      {c.hora} · {c.servicio} · {c.clienta}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Se le escribirá a cada clienta por WhatsApp. A quien no haya
                  escrito en las últimas 24 h habrá que llamarla — se listan al
                  terminar.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={!destinoId || cargando}
                    onClick={() => void ejecutar("reasignar")}
                  >
                    <Users className="mr-1.5 h-4 w-4" strokeWidth={1.7} />
                    Pasar a otra persona
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={cargando}
                    onClick={() => void ejecutar("liberar")}
                  >
                    <CalendarX2 className="mr-1.5 h-4 w-4" strokeWidth={1.7} />
                    Cancelar todas
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {resultado && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">
              Listo: {resultado.aplicadas.length} cita(s) · {resultado.avisos.avisadas}{" "}
              clienta(s) avisada(s)
            </p>
            {resultado.conflictos.length > 0 && (
              <div>
                <p className="font-medium text-[#8a6d3b]">
                  Sin mover ({resultado.conflictos.length}) — resuélvelas a mano:
                </p>
                <ul className="text-muted-foreground">
                  {resultado.conflictos.map((c) => (
                    <li key={c.id}>
                      {c.hora} · {c.clienta} — {c.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resultado.avisos.sinAvisar.length > 0 && (
              <div>
                <p className="font-medium text-destructive">
                  Hay que LLAMAR a {resultado.avisos.sinAvisar.length}:
                </p>
                <ul className="text-muted-foreground">
                  {resultado.avisos.sinAvisar.map((s, i) => (
                    <li key={i}>
                      {s.clienta} — {s.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
