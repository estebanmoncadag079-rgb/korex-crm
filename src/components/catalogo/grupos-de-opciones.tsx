"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { repeticionObligatoria } from "@/lib/catalogo-repeticion";

/**
 * Los grupos de opciones del catálogo, y la única regla que hoy se cambia desde
 * aquí: **si se puede repetir la misma opción**.
 *
 * Los textos son deliberadamente genéricos —"grupo de opciones", "permite
 * repetir", "opciones disponibles"—: esta pantalla la ve una churrería, un
 * salón y un taller, y ninguno debería leer aquí el vocabulario de otro.
 */

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

export function GruposDeOpciones() {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/catalogo/grupos").catch(() => null);
    if (!res?.ok) {
      setGrupos([]);
      setError("No pudimos cargar los grupos de opciones.");
      return;
    }
    const data = (await res.json()) as { grupos: Grupo[] };
    setGrupos(data.grupos);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function alternarRepeticion(grupo: Grupo) {
    setError(null);
    setGuardando(grupo.id);
    const res = await fetch(`/api/catalogo/grupos/${grupo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permiteRepeticion: !grupo.permiteRepeticion }),
    }).catch(() => null);
    setGuardando(null);

    if (!res?.ok) {
      setError("No se pudo guardar el cambio. Vuelve a intentarlo.");
      return;
    }
    /*
     * Se pinta lo que devolvió el servidor, no lo que se pidió: si el backend
     * corrige o rechaza parte del cambio, la pantalla enseña lo que quedó
     * guardado y no lo que alguien quiso guardar.
     */
    const { grupo: guardado } = (await res.json()) as { grupo: Grupo };
    setGrupos((prev) =>
      (prev ?? []).map((g) => (g.id === guardado.id ? guardado : g))
    );
  }

  if (grupos === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  const bloqueados = grupos.filter(
    (g) => repeticionObligatoria(g) && !g.permiteRepeticion
  );

  // Los grupos, agrupados bajo su producto y en el orden que manda el servidor.
  const porProducto = new Map<string, Grupo[]>();
  for (const g of grupos) {
    porProducto.set(g.productoId, [...(porProducto.get(g.productoId) ?? []), g]);
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="font-semibold">Grupos de opciones</h2>
        <p className="text-sm text-muted-foreground">
          Cómo se elige dentro de cada grupo de tu catálogo. Aquí decides si el
          cliente puede pedir <strong>la misma opción más de una vez</strong>.
        </p>
      </header>

      <div className="space-y-4 p-4 md:space-y-6 md:p-6">
        {error && (
          <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] p-3 text-sm text-[#a2504c]">
            {error}
          </p>
        )}

        {/*
          El aviso que evita el pedido imposible: un grupo que pide más
          opciones de las que hay y no admite repetir NO se puede completar
          nunca, y hoy eso solo se descubre cuando un cliente lo intenta.
        */}
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

        {grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no hay grupos de opciones en tu catálogo. Aparecerán aquí en
            cuanto lo que ofreces tenga opciones para elegir.
          </p>
        )}

        {[...porProducto.values()].map((delProducto) => (
          <Card key={delProducto[0]!.productoId}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {delProducto[0]!.producto}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {delProducto.map((g) => (
                <FilaDeGrupo
                  key={g.id}
                  grupo={g}
                  guardando={guardando === g.id}
                  onAlternar={() => void alternarRepeticion(g)}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FilaDeGrupo({
  grupo,
  guardando,
  onAlternar,
}: {
  grupo: Grupo;
  guardando: boolean;
  onAlternar: () => void;
}) {
  const obligatoria = repeticionObligatoria(grupo);
  const bloqueado = obligatoria && !grupo.permiteRepeticion;

  return (
    <div
      className={`flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${
        bloqueado
          ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
          : ""
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{grupo.nombre}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          mínimo {grupo.minimo} · máximo {grupo.maximo} · {grupo.opciones}{" "}
          {grupo.opciones === 1 ? "opción disponible" : "opciones disponibles"}
        </p>
        {obligatoria && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
            <Badge variant={bloqueado ? "warning" : "secondary"}>
              {bloqueado
                ? "Sin repetir no se puede completar"
                : "Repetir es imprescindible aquí"}
            </Badge>
            <span className="text-muted-foreground">
              pide hasta {grupo.maximo} y hay {grupo.opciones}.
            </span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {grupo.permiteRepeticion ? "Permite repetir" : "No permite repetir"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={grupo.permiteRepeticion}
          aria-label={`${
            grupo.permiteRepeticion ? "No permitir" : "Permitir"
          } repetir la misma opción en ${grupo.nombre} de ${grupo.producto}`}
          disabled={guardando}
          onClick={onAlternar}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            grupo.permiteRepeticion ? "bg-primary" : "bg-secondary"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              grupo.permiteRepeticion ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
