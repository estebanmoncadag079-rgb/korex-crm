"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { coincideConLaBusqueda } from "@/lib/zonas-busqueda";

/**
 * Las zonas de domicilio del negocio: a qué barrio se entrega y por cuánto.
 *
 * Fase 8G — nace de un incidente real (MALIA, 8-sep-2026): sus tarifas vivían
 * como prosa en la ficha, con una regla final de "cualquier otro barrio,
 * $8.000". El agente cumplía esa regla al pie de la letra y cobraba $8.000 a
 * barrios que en realidad quedaban lejos (Cañasgordas, Marroquín) — el
 * negocio perdía plata en cada uno de esos pedidos, en silencio.
 *
 * Una zona cargada aquí es un HECHO que el servidor verifica, no una frase
 * que el modelo tenga que interpretar. Y un barrio que no esté en esta lista
 * ya no se cotiza a ojo: el agente dice que lo confirma con el equipo.
 *
 * Los textos son deliberadamente genéricos ("zona"): esta pantalla la ve
 * cualquier negocio de pedidos que haga domicilios, no un cliente concreto.
 */

type Zona = {
  id: string;
  nombre: string;
  feeCents: number;
  activa: boolean;
};

function centsAPesos(cents: number): string {
  return (cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 });
}

function pesosACents(texto: string): number | null {
  const limpio = texto.replace(/[^\d]/g, "");
  if (!limpio) return null;
  return Math.round(Number(limpio) * 100);
}

export function ZonasDomicilio() {
  const [zonas, setZonas] = useState<Zona[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch("/api/domicilios").catch(() => null);
    if (!res?.ok) {
      setZonas([]);
      setError("No pudimos cargar tus zonas de domicilio.");
      return;
    }
    const data = (await res.json()) as { zonas: Zona[] };
    setZonas(data.zonas);
    setError(null);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function crearZona(datos: { nombre: string; precio: string }) {
    setError(null);
    const feeCents = pesosACents(datos.precio);
    if (feeCents === null) {
      setError("Escribe el valor del domicilio para esa zona.");
      return;
    }
    const res = await fetch("/api/domicilios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre: datos.nombre.trim(), feeCents }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo crear la zona. Vuelve a intentarlo.");
      return;
    }
    setCreando(false);
    await refetch();
  }

  if (zonas === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  const activas = zonas.filter((z) => z.activa).length;
  const buscando = busqueda.trim().length > 0;
  const encontradas = zonas.filter((z) => coincideConLaBusqueda(z.nombre, busqueda));
  /**
   * Una zona INACTIVA existe en la lista pero el agente no la puede cotizar
   * (`zonasDeEntregaQuery` filtra por `active`). Buscarla y verla ahí, sin más,
   * haría creer que está resuelta — así que se dice.
   */
  const encontradaPeroInactiva = buscando && encontradas.length > 0 && !encontradas.some((z) => z.activa);
  const sinPrecio = zonas.filter((z) => z.feeCents === 0).length;

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5 md:px-6 md:py-4">
        <div>
          <h2 className="font-semibold">Domicilios</h2>
          <p className="text-sm text-muted-foreground">
            A qué zonas entregas y cuánto cobras por cada una. Una zona{" "}
            <strong>activa</strong> es la que el agente puede cotizarle a un cliente; si
            un barrio no está en esta lista, el agente no inventa un precio.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreando(true)} disabled={creando}>
          + Zona
        </Button>
      </header>

      <div className="space-y-4 p-4 md:space-y-6 md:p-6">
        {error && (
          <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] p-3 text-sm text-[#a2504c]">
            {error}
          </p>
        )}

        {zonas.length > 0 && activas === 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm font-medium">
              ⚠️ Tienes {zonas.length} {zonas.length === 1 ? "zona cargada" : "zonas cargadas"},
              pero ninguna está activa.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Revisa que cada tarifa esté correcta y actívalas cuando estés conforme. Mientras
              tanto, el agente sigue cotizando el domicilio como lo venía haciendo.
            </p>
          </div>
        )}

        {creando && (
          <FormularioZona
            inicial={{ nombre: busqueda.trim(), precio: "" }}
            onGuardar={crearZona}
            onCancelar={() => setCreando(false)}
          />
        )}

        {zonas.length === 0 && !creando && (
          <p className="text-sm text-muted-foreground">
            Todavía no tienes zonas cargadas. Agrega la primera con el botón de arriba.
          </p>
        )}

        {/*
          La búsqueda no está aquí para filtrar una lista larga: está para
          contestar "¿tengo este barrio o no?" con un cliente esperando al otro
          lado. Por eso lo que más importa es el caso en que NO está —el que
          costó el pedido de Carol el 8-sep-2026, con "villa nueva" fuera de la
          tabla— y por eso ahí mismo se puede agregar, con el nombre ya escrito.
        */}
        {zonas.length > 0 && (
          <div className="space-y-2">
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar un barrio… (ej: Villa Nueva)"
              aria-label="Buscar un barrio entre tus zonas"
            />
            {!buscando && (
              <p className="text-[13px] text-muted-foreground">
                {zonas.length} {zonas.length === 1 ? "zona cargada" : "zonas cargadas"}, {activas}{" "}
                {activas === 1 ? "activa" : "activas"}
                {sinPrecio > 0 && (
                  <>
                    {" · "}
                    <strong>{sinPrecio} sin precio</strong>
                  </>
                )}
                .
              </p>
            )}
            {buscando && encontradas.length > 0 && !encontradaPeroInactiva && (
              <p className="text-[13px] text-muted-foreground">
                {encontradas.length}{" "}
                {encontradas.length === 1 ? "zona coincide" : "zonas coinciden"} con «
                {busqueda.trim()}».
              </p>
            )}
          </div>
        )}

        {encontradaPeroInactiva && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm font-medium">
              ⚠️ «{busqueda.trim()}» está en tu lista, pero inactiva.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              El agente no puede cotizarla: para él es como si no existiera. Actívala
              abajo cuando el valor esté confirmado.
            </p>
          </div>
        )}

        {buscando && encontradas.length === 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm font-medium">
              «{busqueda.trim()}» no está en tu lista de zonas.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Si un cliente de ese barrio pide un domicilio, el agente no va a inventar
              un precio: le dirá que lo confirma con el equipo. Agrégalo para que pueda
              cotizarlo solo.
            </p>
            {!creando && (
              <Button size="sm" className="mt-3" onClick={() => setCreando(true)}>
                Agregar «{busqueda.trim()}»
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2">
          {encontradas.map((z) => (
            <FilaZona key={z.id} zona={z} onCambio={refetch} onError={setError} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FormularioZona({
  inicial,
  onGuardar,
  onCancelar,
}: {
  inicial?: { nombre: string; precio: string };
  onGuardar: (datos: { nombre: string; precio: string }) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [precio, setPrecio] = useState(inicial?.precio ?? "");
  const [guardando, setGuardando] = useState(false);

  return (
    <div className="rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label htmlFor="zona-nombre">Zona o barrio</Label>
          <Input
            id="zona-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Ciudad Jardín"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="zona-precio">Valor del domicilio</Label>
          <Input
            id="zona-precio"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="8.000"
            inputMode="numeric"
          />
        </div>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        La zona se crea <strong>inactiva</strong>: revisa el valor y actívala cuando esté
        confirmado. Escribe el barrio como lo dicen tus clientes.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={!nombre.trim() || guardando}
          onClick={() => {
            setGuardando(true);
            onGuardar({ nombre, precio });
            setGuardando(false);
          }}
        >
          Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function FilaZona({
  zona,
  onCambio,
  onError,
}: {
  zona: Zona;
  onCambio: () => Promise<void>;
  onError: (mensaje: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(zona.nombre);
  const [precio, setPrecio] = useState(centsAPesos(zona.feeCents));
  /** $0 = "todavía sin definir", no "gratis". Ver el comentario de abajo. */
  const sinPrecio = zona.feeCents === 0;

  async function guardar(datos: { nombre?: string; feeCents?: number; activa?: boolean }) {
    onError(null);
    const res = await fetch(`/api/domicilios/${zona.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(datos),
    }).catch(() => null);
    if (!res?.ok) {
      onError("No se pudo guardar el cambio. Vuelve a intentarlo.");
      return;
    }
    setEditando(false);
    await onCambio();
  }

  async function archivar() {
    onError(null);
    const res = await fetch(`/api/domicilios/${zona.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      onError("No se pudo quitar la zona. Vuelve a intentarlo.");
      return;
    }
    await onCambio();
  }

  if (editando) {
    return (
      <div className="rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <Label htmlFor={`n-${zona.id}`}>Zona o barrio</Label>
            <Input id={`n-${zona.id}`} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${zona.id}`}>Valor del domicilio</Label>
            <Input
              id={`p-${zona.id}`}
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              const feeCents = pesosACents(precio);
              if (feeCents === null) {
                onError("Escribe el valor del domicilio para esa zona.");
                return;
              }
              void guardar({ nombre: nombre.trim(), feeCents });
            }}
          >
            Guardar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNombre(zona.nombre);
              setPrecio(centsAPesos(zona.feeCents));
              setEditando(false);
            }}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <span className="font-medium">{zona.nombre}</span>
      {/*
        $0 no significa "domicilio gratis": significa "todavía sin definir".
        Es como quedan las zonas cargadas en bloque (`scripts/cargar-zonas.ts`),
        y `delivery_zone.fee_cents` no admite nulo, así que no hay otra forma de
        decirlo en la base. Mostrar "$0" invitaría a activarla tal cual.
      */}
      {sinPrecio ? (
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Sin precio
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">${centsAPesos(zona.feeCents)}</span>
      )}
      <Badge variant={zona.activa ? "default" : "secondary"}>
        {zona.activa ? "Activa" : "Inactiva"}
      </Badge>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
          Editar
        </Button>
        {/*
          Activar una zona en $0 sería cobrar cero por ese domicilio, en todos
          los pedidos, hasta que alguien se diera cuenta. Con 306 zonas cargadas
          de golpe eso pasa a ser cuestión de tiempo, no de mala suerte: por eso
          no se puede activar sin poner tarifa antes.
        */}
        <Button
          size="sm"
          variant="ghost"
          disabled={sinPrecio && !zona.activa}
          title={
            sinPrecio && !zona.activa
              ? "Ponle un valor antes de activarla: si se activa en $0, el domicilio sale gratis."
              : undefined
          }
          onClick={() => void guardar({ activa: !zona.activa })}
        >
          {zona.activa ? "Desactivar" : "Activar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void archivar()}>
          Quitar
        </Button>
      </div>
    </div>
  );
}
