"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { repeticionObligatoria } from "@/lib/catalogo-repeticion";

/**
 * El catálogo completo de un negocio de PEDIDOS — productos, sus grupos de
 * opciones y las opciones dentro de cada grupo — en un solo lugar.
 *
 * Antes de esto, dar de alta un producto era escribirlo como texto libre en
 * el cuestionario de alta y correr una migración aparte; esa entrada seguía
 * ahí después, editable, sin ningún efecto real una vez migrado el negocio.
 * Esta pantalla es la única fuente: lo que se crea o cambia aquí es lo que el
 * agente usa en el turno siguiente, sin ningún paso intermedio.
 *
 * Los textos son deliberadamente genéricos ("producto", "opciones"): esta
 * pantalla la ve cualquier negocio de pedidos, no solo una pastelería.
 */

type Producto = {
  id: string;
  nombre: string;
  categoria: string | null;
  precioCents: number | null;
  disponible: boolean;
};

type Grupo = {
  id: string;
  nombre: string;
  productoId: string;
  producto: string;
  minimo: number;
  maximo: number;
  opciones: number;
  permiteRepeticion: boolean;
};

type Opcion = {
  id: string;
  groupId: string;
  nombre: string;
  precioDeltaCents: number;
  disponible: boolean;
};

function centsAPesos(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 });
}

function pesosACents(texto: string): number | null {
  const limpio = texto.replace(/[^\d]/g, "");
  if (!limpio) return null;
  return Math.round(Number(limpio) * 100);
}

export function CatalogoProductos() {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creandoProducto, setCreandoProducto] = useState(false);

  const refetch = useCallback(async () => {
    const [rp, rg] = await Promise.all([
      fetch("/api/catalogo/productos").catch(() => null),
      fetch("/api/catalogo/grupos").catch(() => null),
    ]);
    if (!rp?.ok || !rg?.ok) {
      setProductos([]);
      setError("No pudimos cargar tu catálogo.");
      return;
    }
    const dp = (await rp.json()) as { productos: Producto[] };
    const dg = (await rg.json()) as { grupos: Grupo[] };
    setProductos(dp.productos);
    setGrupos(dg.grupos);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function crearProducto(datos: { nombre: string; categoria: string; precio: string }) {
    setError(null);
    const res = await fetch("/api/catalogo/productos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: datos.nombre,
        categoria: datos.categoria.trim() || null,
        precioCents: pesosACents(datos.precio),
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo crear el producto. Vuelve a intentarlo.");
      return;
    }
    setCreandoProducto(false);
    await refetch();
  }

  if (productos === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  const gruposPorProducto = new Map<string, Grupo[]>();
  for (const g of grupos) {
    gruposPorProducto.set(g.productoId, [...(gruposPorProducto.get(g.productoId) ?? []), g]);
  }

  const bloqueados = grupos.filter((g) => repeticionObligatoria(g) && !g.permiteRepeticion);

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5 md:px-6 md:py-4">
        <div>
          <h2 className="font-semibold">Catálogo</h2>
          <p className="text-sm text-muted-foreground">
            Tus productos, sus precios y las opciones que el cliente puede elegir de cada uno.
            Esto es lo único que el agente lee — no hay ningún otro lugar donde
            configurar tu menú.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreandoProducto(true)} disabled={creandoProducto}>
          + Producto
        </Button>
      </header>

      <div className="space-y-4 p-4 md:space-y-6 md:p-6">
        {error && (
          <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] p-3 text-sm text-[#a2504c]">
            {error}
          </p>
        )}

        {bloqueados.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm font-medium">
              ⚠️ {bloqueados.length}{" "}
              {bloqueados.length === 1
                ? "grupo pide más opciones de las que tiene"
                : "grupos piden más opciones de las que tienen"}
              .
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Sin permitir repetir, esos pedidos no se pueden completar. Activa
              &ldquo;permite repetir&rdquo; o carga más opciones en el grupo.
            </p>
          </div>
        )}

        {creandoProducto && (
          <FormularioProducto
            onGuardar={crearProducto}
            onCancelar={() => setCreandoProducto(false)}
          />
        )}

        {productos.length === 0 && !creandoProducto && (
          <p className="text-sm text-muted-foreground">
            Todavía no tienes productos. Agrega el primero con el botón de arriba.
          </p>
        )}

        {productos.map((p) => (
          <TarjetaProducto
            key={p.id}
            producto={p}
            grupos={gruposPorProducto.get(p.id) ?? []}
            onCambio={refetch}
          />
        ))}
      </div>
    </div>
  );
}

function FormularioProducto({
  inicial,
  onGuardar,
  onCancelar,
}: {
  inicial?: { nombre: string; categoria: string; precio: string };
  onGuardar: (datos: { nombre: string; categoria: string; precio: string }) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [categoria, setCategoria] = useState(inicial?.categoria ?? "");
  const [precio, setPrecio] = useState(inicial?.precio ?? "");
  const [guardando, setGuardando] = useState(false);

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="nombre-producto">Nombre</Label>
            <Input
              id="nombre-producto"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cremoso 12 oz"
            />
          </div>
          <div>
            <Label htmlFor="categoria-producto">Categoría (opcional)</Label>
            <Input
              id="categoria-producto"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Cremosos"
            />
          </div>
          <div>
            <Label htmlFor="precio-producto">Precio (opcional)</Label>
            <Input
              id="precio-producto"
              inputMode="numeric"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="18000"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!nombre.trim() || guardando}
            onClick={() => {
              setGuardando(true);
              onGuardar({ nombre: nombre.trim(), categoria, precio });
            }}
          >
            Guardar
          </Button>
          <Button size="sm" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TarjetaProducto({
  producto,
  grupos,
  onCambio,
}: {
  producto: Producto;
  grupos: Grupo[];
  onCambio: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [creandoGrupo, setCreandoGrupo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(datos: { nombre: string; categoria: string; precio: string }) {
    setError(null);
    const res = await fetch(`/api/catalogo/productos/${producto.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: datos.nombre,
        categoria: datos.categoria.trim() || null,
        precioCents: pesosACents(datos.precio),
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo guardar.");
      return;
    }
    setEditando(false);
    await onCambio();
  }

  async function archivar() {
    if (!confirm(`¿Quitar "${producto.nombre}" del catálogo? Ya no se ofrecerá a los clientes.`)) return;
    const res = await fetch(`/api/catalogo/productos/${producto.id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      setError("No se pudo quitar.");
      return;
    }
    await onCambio();
  }

  async function crearGrupo(datos: { nombre: string; minimo: string; maximo: string }) {
    setError(null);
    const res = await fetch(`/api/catalogo/productos/${producto.id}/grupos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: datos.nombre,
        minimo: Number(datos.minimo) || 0,
        maximo: Number(datos.maximo) || 1,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo crear el grupo.");
      return;
    }
    setCreandoGrupo(false);
    await onCambio();
  }

  if (editando) {
    return (
      <FormularioProducto
        inicial={{
          nombre: producto.nombre,
          categoria: producto.categoria ?? "",
          precio: centsAPesos(producto.precioCents),
        }}
        onGuardar={guardar}
        onCancelar={() => setEditando(false)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{producto.nombre}</CardTitle>
          <p className="text-[13px] text-muted-foreground">
            {producto.categoria ? `${producto.categoria} · ` : ""}
            {producto.precioCents !== null
              ? `$${centsAPesos(producto.precioCents)}`
              : "sin precio — el agente lo preguntará"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            Editar
          </Button>
          <Button size="sm" variant="outline" onClick={archivar}>
            Quitar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-[#a2504c]">{error}</p>}

        {grupos.map((g) => (
          <FilaDeGrupo key={g.id} grupo={g} onCambio={onCambio} />
        ))}

        {creandoGrupo ? (
          <FormularioGrupo onGuardar={crearGrupo} onCancelar={() => setCreandoGrupo(false)} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreandoGrupo(true)}>
            + Grupo de opciones (sabores, tamaños…)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function FormularioGrupo({
  onGuardar,
  onCancelar,
}: {
  onGuardar: (datos: { nombre: string; minimo: string; maximo: string }) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [minimo, setMinimo] = useState("1");
  const [maximo, setMaximo] = useState("1");

  return (
    <div className="rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="nombre-grupo">Nombre del grupo</Label>
          <Input
            id="nombre-grupo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Toppings"
          />
        </div>
        <div>
          <Label htmlFor="min-grupo">Mínimo a elegir</Label>
          <Input
            id="min-grupo"
            inputMode="numeric"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="max-grupo">Máximo a elegir</Label>
          <Input
            id="max-grupo"
            inputMode="numeric"
            value={maximo}
            onChange={(e) => setMaximo(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={!nombre.trim()} onClick={() => onGuardar({ nombre: nombre.trim(), minimo, maximo })}>
          Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function FilaDeGrupo({ grupo, onCambio }: { grupo: Grupo; onCambio: () => Promise<void> }) {
  const [expandido, setExpandido] = useState(false);
  const [editando, setEditando] = useState(false);
  const [creandoOpcion, setCreandoOpcion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const obligatoria = repeticionObligatoria(grupo);
  const bloqueado = obligatoria && !grupo.permiteRepeticion;

  async function alternarRepeticion() {
    setError(null);
    const res = await fetch(`/api/catalogo/grupos/${grupo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permiteRepeticion: !grupo.permiteRepeticion }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo guardar.");
      return;
    }
    await onCambio();
  }

  async function guardarGrupo(datos: { nombre: string; minimo: string; maximo: string }) {
    setError(null);
    const res = await fetch(`/api/catalogo/grupos/${grupo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: datos.nombre,
        minimo: Number(datos.minimo) || 0,
        maximo: Number(datos.maximo) || 1,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo guardar.");
      return;
    }
    setEditando(false);
    await onCambio();
  }

  async function eliminarGrupo() {
    if (!confirm(`¿Eliminar el grupo "${grupo.nombre}" y sus opciones?`)) return;
    const res = await fetch(`/api/catalogo/grupos/${grupo.id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      setError("No se pudo eliminar.");
      return;
    }
    await onCambio();
  }

  if (editando) {
    return (
      <FormularioGrupo
        onGuardar={guardarGrupo}
        onCancelar={() => setEditando(false)}
      />
    );
  }

  return (
    <div
      className={`rounded-md border p-3 ${
        bloqueado ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : ""
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{grupo.nombre}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            mínimo {grupo.minimo} · máximo {grupo.maximo} · {grupo.opciones}{" "}
            {grupo.opciones === 1 ? "opción disponible" : "opciones disponibles"}
          </p>
          {obligatoria && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
              <Badge variant={bloqueado ? "warning" : "secondary"}>
                {bloqueado ? "Sin repetir no se puede completar" : "Repetir es imprescindible aquí"}
              </Badge>
            </p>
          )}
          {error && <p className="mt-1 text-[13px] text-[#a2504c]">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {grupo.permiteRepeticion ? "Permite repetir" : "No permite repetir"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={grupo.permiteRepeticion}
            aria-label={`${grupo.permiteRepeticion ? "No permitir" : "Permitir"} repetir la misma opción en ${grupo.nombre}`}
            onClick={() => void alternarRepeticion()}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              grupo.permiteRepeticion ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                grupo.permiteRepeticion ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            Editar
          </Button>
          <Button size="sm" variant="outline" onClick={() => void eliminarGrupo()}>
            Eliminar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExpandido((v) => !v)}>
            {expandido ? "Ocultar opciones" : "Ver opciones"}
          </Button>
        </div>
      </div>

      {expandido && (
        <OpcionesDelGrupo
          groupId={grupo.id}
          onCambioGrupo={onCambio}
          creando={creandoOpcion}
          onIniciarCrear={() => setCreandoOpcion(true)}
          onTerminarCrear={() => setCreandoOpcion(false)}
        />
      )}
    </div>
  );
}

function OpcionesDelGrupo({
  groupId,
  onCambioGrupo,
  creando,
  onIniciarCrear,
  onTerminarCrear,
}: {
  groupId: string;
  onCambioGrupo: () => Promise<void>;
  creando: boolean;
  onIniciarCrear: () => void;
  onTerminarCrear: () => void;
}) {
  const [opciones, setOpciones] = useState<Opcion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/catalogo/grupos/${groupId}/opciones`).catch(() => null);
    if (!res?.ok) {
      setOpciones([]);
      return;
    }
    const data = (await res.json()) as { opciones: Opcion[] };
    setOpciones(data.opciones);
  }, [groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function crear(nombre: string) {
    setError(null);
    const res = await fetch(`/api/catalogo/grupos/${groupId}/opciones`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo agregar.");
      return;
    }
    onTerminarCrear();
    await Promise.all([refetch(), onCambioGrupo()]);
  }

  async function quitar(id: string) {
    const res = await fetch(`/api/catalogo/opciones/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo quitar.");
      return;
    }
    await Promise.all([refetch(), onCambioGrupo()]);
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      {error && <p className="text-[13px] text-[#a2504c]">{error}</p>}
      {opciones === null ? (
        <p className="text-[13px] text-muted-foreground">Cargando…</p>
      ) : opciones.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Sin opciones todavía.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {opciones.map((o) => (
            <span
              key={o.id}
              className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-[13px]"
            >
              {o.nombre}
              <button
                type="button"
                aria-label={`Quitar ${o.nombre}`}
                onClick={() => void quitar(o.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {creando ? (
        <NuevaOpcionInline onGuardar={crear} onCancelar={onTerminarCrear} />
      ) : (
        <Button size="sm" variant="outline" onClick={onIniciarCrear}>
          + Opción
        </Button>
      )}
    </div>
  );
}

function NuevaOpcionInline({
  onGuardar,
  onCancelar,
}: {
  onGuardar: (nombre: string) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  return (
    <div className="flex items-center gap-2">
      <Input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Milo"
        className="h-8 max-w-[180px]"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && nombre.trim()) onGuardar(nombre.trim());
          if (e.key === "Escape") onCancelar();
        }}
      />
      <Button size="sm" disabled={!nombre.trim()} onClick={() => onGuardar(nombre.trim())}>
        Agregar
      </Button>
      <Button size="sm" variant="outline" onClick={onCancelar}>
        Cancelar
      </Button>
    </div>
  );
}
