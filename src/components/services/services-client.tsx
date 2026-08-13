"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImportarCatalogo } from "@/components/services/importar-catalogo";

type Service = {
  id: string;
  name: string;
  category: string | null;
  priceCents: number;
  durationMin: number;
  archivedAt: string | null;
};

type Staff = {
  id: string;
  name: string;
  archivedAt: string | null;
  serviceIds: string[];
};

function pesos(cents: number): string {
  return (cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 });
}

export function ServicesClient() {
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const [s, p] = await Promise.all([
      fetch("/api/services").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/staff").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    setLoading(false);
    if (s) setServices(s.services);
    if (p) setStaff(p.staff);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="font-semibold">Servicios y personal</h2>
        <p className="text-sm text-muted-foreground">
          El catálogo que usa el agente para agendar citas: qué servicios ofreces,
          cuánto duran y quién los atiende.
        </p>
      </header>
      {/* Cargar el catálogo entero va ARRIBA y a todo lo ancho: es lo primero
          que necesita un salón recién entrado, y mientras el alta de uno en uno
          fue la única puerta, el catálogo sencillamente no se cargaba. */}
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <ImportarCatalogo onImportado={() => void refetch()} />
      </div>
      <div className="grid gap-4 p-4 md:gap-6 md:p-6 lg:grid-cols-2">
        <ServicesSection services={services} onChanged={() => void refetch()} />
        <StaffSection
          staff={staff}
          services={services}
          onChanged={() => void refetch()}
        />
      </div>
    </div>
  );
}

function ServicesSection({
  services,
  onChanged,
}: {
  services: Service[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    const priceCents = Math.round(Number(price) * 100);
    const durationMin = Number(duration);
    if (!name.trim() || !Number.isFinite(priceCents) || !Number.isFinite(durationMin) || durationMin <= 0) {
      setError("Nombre, precio y duración (minutos) son obligatorios.");
      return;
    }
    setError(null);
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        category: category.trim() || undefined,
        priceCents,
        durationMin,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo crear el servicio.");
      return;
    }
    setName("");
    setCategory("");
    setPrice("");
    setDuration("");
    onChanged();
  }

  const activos = services.filter((s) => !s.archivedAt);
  const archivados = services.filter((s) => s.archivedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Servicios</CardTitle>
        <CardDescription>Nombre, precio y duración: de ahí calcula el agente la disponibilidad real.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo servicio</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nombre (p. ej. Semipermanente)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Categoría (opcional)" value={category} onChange={(e) => setCategory(e.target.value)} />
            <Input placeholder="Precio en COP (p. ej. 40000)" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Input placeholder="Duración en minutos (p. ej. 45)" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={() => void crear()}>
            <Plus className="h-4 w-4" /> Agregar servicio
          </Button>
        </div>

        <div className="space-y-2">
          {activos.length === 0 && (
            <p className="text-sm text-muted-foreground">Todavía no hay servicios.</p>
          )}
          {activos.map((s) => (
            <ServiceRow key={s.id} service={s} onChanged={onChanged} />
          ))}
        </div>

        {archivados.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Archivados ({archivados.length})
            </summary>
            <div className="mt-2 space-y-2">
              {archivados.map((s) => (
                <ServiceRow key={s.id} service={s} onChanged={onChanged} />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceRow({ service, onChanged }: { service: Service; onChanged: () => void }) {
  const [editando, setEditando] = useState(false);

  async function archivar(archived: boolean) {
    await fetch(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived }),
    }).catch(() => null);
    onChanged();
  }

  if (editando) {
    return (
      <ServiceEditor
        service={service}
        onCancelar={() => setEditando(false)}
        onGuardado={() => {
          setEditando(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {service.name}
          {service.category && <span className="ml-1.5 text-xs text-muted-foreground">({service.category})</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          ${pesos(service.priceCents)} · {service.durationMin} min
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {!service.archivedAt && (
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void archivar(!service.archivedAt)}
        >
          {service.archivedAt ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" /> Reactivar
            </>
          ) : (
            <>
              <Trash2 className="h-3.5 w-3.5" /> Archivar
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * Editar un servicio en su sitio (9-ago-2026).
 *
 * El servidor ya sabía hacerlo — `PATCH /api/services/[id]` acepta nombre,
 * categoría, precio y duración — pero la pantalla solo ofrecía archivar, así
 * que subir un precio obligaba a archivar y recrear el servicio, o a entrar a
 * la base de datos. Con un cliente se aguanta; con veinticinco negocios
 * cambiando precios, cada cambio pasaba por la agencia.
 */
function ServiceEditor({
  service,
  onCancelar,
  onGuardado,
}: {
  service: Service;
  onCancelar: () => void;
  onGuardado: () => void;
}) {
  const [name, setName] = useState(service.name);
  const [category, setCategory] = useState(service.category ?? "");
  const [price, setPrice] = useState(String(Math.round(service.priceCents / 100)));
  const [duration, setDuration] = useState(String(service.durationMin));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const priceCents = Math.round(Number(price) * 100);
    const durationMin = Number(duration);
    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError("El precio no es válido.");
      return;
    }
    if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 600) {
      setError("La duración va de 5 a 600 minutos.");
      return;
    }
    setError(null);
    setGuardando(true);
    const res = await fetch(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        category: category.trim() || null,
        priceCents,
        durationMin,
      }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      setError("No se pudo guardar el cambio.");
      return;
    }
    onGuardado();
  }

  const cambioDuracion = Number(duration) !== service.durationMin;

  return (
    <div className="space-y-2 rounded-md border border-primary/40 p-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label="Nombre del servicio"
          placeholder="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="Categoría"
          placeholder="Categoría (opcional)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Input
          aria-label="Precio en COP"
          placeholder="Precio en COP"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          aria-label="Duración en minutos"
          placeholder="Duración en minutos"
          inputMode="numeric"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        El precio nuevo es el que dirá el agente desde ya.{" "}
        {cambioDuracion
          ? "Al cambiar la duración, las citas ya agendadas conservan su hora: solo cambia lo que se agende de aquí en adelante."
          : "Las citas ya agendadas no se mueven."}
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-1.5">
        <Button size="sm" disabled={guardando} onClick={() => void guardar()}>
          <Check className="h-3.5 w-3.5" /> {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button size="sm" variant="outline" disabled={guardando} onClick={onCancelar}>
          <X className="h-3.5 w-3.5" /> Cancelar
        </Button>
      </div>
    </div>
  );
}

function StaffSection({
  staff,
  services,
  onChanged,
}: {
  staff: Staff[];
  services: Service[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const activos = services.filter((s) => !s.archivedAt);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function crear() {
    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setError(null);
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), serviceIds: [...selected] }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo crear la especialista.");
      return;
    }
    setName("");
    setSelected(new Set());
    onChanged();
  }

  const staffActivo = staff.filter((s) => !s.archivedAt);
  const staffArchivado = staff.filter((s) => s.archivedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal</CardTitle>
        <CardDescription>Quién atiende cada servicio. Un servicio sin nadie asignado no se puede agendar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva persona del equipo</p>
          <Input placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
          {activos.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Servicios que atiende</Label>
              <div className="flex flex-wrap gap-2">
                {activos.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={() => void crear()}>
            <Plus className="h-4 w-4" /> Agregar persona
          </Button>
        </div>

        <div className="space-y-2">
          {staffActivo.length === 0 && (
            <p className="text-sm text-muted-foreground">Todavía no hay personal registrado.</p>
          )}
          {staffActivo.map((s) => (
            <StaffRow key={s.id} staff={s} services={activos} onChanged={onChanged} />
          ))}
        </div>

        {staffArchivado.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Archivados ({staffArchivado.length})
            </summary>
            <div className="mt-2 space-y-2">
              {staffArchivado.map((s) => (
                <StaffRow key={s.id} staff={s} services={activos} onChanged={onChanged} />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function StaffRow({
  staff,
  services,
  onChanged,
}: {
  staff: Staff;
  services: Service[];
  onChanged: () => void;
}) {
  async function patch(patch: { archived?: boolean; serviceIds?: string[] }) {
    await fetch(`/api/staff/${staff.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    onChanged();
  }

  function toggleServicio(id: string) {
    const next = staff.serviceIds.includes(id)
      ? staff.serviceIds.filter((s) => s !== id)
      : [...staff.serviceIds, id];
    void patch({ serviceIds: next });
  }

  return (
    <div className="space-y-1.5 rounded-md border p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{staff.name}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void patch({ archived: !staff.archivedAt })}
        >
          {staff.archivedAt ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" /> Reactivar
            </>
          ) : (
            <>
              <Trash2 className="h-3.5 w-3.5" /> Archivar
            </>
          )}
        </Button>
      </div>
      {services.length > 0 && !staff.archivedAt && (
        <div className="flex flex-wrap gap-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={staff.serviceIds.includes(s.id)}
                onChange={() => toggleServicio(s.id)}
                className="h-3.5 w-3.5 accent-primary"
              />
              {s.name}
            </label>
          ))}
        </div>
      )}
      {staff.archivedAt && (
        <div className="flex flex-wrap gap-1.5">
          {staff.serviceIds.map((id) => {
            const nombre = services.find((s) => s.id === id)?.name;
            return nombre ? (
              <Badge key={id} variant="secondary">{nombre}</Badge>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
