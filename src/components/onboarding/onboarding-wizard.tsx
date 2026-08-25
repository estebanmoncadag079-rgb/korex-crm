"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  PartyPopper,
  Save,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableInput } from "@/components/ui/expandable-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * La configuración inicial, contestada por el propio dueño del negocio.
 *
 * Sustituye al cuestionario en Word que había que devolver y que alguien
 * transcribía a mano: esa transcripción era el cuello de botella del alta
 * (no escalaba, dependía de una persona y cada paso manual era un error en
 * potencia).
 *
 * Tres decisiones de diseño, y las tres vienen de que quien responde **no es
 * técnico y no tiene 40 minutos seguidos**:
 *
 *  1. **Una etapa por pantalla.** Un formulario con 30 campos a la vez se
 *     abandona; ocho pasos cortos se terminan.
 *  2. **Se guarda al avanzar.** Puede cerrar la pestaña en la etapa 4 y seguir
 *     mañana desde ahí. Sin esto, cierra y no vuelve.
 *  3. **Cada pregunta trae ejemplo.** Es lo que ya funcionaba en el Word: sin
 *     ejemplo, la respuesta llega en dos palabras y no sirve.
 */

type Ficha = {
  nombre?: string;
  queVende?: string;
  ubicacion?: string;
  vertical?: "pedidos" | "citas";
  horario?: {
    dias: number[];
    abre: string;
    cierra: string;
    abreDomingo?: string;
    cierraDomingo?: string;
  };
  catalogo?: string;
  /** Solo citas: duración por defecto de los servicios que no traigan la suya. */
  duracionTipicaMin?: number;
  variantes?: string;
  entrega?: {
    haceDomicilios: boolean;
    como?: string;
    quienPagaElDomicilio?: string;
    restricciones?: string;
    recogerEnLocal?: string;
  };
  /** Dónde más te pueden pedir: apps de domicilio, tienda web, marketplace. */
  canales?: { nombre: string; enlace?: string }[];
  pago?: { formas: string; datosDeCuenta?: string; compruebaUnaPersona: boolean };
  tono?: string;
  regalos?: string;
  saludoInicial?: string;
  /**
   * El menú guiado de WhatsApp (25-ago-2026): opciones que el cliente TOCA
   * en vez de escribir. Aquí solo son etiquetas de texto — el `id` de cada
   * una lo pone el servidor al aplicar la ficha (`idDeOpcionDeMenu`), nunca
   * el dueño del negocio.
   */
  menu?: { opciones: string[] };
  reglasPropias?: string[];
  preguntasFrecuentes?: { pregunta: string; respuesta: string }[];
  escalarSiempre?: string[];
  nuncaPrometer?: string[];
  /**
   * `requisitos`: qué debe recoger el agente antes de cerrar — solo el id de
   * cada uno marcado; el servidor completa tipo/etiqueta/obligatorio al
   * aplicar. `pagoAntesDeLaCita`: solo CITAS, si se cobra por adelantado al
   * agendar. Los dos viven en la misma sección de la ficha y este paso del
   * alta es la ÚNICA pantalla que los edita (25-ago-2026): las tarjetas que
   * existían en "Agente de IA" se quitaron para no tener dos lugares
   * editando lo mismo.
   */
  cierre?: { requisitos?: { id: string }[]; pagoAntesDeLaCita?: boolean };
};

const DIAS = [
  { n: 1, nombre: "Lun" },
  { n: 2, nombre: "Mar" },
  { n: 3, nombre: "Mié" },
  { n: 4, nombre: "Jue" },
  { n: 5, nombre: "Vie" },
  { n: 6, nombre: "Sáb" },
  { n: 7, nombre: "Dom" },
];

/**
 * Aviso cuando la respuesta se queda corta.
 *
 * Verificado contra el modelo real (13-ago-2026) con la ficha más pobre
 * posible: a `queVende: "vendo churros"` y `tono: "normal"`, el agente **sí**
 * elabora —contestó *"Vendemos deliciosos churros, cada uno cuesta $5000,
 * ¿cuántos te gustaría?"*, nunca suelta la frase tal cual— pero se queda sin
 * qué decir en cuanto le preguntan algo que no le contaron: a *"¿qué sabores
 * tienen?"* respondió *"son churros tradicionales"* y esquivó.
 *
 * O sea: **el estilo lo pone el modelo, la información no se inventa.** Por eso
 * esto avisa en vez de bloquear. Quien quiera responder en dos palabras está en
 * su derecho, pero debe saber lo que se está dejando — si no, acaba diciendo
 * "este bot no sirve" cuando lo que pasa es que nadie le contó nada.
 */
/**
 * Los canales, de una caja de texto a datos y de vuelta.
 *
 * Uno por línea, y el nombre se separa del enlace **por donde empieza el
 * `http`** — sin pedirle a nadie que aprenda un separador. "Rappi —
 * https://…", "Rappi: https://…" y "Rappi https://…" dan lo mismo, que es lo
 * que va a escribir una persona que no piensa en formatos.
 */
function textoACanales(texto: string): { nombre: string; enlace?: string }[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linea) => {
      const i = linea.search(/https?:\/\//i);
      if (i === -1) return { nombre: linea };
      const enlace = linea.slice(i).trim();
      const nombre = linea.slice(0, i).replace(/[\s—–:·|-]+$/, "").trim();
      // Sin nombre, sirve el dominio: mejor "rappi.app.link" que una línea
      // suelta sin decir de qué es.
      return { nombre: nombre || enlace.replace(/^https?:\/\//i, "").split("/")[0]!, enlace };
    });
}

function canalesATexto(canales?: { nombre: string; enlace?: string }[]): string {
  return (canales ?? [])
    .map((c) => (c.enlace ? `${c.nombre} — ${c.enlace}` : c.nombre))
    .join("\n");
}

function AvisoCorto({ valor, minimo, que }: { valor?: string; minimo: number; que: string }) {
  const v = (valor ?? "").trim();
  // Vacío no se avisa: eso ya lo cubre "faltantesDeLaFicha" al terminar.
  if (v.length === 0 || v.length >= minimo) return null;
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      💡 Con esto tu asistente ya puede atender, pero si {que} va a vender bastante
      mejor. No te preocupes por escribir bonito: cuéntalo como se lo dirías a un
      cliente.
    </p>
  );
}

/** Una pregunta con su explicación y su ejemplo, como en el cuestionario. */
function Campo({
  titulo,
  ayuda,
  ejemplo,
  children,
}: {
  titulo: string;
  ayuda?: string;
  ejemplo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[15px] font-medium">{titulo}</Label>
      {ayuda ? <p className="text-[13px] text-muted-foreground">{ayuda}</p> : null}
      {children}
      {ejemplo ? (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-500">
          Ejemplo: {ejemplo}
        </p>
      ) : null}
    </div>
  );
}

/** Lista de textos que crece sola: el dueño añade los que necesite. */
function Lista({
  valores,
  onChange,
  marcador,
}: {
  valores: string[];
  onChange: (v: string[]) => void;
  marcador: string;
}) {
  const filas = valores.length > 0 ? valores : [""];
  return (
    <div className="space-y-2">
      {filas.map((v, i) => (
        <ExpandableInput
          key={i}
          value={v}
          placeholder={marcador}
          onChange={(e) => {
            const copia = [...filas];
            copia[i] = e.target.value;
            onChange(copia);
          }}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...filas, ""])}
      >
        + Agregar otro
      </Button>
    </div>
  );
}

/**
 * Las fotos que el agente podrá enviar, subidas por el propio cliente.
 *
 * Idea del dueño, y la correcta: nadie conoce mejor sus productos que quien los
 * vende, y así la agencia no tiene que recortar y etiquetar fotos ajenas. Es
 * **opcional**: el negocio que no quiera fotos salta el paso y su agente
 * responde solo con texto, como hasta ahora.
 *
 * La foto se **comprime aquí, en el navegador**, antes de subirla. Una foto de
 * móvil pesa 3-5 MB y se pasaría del límite; además viajaría entera por la red
 * del cliente, que en un celular con datos es lo que hace abandonar el paso.
 */
function FotosDeProductos() {
  const [fotos, setFotos] = useState<{ id: string; etiqueta: string }[]>([]);
  const [etiqueta, setEtiqueta] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const d = await fetch("/api/media")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d?.fotos) setFotos(d.fotos);
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  /** Reduce la foto a 1280 px de lado mayor y la pasa a JPEG. */
  async function comprimir(archivo: File): Promise<string> {
    const url = URL.createObjectURL(archivo);
    try {
      const img = await new Promise<HTMLImageElement>((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => fail(new Error("imagen ilegible"));
        i.src = url;
      });
      const max = 1280;
      const escala = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "";
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function subir(archivo: File) {
    if (!etiqueta.trim()) {
      setError("Primero escribe de qué es la foto.");
      return;
    }
    setError(null);
    setSubiendo(true);
    try {
      const base64 = await comprimir(archivo);
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          etiqueta: etiqueta.trim(),
          kind: "producto",
          base64,
          mimeType: "image/jpeg",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.message ?? "No pudimos subir la foto.");
        return;
      }
      setEtiqueta("");
      await recargar();
    } catch {
      setError("No pudimos leer esa foto. Prueba con otra.");
    } finally {
      setSubiendo(false);
    }
  }

  async function borrar(id: string) {
    await fetch(`/api/media?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => null
    );
    await recargar();
  }

  return (
    <div className="space-y-4">
      {fotos.length > 0 ? (
        <div className="space-y-2">
          {fotos.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-md border p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${f.id}`}
                alt={f.etiqueta}
                className="h-12 w-12 rounded object-cover"
              />
              <span className="flex-1 truncate text-sm">{f.etiqueta}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void borrar(f.id)}
              >
                Quitar
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2 rounded-md border border-dashed p-4">
        <Label className="text-[15px] font-medium">¿De qué es la foto?</Label>
        <p className="text-[13px] text-muted-foreground">
          Escribe el nombre tal como lo llamas tú. Es lo que el asistente busca
          cuando un cliente pregunta por ese producto.
        </p>
        <ExpandableInput
          placeholder="Ej: Volumen Ruso"
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
        />
        <label
          className={`mt-1 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm ${
            etiqueta.trim() && !subiendo
              ? "cursor-pointer hover:bg-accent"
              : "cursor-not-allowed opacity-50"
          }`}
        >
          <Upload className="h-4 w-4" />
          {subiendo ? "Subiendo…" : "Elegir la foto"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!etiqueta.trim() || subiendo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-[13px] text-emerald-700 dark:text-emerald-500">
          Ejemplo: subes la foto de tu producto estrella y la llamas como en tu
          carta. Cuando alguien pregunte por él, el asistente le manda esa foto.
        </p>
      </div>
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

export function OnboardingWizard() {
  const [ficha, setFicha] = useState<Ficha>({});
  const [etapa, setEtapa] = useState(0);
  const [cargado, setCargado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [terminado, setTerminado] = useState(false);
  const [avisoGuardado, setAvisoGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requisitosDisponibles, setRequisitosDisponibles] = useState<
    { id: string; etiqueta: string }[]
  >([]);

  useEffect(() => {
    void fetch("/api/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.borrador) setFicha(d.borrador);
        if (d?.requisitosDisponibles) setRequisitosDisponibles(d.requisitosDisponibles);
      })
      .catch(() => null)
      .finally(() => setCargado(true));
  }, []);

  const set = useCallback((cambio: Partial<Ficha>) => {
    setFicha((f) => ({ ...f, ...cambio }));
  }, []);

  /** Guarda el avance. Se llama al cambiar de etapa, nunca en cada tecla. */
  const guardar = useCallback(async (datos: Ficha) => {
    setGuardando(true);
    await fetch("/api/onboarding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ borrador: datos }),
    }).catch(() => null);
    setGuardando(false);
  }, []);

  const etapas = [
    {
      titulo: "Tu negocio",
      subtitulo: "Lo básico, para que el asistente sepa de quién habla.",
      contenido: (
        <>
          <Campo titulo="¿Cómo se llama tu negocio?" ejemplo="Pastelería La Dulce">
            <ExpandableInput
              value={ficha.nombre ?? ""}
              onChange={(e) => set({ nombre: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Qué vendes o qué servicio ofreces?"
            ayuda="Una frase. Así se presenta el asistente ante tus clientes."
            ejemplo="Vendemos tortas y postres artesanales por encargo."
          >
            <Textarea
              rows={2}
              value={ficha.queVende ?? ""}
              onChange={(e) => set({ queVende: e.target.value })}
            />
            <AvisoCorto
              valor={ficha.queVende}
              minimo={30}
              que="cuentas un poco más de lo que vendes"
            />
          </Campo>
          <Campo titulo="¿En qué ciudad y barrio estás?" ejemplo="Cali, barrio Granada">
            <ExpandableInput
              value={ficha.ubicacion ?? ""}
              onChange={(e) => set({ ubicacion: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Tu negocio vende productos o agenda citas?"
            ayuda="Si tus clientes reservan una hora contigo (peluquería, spa, consultorio), elige Citas."
          >
            <div className="flex gap-2">
              {(["pedidos", "citas"] as const).map((v) => (
                <Button
                  key={v}
                  type="button"
                  variant={ficha.vertical === v ? "default" : "outline"}
                  onClick={() => set({ vertical: v })}
                >
                  {v === "pedidos" ? "Vendo productos" : "Agendo citas"}
                </Button>
              ))}
            </div>
          </Campo>
        </>
      ),
    },
    {
      titulo: "Tu horario",
      subtitulo: "El asistente no ofrece nada fuera de tu horario.",
      contenido: (
        <>
          <Campo titulo="¿Qué días atiendes?">
            <div className="flex flex-wrap gap-2">
              {DIAS.map((d) => {
                const activos = ficha.horario?.dias ?? [];
                const on = activos.includes(d.n);
                return (
                  <Button
                    key={d.n}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() =>
                      set({
                        horario: {
                          ...(ficha.horario ?? { dias: [], abre: "", cierra: "" }),
                          dias: on
                            ? activos.filter((x) => x !== d.n)
                            : [...activos, d.n].sort(),
                        },
                      })
                    }
                  >
                    {d.nombre}
                  </Button>
                );
              })}
            </div>
          </Campo>
          <div className="grid grid-cols-2 gap-4">
            <Campo titulo="Abres a las" ejemplo="09:00">
              <Input
                placeholder="09:00"
                value={ficha.horario?.abre ?? ""}
                onChange={(e) =>
                  set({
                    horario: {
                      ...(ficha.horario ?? { dias: [], abre: "", cierra: "" }),
                      abre: e.target.value,
                    },
                  })
                }
              />
            </Campo>
            <Campo titulo="Cierras a las" ejemplo="19:00">
              <Input
                placeholder="19:00"
                value={ficha.horario?.cierra ?? ""}
                onChange={(e) =>
                  set({
                    horario: {
                      ...(ficha.horario ?? { dias: [], abre: "", cierra: "" }),
                      cierra: e.target.value,
                    },
                  })
                }
              />
            </Campo>
          </div>
          <p className="text-[13px] text-muted-foreground">
            ¿El domingo tienes un horario distinto? Déjalo en la última etapa, en
            &ldquo;algo más que debamos saber&rdquo;.
          </p>
        </>
      ),
    },
    {
      titulo: "Cómo reciben lo que piden",
      subtitulo: "Aquí está el dato que más problemas evita: quién paga el domicilio.",
      contenido: (
        <>
          <Campo titulo="¿Haces domicilios?">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={ficha.entrega?.haceDomicilios ? "default" : "outline"}
                onClick={() =>
                  set({ entrega: { ...(ficha.entrega ?? {}), haceDomicilios: true } })
                }
              >
                Sí
              </Button>
              <Button
                type="button"
                variant={
                  ficha.entrega && !ficha.entrega.haceDomicilios ? "default" : "outline"
                }
                onClick={() =>
                  set({ entrega: { ...(ficha.entrega ?? {}), haceDomicilios: false } })
                }
              >
                No
              </Button>
            </div>
          </Campo>
          {ficha.entrega?.haceDomicilios ? (
            <>
              <Campo
                titulo="¿Con quién los haces y cuánto tardan?"
                ejemplo="Por Yango, llega en 1 hora aproximadamente."
              >
                <ExpandableInput
                  value={ficha.entrega?.como ?? ""}
                  onChange={(e) =>
                    set({
                      entrega: {
                        ...(ficha.entrega ?? { haceDomicilios: true }),
                        como: e.target.value,
                      },
                    })
                  }
                />
              </Campo>
              <Campo
                titulo="¿Quién paga el domicilio y cuándo?"
                ayuda="Es el dato que más discusiones evita. Si el cliente no lo sabe, cree que el total ya lo incluye."
                ejemplo="El domicilio se paga aparte, directo al repartidor cuando llega."
              >
                <ExpandableInput
                  value={ficha.entrega?.quienPagaElDomicilio ?? ""}
                  onChange={(e) =>
                    set({
                      entrega: {
                        ...(ficha.entrega ?? { haceDomicilios: true }),
                        quienPagaElDomicilio: e.target.value,
                      },
                    })
                  }
                />
              </Campo>
              <Campo
                titulo="¿Alguna restricción para entregar?"
                ejemplo="No entramos a conjuntos ni centros comerciales; entregamos en portería."
              >
                <ExpandableInput
                  value={ficha.entrega?.restricciones ?? ""}
                  onChange={(e) =>
                    set({
                      entrega: {
                        ...(ficha.entrega ?? { haceDomicilios: true }),
                        restricciones: e.target.value,
                      },
                    })
                  }
                />
              </Campo>
            </>
          ) : null}
          <Campo
            titulo="¿Pueden recoger donde ti? ¿Cómo funciona?"
            ejemplo="Sí, pasando por el local en horario de atención."
          >
            <ExpandableInput
              value={ficha.entrega?.recogerEnLocal ?? ""}
              onChange={(e) =>
                set({
                  entrega: {
                    ...(ficha.entrega ?? { haceDomicilios: false }),
                    recogerEnLocal: e.target.value,
                  },
                })
              }
            />
          </Campo>
          {/*
            La pregunta que nadie hacía.
            Un negocio contestó a una clienta que NO tenía app de domicilios
            cuando sí la tenía: no se le había ocurrido contarlo, porque en
            ocho pasos nadie se lo preguntó (20-ago-2026). Un dato que el
            cuestionario no pide es un dato que el agente no va a tener.
          */}
          <Campo
            titulo="¿Te pueden pedir por otro lado? (apps, tienda web…)"
            ejemplo="Rappi — https://rappi.app.link/mi-negocio"
          >
            <Textarea
              rows={2}
              value={canalesATexto(ficha.canales)}
              onChange={(e) => set({ canales: textoACanales(e.target.value) })}
            />
          </Campo>
        </>
      ),
    },
    {
      titulo: "Cómo te pagan",
      subtitulo: "Estos datos se los dará el asistente a tus clientes tal cual los escribas.",
      contenido: (
        <>
          <Campo titulo="¿Qué formas de pago aceptas?" ejemplo="Transferencia y efectivo.">
            <ExpandableInput
              value={ficha.pago?.formas ?? ""}
              onChange={(e) =>
                set({
                  pago: {
                    ...(ficha.pago ?? { formas: "", compruebaUnaPersona: true }),
                    formas: e.target.value,
                  },
                })
              }
            />
          </Campo>
          <Campo
            titulo="Si aceptas transferencia: ¿a qué cuenta y a nombre de quién?"
            ayuda="⚠️ Revísalo con calma: el asistente lo copia tal cual. Un dígito mal es dinero perdido."
            ejemplo="Bancolombia Ahorros 12345678901 — a nombre de María Pérez"
          >
            <Textarea
              rows={3}
              value={ficha.pago?.datosDeCuenta ?? ""}
              onChange={(e) =>
                set({
                  pago: {
                    ...(ficha.pago ?? { formas: "", compruebaUnaPersona: true }),
                    datosDeCuenta: e.target.value,
                  },
                })
              }
            />
          </Campo>
          <p className="rounded-md border bg-muted/40 p-3 text-[13px] text-muted-foreground">
            El asistente le pedirá la foto del comprobante a tu cliente, pero{" "}
            <strong>nunca da un pago por bueno</strong>: eso lo revisa siempre una
            persona de tu equipo, para que nadie te pase un comprobante falso.
          </p>
          {ficha.vertical === "citas" && (
            <Campo
              titulo="¿Cobras por adelantado al confirmar una cita?"
              ayuda="Si no lo marcas, la conversación termina en la confirmación sin mencionar el pago."
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ficha.cierre?.pagoAntesDeLaCita ?? false}
                  onChange={(e) =>
                    set({
                      cierre: { ...ficha.cierre, pagoAntesDeLaCita: e.target.checked },
                    })
                  }
                  className="h-4 w-4 accent-primary"
                />
                Pedir el pago por adelantado (con los datos de arriba) para
                dejar la cita en firme.
              </label>
            </Campo>
          )}
        </>
      ),
    },
    {
      titulo: "Fotos de tus productos",
      subtitulo:
        "Opcional. Si las subes, el asistente puede enseñarlas cuando alguien pregunte.",
      contenido: (
        <>
          <p className="rounded-md border bg-muted/40 p-3 text-[13px] text-muted-foreground">
            Hay cosas que se explican mejor con una foto que con veinte líneas
            de texto. Si un cliente pregunta &ldquo;¿cómo se ve?&rdquo;, el
            asistente le manda la imagen de ese producto — solo la de lo que
            preguntó, no un álbum entero.
            <br />
            <br />
            <strong>Si no quieres fotos, salta este paso.</strong> Tu asistente
            funciona igual, respondiendo con texto.
          </p>
          <FotosDeProductos />
        </>
      ),
    },
    {
      titulo: "Cómo le habla a tus clientes",
      subtitulo: "Para que suene como tú, no como un robot.",
      contenido: (
        <>
          <Campo
            titulo="¿Cómo quieres que le hable a tus clientes?"
            ayuda="Piensa en cómo hablas tú por WhatsApp: ¿formal o cercano? ¿Usas emojis?"
            ejemplo="Cercano y alegre, con emojis, hablando siempre de nosotros."
          >
            <Textarea
              rows={3}
              value={ficha.tono ?? ""}
              onChange={(e) => set({ tono: e.target.value })}
            />
            {/*
              El tono es el campo que MÁS cambia el resultado. Probado: con
              "normal" el agente contesta correcto pero sin personalidad; con
              un tono descrito de verdad sale el "¡Hola Churr@! 💛" de Lis.
              Misma tecnología, resultado incomparable.
            */}
            <AvisoCorto
              valor={ficha.tono}
              minimo={25}
              que="describes cómo hablas tú con tus clientes"
            />
          </Campo>
          <Campo
            titulo="¿Se puede pedir como regalo? ¿Manejas tarjetas o dedicatorias?"
            ejemplo="Sí, y se puede agregar una tarjeta con mensaje."
          >
            <ExpandableInput
              value={ficha.regalos ?? ""}
              onChange={(e) => set({ regalos: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Quieres un saludo propio para quien escribe por primera vez?"
            ayuda="Si lo dejas vacío, usamos uno con el nombre de tu negocio."
            ejemplo="¡Hola! 💗 Bienvenid@ a La Dulce. ¿Qué se te antoja hoy?"
          >
            <Textarea
              rows={2}
              value={ficha.saludoInicial ?? ""}
              onChange={(e) => set({ saludoInicial: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Quieres que el cliente elija de un menú al escribirte por primera vez?"
            ayuda="En vez de escribir libremente, tu cliente toca una opción. Déjalo vacío si prefieres que el asistente conteste libremente, como hasta ahora."
            ejemplo="Ver menú y precios · Hacer un pedido · Preguntas frecuentes · Hablar con un asesor"
          >
            <Lista
              valores={ficha.menu?.opciones ?? []}
              marcador="Ej: Hacer un pedido"
              onChange={(v) => set({ menu: { opciones: v } })}
            />
          </Campo>
        </>
      ),
    },
    /*
     * Aquí había un paso "Lo que más te preguntan" que recogía las preguntas
     * frecuentes. Se quitó el 15-ago-2026 porque **preguntaba lo mismo que la
     * pantalla de Conocimiento**, y de las dos copias solo una podía ganar: al
     * enviar el cuestionario, lo escrito en el cuestionario borraba lo escrito
     * en la pantalla, sin aviso y sin rastro.
     *
     * Le pasó a Lashes Valen con una respuesta de salud que ya se había
     * corregido a mano (`docs/korexia/57-PENDIENTES-14AGO.md`).
     *
     * Es la misma decisión que ya se había tomado con el catálogo, que tampoco
     * se pide aquí: el dato vive en su pantalla, y el alta no lo duplica.
     */
    {
      titulo: "Cuándo debe llamarte a ti",
      subtitulo: "La etapa más importante: cuándo el asistente NO debe resolver solo.",
      contenido: (
        <>
          <Campo
            titulo="¿En qué casos prefieres que te pase la conversación a ti?"
            ayuda="El asistente avisa a tu equipo y deja de responder ese chat."
            ejemplo="Reclamos o quejas · Devoluciones de dinero · Pedidos muy grandes"
          >
            <Lista
              valores={ficha.escalarSiempre ?? []}
              marcador="Ej: Reclamos o quejas"
              onChange={(v) => set({ escalarSiempre: v })}
            />
          </Campo>
          <Campo
            titulo="¿Qué NO debe decir ni prometer nunca?"
            ayuda="Cosas que, si las promete y no se cumplen, te generan un problema."
            ejemplo="Una hora exacta de entrega · Descuentos por su cuenta"
          >
            <Lista
              valores={ficha.nuncaPrometer ?? []}
              marcador="Ej: Una hora exacta de entrega"
              onChange={(v) => set({ nuncaPrometer: v })}
            />
          </Campo>
          <Campo
            titulo="¿Algo más que debamos saber de tu negocio?"
            ayuda="Cualquier regla tuya que no encaje arriba. Estas suelen ser las que más te distinguen."
            ejemplo="Las bebidas solo se venden en el local · El domingo cerramos a las 3"
          >
            <Lista
              valores={ficha.reglasPropias ?? []}
              marcador="Ej: Las bebidas solo se venden en el local"
              onChange={(v) => set({ reglasPropias: v })}
            />
          </Campo>
        </>
      ),
    },
    {
      titulo: "Datos que deben solicitarse antes de confirmar",
      subtitulo:
        "El asistente los pedirá —si el cliente no los ha dado— antes de cerrar un pedido o una cita.",
      contenido: (
        <Campo titulo="¿Qué datos son obligatorios?" ayuda="Se guardan en el contacto.">
          <div className="space-y-2">
            {requisitosDisponibles.map((r) => {
              const marcado = (ficha.cierre?.requisitos ?? []).some((x) => x.id === r.id);
              return (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => {
                      const actuales = ficha.cierre?.requisitos ?? [];
                      const siguientes = marcado
                        ? actuales.filter((x) => x.id !== r.id)
                        : [...actuales, { id: r.id }];
                      set({ cierre: { requisitos: siguientes } });
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  Solicitar {r.etiqueta}.
                </label>
              );
            })}
          </div>
        </Campo>
      ),
    },
  ];

  /*
   * El catálogo NUNCA se pide aquí, en ningún vertical (25-ago-2026).
   *
   * En CITAS los servicios viven en la tabla `service`, con su duración y con
   * quién atiende cada uno. En PEDIDOS, los productos y sus grupos de
   * opciones viven en `product`/`product_option_group` — antes se escribían
   * como texto libre en este paso y alguien los migraba después, así que la
   * copia del alta se quedaba vieja el mismo día en que el negocio ya
   * gestionaba su catálogo desde el CRM. Se cargan en **Servicios** o
   * **Catálogo** según el vertical, nunca los dos. El aviso del final del
   * alta lleva a la pantalla que corresponde.
   */
  // El fallback evita un `actual` posiblemente indefinido sin ensuciar el
  // JSX con interrogaciones — `etapas` nunca está vacío (son literales), pero
  // TypeScript no puede saberlo.
  const actual = etapas[Math.min(etapa, etapas.length - 1)] ?? etapas[0]!;
  const ultima = etapa >= etapas.length - 1;

  async function terminar() {
    setError(null);
    setGuardando(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ borrador: ficha }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setError(d?.error?.message ?? "No se pudo guardar. Revisa que no falte nada.");
      return;
    }
    setTerminado(true);
  }

  if (!cargado) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  if (terminado) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader className="items-center text-center">
          <PartyPopper className="h-10 w-10 text-emerald-600" />
          <CardTitle className="mt-2">¡Listo, ya tenemos todo!</CardTitle>
          <CardDescription>
            Con lo que nos contaste vamos a configurar tu asistente. Lo revisamos
            contigo y lo activamos juntos — no se enciende solo, para que nadie
            hable con tus clientes antes de que tú lo veas funcionando.
          </CardDescription>
        </CardHeader>
        {/* El alta NO pide el catálogo en ningún vertical: decirlo aquí es lo
            que evita que alguien termine el alta creyendo que ya está todo —
            que fue el fallo original, silencioso, con las citas. */}
        {ficha.vertical === "citas" ? (
          <CardContent>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] dark:border-amber-800 dark:bg-amber-950/30">
              <p className="font-medium">Falta un paso: tus servicios.</p>
              <p className="mt-1 text-muted-foreground">
                Se cargan en la pantalla <strong>Servicios</strong> — de una vez,
                subiendo tu catálogo en PDF, una foto o pegando la lista. Ahí se
                les pone cuánto dura cada uno y quién lo atiende, que es lo que
                evita que se crucen dos citas.
              </p>
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] dark:border-amber-800 dark:bg-amber-950/30">
              <p className="font-medium">Falta un paso: tu catálogo.</p>
              <p className="mt-1 text-muted-foreground">
                Se carga en la pantalla <strong>Catálogo</strong> — ahí agregas
                cada producto con su precio y, si tiene, sus opciones para
                elegir (sabores, tamaños, toppings).
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Barra de progreso: saber cuánto falta es lo que evita el abandono. */}
      <div className="flex items-center gap-2">
        {etapas.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= etapa ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">
        Paso {etapa + 1} de {etapas.length}
        {guardando ? " · guardando…" : " · se guarda solo al avanzar"}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{actual.titulo}</CardTitle>
          <CardDescription>{actual.subtitulo}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">{actual.contenido}</CardContent>
      </Card>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={etapa === 0}
          onClick={() => setEtapa((e) => e - 1)}
        >
          <ArrowLeft className="h-4 w-4" /> Atrás
        </Button>

        {/*
          Botón de guardar EXPLÍCITO, aunque el avance ya guarda solo.
          Lo pidió el dueño y tiene razón: nadie se fía de un guardado que no
          ve. Alguien que va a cerrar la pestaña en la etapa 4 necesita pulsar
          algo y leer "guardado" para irse tranquilo — si no, o se queda
          rellenando de más, o cierra creyendo que lo pierde todo.
        */}
        <Button
          type="button"
          variant="ghost"
          disabled={guardando}
          onClick={async () => {
            await guardar(ficha);
            setAvisoGuardado(true);
            setTimeout(() => setAvisoGuardado(false), 2500);
          }}
        >
          {avisoGuardado ? (
            <>
              <Check className="h-4 w-4 text-emerald-600" /> Guardado
            </>
          ) : (
            <>
              <Save className="h-4 w-4" /> Guardar y seguir después
            </>
          )}
        </Button>
        {ultima ? (
          <Button type="button" onClick={() => void terminar()} disabled={guardando}>
            {guardando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Terminar
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              void guardar(ficha);
              setEtapa((e) => e + 1);
            }}
          >
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
