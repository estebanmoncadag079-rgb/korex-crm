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
import { ExpandableInput } from "@/components/ui/expandable-input";
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

/** Lo que devuelve `/api/services/sincronizar` al comparar. */
type Diff = {
  nuevos: FilaCatalogo[];
  sobrantes: { id: string; name: string; priceCents: number; durationMin: number }[];
  cambios: {
    id: string;
    nombre: string;
    precioAntes: number;
    precioAhora: number;
    duracionAntes: number;
    duracionAhora: number;
  }[];
  sinCambios: number;
  staff: { id: string; name: string }[];
};

const pesos = (centavos: number) => `$${(centavos / 100).toLocaleString("es-CO")}`;

export function ImportarCatalogo({ onImportado }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [pegado, setPegado] = useState("");
  const [filas, setFilas] = useState<Borrador[] | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duracionParaTodas, setDuracionParaTodas] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  /** Qué especialistas atenderán cada servicio nuevo, por nombre. */
  const [asignaciones, setAsignaciones] = useState<Record<string, string[]>>({});
  const [archivarIds, setArchivarIds] = useState<string[]>([]);
  const [aplicarCambios, setAplicarCambios] = useState(false);

  function reiniciar() {
    setFilas(null);
    setPegado("");
    setError(null);
    setDuracionParaTodas("");
    setDiff(null);
    setAsignaciones({});
    setArchivarIds([]);
    setAplicarCambios(false);
  }

  function alternarEspecialista(nombreServicio: string, staffId: string) {
    setAsignaciones((prev) => {
      const actuales = prev[nombreServicio] ?? [];
      return {
        ...prev,
        [nombreServicio]: actuales.includes(staffId)
          ? actuales.filter((s) => s !== staffId)
          : [...actuales, staffId],
      };
    });
  }

  /**
   * Un PDF se lee en el navegador: primero su texto (gratis y exacto) y, si es
   * un escaneo sin texto, se rasteriza la primera página y se manda al lector
   * de imágenes. El archivo nunca sale del computador del cliente.
   */
  async function leerPdf(archivo: File) {
    setError(null);
    setLeyendo(true);
    try {
      const { textoDePdf, primeraPaginaComoPng } = await import("@/lib/pdf-cliente");
      const leido = await textoDePdf(archivo);

      if (leido.ok) {
        /*
         * El texto del PDF NO se lee línea a línea: un catálogo de verdad viene
         * maquetado, con el nombre, la descripción y el precio en renglones
         * distintos. Probado con el del salón: leerlo como lista daba 108
         * "servicios" sacados de las descripciones. Lo interpreta el modelo, a
         * partir del texto exacto del PDF — sin OCR y sin subir los 36 MB.
         */
        await enviarTextoAlLector(leido.texto);
        return;
      }

      const png = await primeraPaginaComoPng(archivo);
      if (!png) {
        setError("No pudimos leer ese PDF. Prueba a pegar la lista o a subir una foto.");
        return;
      }
      await enviarAlLector(png.base64, "image/png");
    } catch {
      setError("No pudimos leer ese PDF. Prueba a pegar la lista.");
    } finally {
      setLeyendo(false);
    }
  }

  /** Manda una imagen ya en base64 al lector de cartas y llena la tabla. */
  async function enviarAlLector(base64: string, mimeType: string) {
    return pedirLectura({ base64, mimeType });
  }

  /** Lo mismo, pero con el texto sacado de un PDF. */
  async function enviarTextoAlLector(texto: string) {
    return pedirLectura({ texto });
  }

  async function pedirLectura(carga: Record<string, string>) {
    const res = await fetch("/api/onboarding/catalogo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(carga),
    });
    const d = await res.json();
    if (!res.ok) {
      setError(d?.message ?? "No pudimos leer la carta.");
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
      setError("No encontramos servicios ahí. Prueba a pegar la lista.");
      return;
    }
    setFilas(leidas.map(aBorrador));
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
      await enviarAlLector(base64, archivo.type);
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

  /**
   * De la lista revisada al **diff** contra lo que ya está cargado.
   *
   * No se guarda a ciegas: si el negocio ya tiene catálogo, pegar la lista otra
   * vez crearía 46 duplicados. Lo que hace falta saber es qué es nuevo, qué
   * cambió de precio y qué ya no está — y decidir cada cosa.
   */
  async function comparar() {
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
    /*
     * Se mandan las filas ya revisadas, no el texto: reconstruir la lista como
     * texto obligaría a inventar una sintaxis para la categoría, y el nombre
     * "Volumen Ruso [Pestañas]" no casaría con el "Volumen Ruso" guardado —
     * saldría como servicio nuevo y se duplicaría el catálogo entero.
     */
    const res = await fetch("/api/services/sincronizar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accion: "comparar",
        filas: filas.map((f) => ({
          nombre: f.nombre.trim(),
          categoria: f.categoria.trim() || null,
          precio: f.precio.trim() ? Number(f.precio) : null,
          duracionMin: f.duracion.trim() ? Number(f.duracion) : null,
        })),
      }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      setError("No pudimos comparar con tu catálogo actual.");
      return;
    }
    const d: Diff = await res.json();
    setDiff(d);
    // Por defecto: crear lo nuevo sí, tocar lo que ya existe no. Añadir es
    // inofensivo; cambiar un precio o retirar un servicio, no.
    setArchivarIds([]);
    setAplicarCambios(false);
    setAsignaciones(
      Object.fromEntries((d.nuevos ?? []).map((n) => [n.nombre, [] as string[]]))
    );
  }

  /** Aplica exactamente lo que quedó marcado en la pantalla del diff. */
  async function aplicarDiff() {
    if (!diff || !filas) return;
    setGuardando(true);
    setError(null);
    const porNombre = new Map(filas.map((f) => [f.nombre.trim(), f]));
    const crear = diff.nuevos.map((n) => {
      const editada = porNombre.get(n.nombre);
      return {
        name: n.nombre,
        category: n.categoria ?? editada?.categoria?.trim() ?? null,
        priceCents: Math.round(Number(editada?.precio ?? n.precio ?? 0) * 100),
        durationMin: Number(editada?.duracion ?? n.duracionMin ?? 0),
        staffIds: asignaciones[n.nombre] ?? [],
      };
    });

    const res = await fetch("/api/services/sincronizar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accion: "aplicar",
        crear,
        archivar: archivarIds,
        actualizar: aplicarCambios
          ? diff.cambios.map((c) => ({
              id: c.id,
              priceCents: c.precioAhora,
              durationMin: c.duracionAhora,
            }))
          : [],
      }),
    }).catch(() => null);
    setGuardando(false);

    if (!res?.ok) {
      setError("No se pudieron guardar los cambios.");
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
                {leyendo ? "Leyendo…" : "Subir PDF o foto de la carta"}
                <input
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  className="hidden"
                  disabled={leyendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const esPdf =
                        f.type === "application/pdf" ||
                        f.name.toLowerCase().endsWith(".pdf");
                      void (esPdf ? leerPdf(f) : leerFoto(f));
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
            </div>
          </>
        ) : diff ? (
          <>
            {/* Lo que cambia respecto a lo que ya está cargado. Nada de esto se
                aplica hasta que se marque: añadir es inofensivo, pero cambiar un
                precio o retirar un servicio afecta a lo que se le cobra a una
                clienta y a citas ya agendadas. */}
            <div className="rounded-md border bg-panel p-3 text-[13px]">
              <p className="font-medium">
                Comparado con tu catálogo: {diff.nuevos.length} nuevos ·{" "}
                {diff.cambios.length} con precio o duración distinta ·{" "}
                {diff.sobrantes.length} que ya no están en tu lista ·{" "}
                {diff.sinCambios} iguales
              </p>
            </div>

            {diff.nuevos.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium">
                  Se van a crear ({diff.nuevos.length}) — marca quién los atiende
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Un servicio que no atiende nadie aparece en el catálogo pero{" "}
                  <strong>no se puede agendar</strong>. Puedes marcarlo ahora o
                  después, en la ficha de cada especialista.
                </p>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded border p-2">
                  {diff.nuevos.map((n) => (
                    <div key={n.nombre} className="border-b pb-2 last:border-0">
                      <p className="text-[13px] font-medium">
                        {n.nombre}
                        {n.categoria ? (
                          <span className="text-muted-foreground"> · {n.categoria}</span>
                        ) : null}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {diff.staff.length === 0 ? (
                          <span className="text-[13px] text-muted-foreground">
                            No hay especialistas dadas de alta todavía.
                          </span>
                        ) : (
                          diff.staff.map((st) => {
                            const marcada = (asignaciones[n.nombre] ?? []).includes(st.id);
                            return (
                              <label
                                key={st.id}
                                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] ${marcada ? "border-accent-soft bg-accent" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={marcada}
                                  onChange={() => alternarEspecialista(n.nombre, st.id)}
                                />
                                {st.name}
                              </label>
                            );
                          })
                        )}
                      </div>
                      {(asignaciones[n.nombre] ?? []).length === 0 ? (
                        <p className="mt-1 text-[13px] text-amber-700 dark:text-amber-400">
                          ⚠️ Sin nadie asignado: no se podrá agendar.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {diff.cambios.length > 0 ? (
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={aplicarCambios}
                    onChange={(e) => setAplicarCambios(e.target.checked)}
                  />
                  <span>
                    Actualizar precio y duración de {diff.cambios.length} servicios
                    que ya tenías
                  </span>
                </label>
                <div className="max-h-40 overflow-y-auto rounded border p-2 text-[13px]">
                  {diff.cambios.map((c) => (
                    <div key={c.id} className="border-b py-1 last:border-0">
                      {c.nombre}:{" "}
                      <span className="text-muted-foreground">
                        {pesos(c.precioAntes)} · {c.duracionAntes} min
                      </span>{" "}
                      → {pesos(c.precioAhora)} · {c.duracionAhora} min
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {diff.sobrantes.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium">
                  Ya no están en tu lista ({diff.sobrantes.length})
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Marca los que quieras <strong>retirar del catálogo</strong>. No
                  se borran: dejan de ofrecerse, y las citas ya agendadas siguen
                  igual.
                </p>
                <div className="max-h-40 overflow-y-auto rounded border p-2">
                  {diff.sobrantes.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 border-b py-1 text-[13px] last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={archivarIds.includes(s.id)}
                        onChange={() =>
                          setArchivarIds((prev) =>
                            prev.includes(s.id)
                              ? prev.filter((x) => x !== s.id)
                              : [...prev, s.id]
                          )
                        }
                      />
                      {s.name}
                      <span className="text-muted-foreground">
                        {pesos(s.priceCents)} · {s.durationMin} min
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void aplicarDiff()} disabled={guardando}>
                {guardando
                  ? "Guardando…"
                  : `Aplicar (${diff.nuevos.length} nuevos${archivarIds.length ? `, ${archivarIds.length} retirados` : ""}${aplicarCambios && diff.cambios.length ? `, ${diff.cambios.length} actualizados` : ""})`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDiff(null)}>
                Volver a la lista
              </Button>
            </div>
            {error ? <p className="text-[13px] text-danger">{error}</p> : null}
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
                        <ExpandableInput
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
              <Button size="sm" onClick={() => void comparar()} disabled={guardando}>
                {guardando ? "Comparando…" : "Comparar con mi catálogo"}
              </Button>
              <Button size="sm" variant="ghost" onClick={reiniciar}>
                Empezar de nuevo
              </Button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              El siguiente paso te dice qué es nuevo, qué cambió de precio y qué
              ya no está — y decides tú. Nada se guarda antes.
            </p>
          </>
        )}

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
