"use client";

import { useState } from "react";
import { Camera, ClipboardList, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { leerCatalogoPegado, type FilaCatalogo } from "@/lib/catalogo-texto";

/**
 * Cargar el catálogo entero de una vez, en lugar de servicio por servicio.
 *
 * Un salón tiene 40 o 50 servicios y hasta ahora solo se podían dar de alta de
 * uno en uno, con nombre, precio, duración y categoría cada vez. Nadie termina
 * eso: se abandona el alta, o se teclea mal. Ya pasó — 12 precios equivocados
 * que nadie vio hasta que apareció el PDF oficial del salón.
 *
 * Dos caminos y **una sola tabla de revisión**: la foto de la carta (que lee el
 * modelo de visión) y la lista pegada a mano acaban en el mismo sitio, donde
 * una persona corrige antes de que se escriba una sola fila.
 */

type Props = { onImportado: () => void };

/** Lo mismo que `FilaCatalogo`, pero en texto: es lo que se está editando. */
type Borrador = {
  nombre: string;
  categoria: string;
  precio: string;
  duracion: string;
};

function aBorrador(f: FilaCatalogo): Borrador {
  return {
    nombre: f.nombre,
    categoria: f.categoria ?? "",
    precio: f.precio === null ? "" : String(f.precio),
    duracion: f.duracionMin === null ? "" : String(f.duracionMin),
  };
}

export function ImportarCatalogo({ onImportado }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [pegado, setPegado] = useState("");
  const [filas, setFilas] = useState<Borrador[] | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duracionParaTodas, setDuracionParaTodas] = useState("");

  function reiniciar() {
    setFilas(null);
    setPegado("");
    setError(null);
    setDuracionParaTodas("");
  }

  async function leerFoto(archivo: File) {
    setError(null);
    setLeyendo(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
        lector.onerror = () => reject(new Error("no se pudo leer el archivo"));
        lector.readAsDataURL(archivo);
      });
      const res = await fetch("/api/onboarding/catalogo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base64, mimeType: archivo.type }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.message ?? "No pudimos leer la foto.");
        return;
      }
      const leidas: FilaCatalogo[] = (d.productos ?? []).map(
        (p: { nombre: string; precio: number | null; duracionMin?: number | null; categoria?: string | null }) => ({
          nombre: p.nombre,
          precio: p.precio,
          duracionMin: p.duracionMin ?? null,
          categoria: p.categoria ?? null,
        })
      );
      if (!leidas.length) {
        setError("No encontramos servicios en esa foto. Prueba a pegar la lista.");
        return;
      }
      setFilas(leidas.map(aBorrador));
    } catch {
      setError("No pudimos leer la foto. Puedes pegar tu lista escrita.");
    } finally {
      setLeyendo(false);
    }
  }

  function leerPegado() {
    const leidas = leerCatalogoPegado(pegado);
    if (!leidas.length) {
      setError("No encontramos servicios en ese texto.");
      return;
    }
    setError(null);
    setFilas(leidas.map(aBorrador));
  }

  function editar(i: number, campo: keyof Borrador, valor: string) {
    setFilas((prev) =>
      prev ? prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)) : prev
    );
  }

  async function guardar() {
    if (!filas) return;
    const servicios = filas.map((f) => ({
      name: f.nombre.trim(),
      category: f.categoria.trim() || null,
      priceCents: Math.round(Number(f.precio || 0) * 100),
      durationMin: Number(f.duracion),
    }));

    const sinDuracion = servicios.filter(
      (s) => !Number.isFinite(s.durationMin) || s.durationMin < 5
    ).length;
    if (sinDuracion > 0) {
      setError(
        `Faltan ${sinDuracion} duraciones (mínimo 5 minutos). De la duración depende que no se te crucen dos citas, así que ninguna puede quedar vacía.`
      );
      return;
    }
    if (servicios.some((s) => !s.name)) {
      setError("Hay servicios sin nombre.");
      return;
    }

    setGuardando(true);
    setError(null);
    const res = await fetch("/api/services/importar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ servicios }),
    }).catch(() => null);
    setGuardando(false);

    if (!res?.ok) {
      setError("No se pudieron guardar los servicios.");
      return;
    }
    const d = await res.json();
    if (d.fallidos?.length) {
      setError(`No se pudieron crear: ${d.fallidos.join(", ")}.`);
      return;
    }
    reiniciar();
    setAbierto(false);
    onImportado();
  }

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <ClipboardList className="mr-1.5 h-4 w-4" />
        Cargar catálogo completo
      </Button>
    );
  }

  const sinPrecio = filas?.filter((f) => !f.precio.trim()).length ?? 0;
  const sinDuracion = filas?.filter((f) => !f.duracion.trim()).length ?? 0;

  return (
    <Card className="border-accent-soft">
      <CardHeader>
        <CardTitle className="text-base">Cargar el catálogo completo</CardTitle>
        <CardDescription>
          Pega tu lista o sube una foto de la carta. Nada se guarda hasta que lo
          revises aquí.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!filas ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="pegar">Pega tu lista de servicios</Label>
              <Textarea
                id="pegar"
                rows={7}
                value={pegado}
                onChange={(e) => setPegado(e.target.value)}
                placeholder={"PESTAÑAS\nVolumen ruso — $150.000 · 180 min\nLifting de pestañas $80.000 (60 minutos)\n\nCEJAS\nCejas en henna - $30.000 - 45 min"}
              />
              <p className="text-[13px] text-muted-foreground">
                Una por línea. Si agrupas con títulos (PESTAÑAS, CEJAS…), se
                guardan como categorías.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={leerPegado} disabled={!pegado.trim()}>
                Revisar la lista
              </Button>
              <span className="text-[13px] text-muted-foreground">o</span>
              {/* `label` en vez de Button: el de este repo no soporta asChild,
                  y un input de archivo necesita su etiqueta alrededor. */}
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-[13px] hover:bg-accent">
                {leyendo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                {leyendo ? "Leyendo…" : "Subir foto de la carta"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={leyendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void leerFoto(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] dark:border-amber-800 dark:bg-amber-950/30">
              <p className="font-medium">
                {filas.length} servicios. Revísalos antes de guardar — sobre todo
                los precios y las duraciones.
              </p>
              {sinPrecio > 0 ? (
                <p className="mt-1 text-amber-800 dark:text-amber-400">
                  ⚠️ {sinPrecio} sin precio: no lo adivinamos, complétalos.
                </p>
              ) : null}
              {sinDuracion > 0 ? (
                <p className="mt-1 text-amber-800 dark:text-amber-400">
                  ⚠️ {sinDuracion} sin duración. De ella depende que no se te
                  crucen dos citas: sin duración no se puede guardar.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="todas" className="text-[13px]">
                  Poner esta duración a todos (minutos)
                </Label>
                <Input
                  id="todas"
                  className="h-8 w-40"
                  inputMode="numeric"
                  value={duracionParaTodas}
                  onChange={(e) => setDuracionParaTodas(e.target.value)}
                  placeholder="60"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!duracionParaTodas.trim()}
                onClick={() =>
                  setFilas((prev) =>
                    prev
                      ? prev.map((f) => ({ ...f, duracion: duracionParaTodas }))
                      : prev
                  )
                }
              >
                Aplicar a todos
              </Button>
              <span className="text-[13px] text-muted-foreground">
                Luego ajusta los que duren distinto.
              </span>
            </div>

            <div className="max-h-80 overflow-y-auto rounded border">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b text-left">
                    <th className="px-2 py-1.5 font-medium">Servicio</th>
                    <th className="px-2 py-1.5 font-medium">Categoría</th>
                    <th className="px-2 py-1.5 font-medium">Precio</th>
                    <th className="px-2 py-1.5 font-medium">Minutos</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-2 py-1">
                        <Input
                          className="h-8"
                          value={f.nombre}
                          onChange={(e) => editar(i, "nombre", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          className="h-8 w-32"
                          value={f.categoria}
                          onChange={(e) => editar(i, "categoria", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          className="h-8 w-28"
                          inputMode="numeric"
                          value={f.precio}
                          onChange={(e) => editar(i, "precio", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          className={`h-8 w-20 ${f.duracion.trim() ? "" : "border-amber-400"}`}
                          inputMode="numeric"
                          value={f.duracion}
                          onChange={(e) => editar(i, "duracion", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setFilas((prev) =>
                              prev ? prev.filter((_, j) => j !== i) : prev
                            )
                          }
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void guardar()} disabled={guardando}>
                {guardando ? "Guardando…" : `Guardar ${filas.length} servicios`}
              </Button>
              <Button size="sm" variant="ghost" onClick={reiniciar}>
                Empezar de nuevo
              </Button>
            </div>
          </>
        )}

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
