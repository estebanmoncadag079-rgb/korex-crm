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
import { Select } from "@/components/ui/select";
import { ImportarCatalogo } from "@/components/services/importar-catalogo";

/** Marcador del desplegable para escribir una categoría que todavía no existe. */
const NUEVA = "__nueva__";

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
      <div className="space-y-3 px-4 pt-4 md:px-6 md:pt-6">
        <ImportarCatalogo onImportado={() => void refetch()} />
        <SinEspecialista services={services} staff={staff} />
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

/**
 * Los servicios que no atiende nadie.
 *
 * Existen en el catálogo, tienen precio y el agente puede mencionarlos, pero
 * **no se pueden agendar**: ante uno de estos responde "ese servicio no está
 * disponible para agendar por ahora". Un servicio recién creado nace así —
 * `createService` no marca ninguna casilla—, y nada lo advertía: el hueco solo
 * aparecía cuando una clienta pedía justo ese servicio.
 *
 * Se calcula aquí y no en el servidor porque los servicios y el personal ya
 * viajan a esta pantalla: pedirlo aparte sería una consulta de más para un dato
 * que ya está en la mano.
 */
function SinEspecialista({
  services,
  staff,
}: {
  services: Service[];
  staff: Staff[];
}) {
  const cubiertos = new Set(
    staff.filter((p) => !p.archivedAt).flatMap((p) => p.serviceIds)
  );
  const huerfanos = services.filter((s) => !s.archivedAt && !cubiertos.has(s.id));
  if (huerfanos.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="text-sm font-medium">
        ⚠️ {huerfanos.length}{" "}
        {huerfanos.length === 1
          ? "servicio no lo atiende nadie"
          : "servicios no los atiende nadie"}
        : no se {huerfanos.length === 1 ? "puede" : "pueden"} agendar.
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Márcalos en la ficha de cada especialista, abajo, en &ldquo;Servicios que
        atiende&rdquo;.
      </p>
      <p className="mt-2 text-[13px]">
        {huerfanos.map((s) => s.name).join(" · ")}
      </p>
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
  const categorias = categoriasDe(services);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Servicios</CardTitle>
        <CardDescription>Nombre, precio y duración: de ahí calcula el agente la disponibilidad real.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CategoriasSection services={services} onChanged={onChanged} />

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo servicio</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nombre (p. ej. Semipermanente)" value={name} onChange={(e) => setName(e.target.value)} />
            <SelectorDeCategoria valor={category} categorias={categorias} onChange={setCategory} />
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
            <ServiceRow key={s.id} service={s} categorias={categorias} onChanged={onChanged} />
          ))}
        </div>

        {archivados.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Archivados ({archivados.length})
            </summary>
            <div className="mt-2 space-y-2">
              {archivados.map((s) => (
                <ServiceRow key={s.id} service={s} categorias={categorias} onChanged={onChanged} />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceRow({
  service,
  categorias,
  onChanged,
}: {
  service: Service;
  categorias: string[];
  onChanged: () => void;
}) {
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
        categorias={categorias}
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
/**
 * Las categorías que el negocio usa ahora mismo, sacadas de sus propios
 * servicios.
 *
 * NO hay tabla de categorías, y es deliberado: una categoría no es una entidad
 * con vida propia, es **cómo el negocio agrupa lo que vende**. Guardarla aparte
 * obligaría a mantener dos fuentes sincronizadas y a decidir qué pasa con una
 * categoría que ya no usa nadie — el problema del "dueño por dato" que este
 * proyecto ya pagó una vez (docs/korexia/68-UN-DUENO-POR-DATO.md). Aquí lo
 * derivado se recompila: la lista sale de los servicios, siempre.
 *
 * Se incluyen las de los archivados a propósito: si se reactiva uno, su
 * categoría no debe aparecer de la nada como si fuera nueva.
 */
export function categoriasDe(services: Service[]): string[] {
  const vistas = new Map<string, string>();
  for (const s of services) {
    const c = s.category?.trim();
    // Gana la PRIMERA forma en que se escribió, no la última: si el catálogo
    // trae "Pestañas" y "PESTAÑAS", la lista debe quedarse con una sola y con
    // la que el negocio escribió primero — no con la que quedó de última por
    // el orden en que vinieron las filas.
    if (c && !vistas.has(c.toLowerCase())) vistas.set(c.toLowerCase(), c);
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Ver, renombrar y eliminar las categorías del catálogo.
 *
 * No hay "crear" y no es un olvido: **una categoría nace cuando un servicio la
 * usa**. Una categoría vacía no se podría mostrar en ningún sitio ni serviría
 * para agrupar nada, así que se crea desde el desplegable de un servicio
 * ("+ Nueva categoría…"), que es donde tiene sentido.
 *
 * Eliminar deja a esos servicios **sin categoría**; no borra ningún servicio.
 * Se avisa con el número exacto porque un catálogo de 46 servicios no se revisa
 * a ojo después.
 */
function CategoriasSection({
  services,
  onChanged,
}: {
  services: Service[];
  onChanged: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categorias = categoriasDe(services);
  const cuantos = (c: string) =>
    services.filter((s) => s.category?.trim().toLowerCase() === c.toLowerCase()).length;

  async function aplicar(desde: string, hasta: string | null) {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/services/categorias", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ desde, hasta }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      setError("No se pudo cambiar la categoría.");
      return;
    }
    setEditando(null);
    setNombre("");
    onChanged();
  }

  if (categorias.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Categorías</p>
      <p className="text-xs text-muted-foreground">
        Se crean al asignarlas a un servicio. Eliminar una deja sus servicios sin
        categoría — no borra ningún servicio.
      </p>
      <div className="flex flex-wrap gap-2">
        {categorias.map((c) =>
          editando === c ? (
            <div key={c} className="flex items-center gap-1.5">
              <Input
                aria-label={`Nuevo nombre para ${c}`}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="h-8 w-44"
                autoFocus
              />
              <Button
                size="sm"
                disabled={ocupado || !nombre.trim()}
                onClick={() => void aplicar(c, nombre.trim())}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditando(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <span
              key={c}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            >
              {c}
              <span className="text-muted-foreground">({cuantos(c)})</span>
              <button
                type="button"
                aria-label={`Renombrar ${c}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setEditando(c);
                  setNombre(c);
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Eliminar ${c}`}
                disabled={ocupado}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  const n = cuantos(c);
                  if (
                    confirm(
                      `¿Eliminar la categoría "${c}"?\n\n${n} servicio(s) se quedarán sin categoría. No se borra ningún servicio.`
                    )
                  ) {
                    void aplicar(c, null);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          )
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Elegir una categoría de las que ya existen, o escribir una nueva.
 *
 * Antes era un campo de texto libre, y el texto libre en un catálogo termina
 * igual siempre: "Pestañas", "pestañas" y "Pestaña" como tres categorías
 * distintas. El desplegable hace que reutilizar sea lo fácil y crear sea lo
 * deliberado.
 */
function SelectorDeCategoria({
  valor,
  categorias,
  onChange,
  id,
}: {
  valor: string;
  categorias: string[];
  onChange: (v: string) => void;
  id?: string;
}) {
  // Escribiendo una nueva: o lo pidió explícitamente, o el valor que trae no
  // está entre las existentes (un servicio importado, por ejemplo).
  const [escribiendo, setEscribiendo] = useState(
    Boolean(valor) && !categorias.some((c) => c.toLowerCase() === valor.toLowerCase())
  );

  if (escribiendo) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          aria-label="Categoría nueva"
          placeholder="Categoría nueva (p. ej. Pestañas)"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
        <Button
          size="sm"
          variant="outline"
          type="button"
          aria-label="Elegir una categoría existente"
          onClick={() => {
            setEscribiendo(false);
            onChange("");
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Select
      id={id}
      aria-label="Categoría"
      value={valor}
      onChange={(e) => {
        if (e.target.value === NUEVA) {
          setEscribiendo(true);
          onChange("");
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">Sin categoría</option>
      {categorias.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={NUEVA}>+ Nueva categoría…</option>
    </Select>
  );
}

function ServiceEditor({
  service,
  categorias,
  onCancelar,
  onGuardado,
}: {
  service: Service;
  categorias: string[];
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
        <SelectorDeCategoria
          valor={category}
          categorias={categorias}
          onChange={setCategory}
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
  /*
   * Los servicios de una persona se editan y LUEGO se guardan.
   *
   * Antes cada casilla guardaba sola, al instante: un clic de más —o un roce en
   * el móvil, con 46 casillas juntas— asignaba un servicio a alguien que no lo
   * hace, sin aviso ni forma de deshacerlo. Y el agente agenda con esa matriz:
   * una casilla marcada por error manda una clienta con la especialista
   * equivocada. Pedido por el dueño el 18-ago-2026.
   *
   * De paso, en reposo se muestran solo los servicios que SÍ atiende: la lista
   * completa con todo desmarcado ocupaba media pantalla por persona y no se
   * leía.
   */
  const [editando, setEditando] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set(staff.serviceIds));
  const [guardando, setGuardando] = useState(false);

  async function patch(patch: { archived?: boolean; serviceIds?: string[] }) {
    await fetch(`/api/staff/${staff.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    onChanged();
  }

  function toggleServicio(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function guardar() {
    setGuardando(true);
    await patch({ serviceIds: [...seleccion] });
    setGuardando(false);
    setEditando(false);
  }

  function empezarAEditar() {
    // Se parte SIEMPRE de lo que hay guardado, no de la selección anterior:
    // si alguien canceló y vuelve a entrar, no debe encontrarse sus cambios
    // descartados todavía marcados.
    setSeleccion(new Set(staff.serviceIds));
    setEditando(true);
  }

  const asignados = services.filter((s) => staff.serviceIds.includes(s.id));
  const cambios =
    seleccion.size !== staff.serviceIds.length ||
    staff.serviceIds.some((id) => !seleccion.has(id));

  return (
    <div className="space-y-1.5 rounded-md border p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{staff.name}</p>
        <div className="flex items-center gap-1.5">
          {!staff.archivedAt && services.length > 0 && !editando && (
            <Button size="sm" variant="outline" onClick={empezarAEditar}>
              <Pencil className="h-3.5 w-3.5" /> Editar servicios
            </Button>
          )}
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
      </div>

      {/* En reposo: solo lo que atiende, sin casillas que se puedan tocar. */}
      {!editando && !staff.archivedAt && (
        <div className="flex flex-wrap gap-1.5">
          {asignados.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No atiende ningún servicio todavía.
            </p>
          ) : (
            asignados.map((s) => (
              <Badge key={s.id} variant="secondary">
                {s.name}
              </Badge>
            ))
          )}
        </div>
      )}

      {editando && !staff.archivedAt && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={seleccion.has(s.id)}
                  onChange={() => toggleServicio(s.id)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {s.name}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={guardando || !cambios} onClick={() => void guardar()}>
              <Check className="h-3.5 w-3.5" /> Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
              <X className="h-3.5 w-3.5" /> Cancelar
            </Button>
            {cambios && (
              <span className="text-xs text-muted-foreground">Sin guardar</span>
            )}
          </div>
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
