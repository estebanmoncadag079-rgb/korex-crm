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
  pago?: { formas: string; datosDeCuenta?: string; compruebaUnaPersona: boolean };
  tono?: string;
  regalos?: string;
  saludoInicial?: string;
  reglasPropias?: string[];
  preguntasFrecuentes?: { pregunta: string; respuesta: string }[];
  escalarSiempre?: string[];
  nuncaPrometer?: string[];
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
        <Input
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

/** Lo que devuelve el lector de cartas, tal cual: se revisa antes de usarse. */
type ProductoLeido = {
  nombre: string;
  precio: number | null;
  duracionMin?: number | null;
  categoria?: string | null;
};

/**
 * Subir el catálogo —PDF o foto— en vez de teclear producto a producto.
 *
 * El salón de lashes tiene más de 34 servicios: pedirle a alguien que los
 * escriba uno a uno es la mejor forma de que abandone el alta.
 *
 * El **PDF** es el caso real: el catálogo de un salón es un documento de diez
 * páginas, no una foto. Se abre en el navegador (`lib/pdf-cliente.ts`) y solo
 * viaja su texto — del PDF de 36 MB del salón, 2,9 KB. Decirle a un cliente
 * *"tómale una foto a tu catálogo de diez páginas"* no era una respuesta.
 *
 * ⚠️ **Nada se carga sin revisar.** Lo leído aparece primero en una lista
 * editable, con el aviso de comprobar los precios. Viene de un incidente real:
 * el catálogo del salón se cargó a mano con 12 precios equivocados que nadie
 * detectó hasta que llegó el PDF oficial.
 */
function LectorDeCarta({
  onLeido,
  pedirDuracion = false,
}: {
  onLeido: (texto: string) => void;
  /** En citas la duración no es un adorno: de ella depende que no se crucen. */
  pedirDuracion?: boolean;
}) {
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState<{
    productos: ProductoLeido[];
    texto: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queEs = pedirDuracion ? "servicios" : "productos";

  /**
   * El PDF se lee aquí, en el navegador: primero su texto (exacto y gratis) y,
   * si es un escaneo sin capa de texto, se rasteriza la primera página y se
   * manda al lector de imágenes de siempre. El documento no sale del computador
   * del cliente.
   */
  async function subirPdf(archivo: File) {
    setError(null);
    setLeyendo(true);
    try {
      const { textoDePdf, primeraPaginaComoPng } = await import("@/lib/pdf-cliente");
      const leido = await textoDePdf(archivo);
      if (leido.ok) {
        await pedirLectura({ texto: leido.texto });
        return;
      }
      const png = await primeraPaginaComoPng(archivo);
      if (!png) {
        setError(
          `No pudimos leer ese PDF. Prueba con una foto, o escribe tus ${queEs} abajo.`
        );
        return;
      }
      await pedirLectura({ base64: png.base64, mimeType: "image/png" });
    } catch {
      setError(`No pudimos leer ese PDF. Puedes escribir tus ${queEs} a mano.`);
    } finally {
      setLeyendo(false);
    }
  }

  async function subirFoto(archivo: File) {
    setError(null);
    setLeyendo(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () =>
          resolve(String(lector.result).split(",")[1] ?? "");
        lector.onerror = () => reject(new Error("no se pudo leer el archivo"));
        lector.readAsDataURL(archivo);
      });
      await pedirLectura({ base64, mimeType: archivo.type });
    } catch {
      setError(`No pudimos leer la foto. Puedes escribir tus ${queEs} a mano.`);
    } finally {
      setLeyendo(false);
    }
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
    const productos: ProductoLeido[] = d.productos ?? [];
    if (!productos.length) {
      setError(`No encontramos ${queEs} ahí. Puedes escribirlos abajo.`);
      return;
    }
    /*
     * El texto lo arma el servidor (`catalogoATexto`) y por eso conserva las
     * categorías y los minutos de cada línea. Rehacerlo aquí como
     * "nombre — precio" era justo lo que tiraba las duraciones leídas.
     */
    setLectura({ productos, texto: d.texto ?? "" });
  }

  if (lectura) {
    const { productos } = lectura;
    const sinPrecio = productos.filter((p) => p.precio === null).length;
    const sinDuracion = productos.filter((p) => !p.duracionMin).length;
    return (
      <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
        <p className="text-sm font-medium">
          Encontramos {productos.length} {queEs}. Revísalos antes de continuar —
          sobre todo los precios.
        </p>
        {sinPrecio > 0 ? (
          <p className="text-[13px] text-amber-800 dark:text-amber-400">
            ⚠️ {sinPrecio} sin precio: no lo adivinamos, complétalos abajo.
          </p>
        ) : null}
        {pedirDuracion && sinDuracion > 0 ? (
          <p className="text-[13px] text-amber-800 dark:text-amber-400">
            ⚠️ {sinDuracion} sin duración. Ponla en la línea (· 90 min) o toma
            la duración típica de abajo: de ella depende que no se te crucen dos
            clientas.
          </p>
        ) : null}
        <div className="max-h-56 overflow-y-auto rounded border bg-background">
          {productos.map((p, i) => (
            <div
              key={i}
              className="flex justify-between gap-3 border-b px-3 py-1.5 text-[13px] last:border-0"
            >
              <span className="truncate">
                {p.nombre}
                {p.categoria ? (
                  <span className="text-muted-foreground"> · {p.categoria}</span>
                ) : null}
              </span>
              <span className="shrink-0">
                <span className={p.precio === null ? "text-destructive" : ""}>
                  {p.precio === null
                    ? "sin precio"
                    : `$${p.precio.toLocaleString("es-CO")}`}
                </span>
                {pedirDuracion ? (
                  <span
                    className={
                      p.duracionMin
                        ? "text-muted-foreground"
                        : "text-amber-700 dark:text-amber-400"
                    }
                  >
                    {p.duracionMin ? ` · ${p.duracionMin} min` : " · sin duración"}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onLeido(lectura.texto);
              setLectura(null);
            }}
          >
            Usar esta lista
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLectura(null)}
          >
            Descartar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed p-4">
      <p className="text-sm font-medium">
        ¿Tienes tu {pedirDuracion ? "catálogo" : "carta"} en un PDF o una foto?
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Súbelo y sacamos los {queEs} por ti. Después los revisas y corriges lo
        que haga falta. El archivo no sale de tu computador.
      </p>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent">
        <Upload className="h-4 w-4" />
        {leyendo ? "Leyendo…" : "Subir mi PDF o foto"}
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
              void (esPdf ? subirPdf(f) : subirFoto(f));
            }
            e.target.value = "";
          }}
        />
      </label>
      {error ? (
        <p className="mt-2 text-[13px] text-destructive">{error}</p>
      ) : null}
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
        <Input
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

  useEffect(() => {
    void fetch("/api/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.borrador) setFicha(d.borrador);
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
            <Input
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
            <Input
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
      titulo: "Lo que vendes",
      subtitulo: "Con esto el asistente arma los pedidos y calcula los totales.",
      contenido: (
        <>
          <LectorDeCarta
            onLeido={(texto) =>
              set({ catalogo: [ficha.catalogo, texto].filter(Boolean).join("\n") })
            }
          />
          <Campo
            titulo="Tus productos con su precio, uno por línea"
            ayuda="Puedes escribirlos, o subir el PDF o la foto de tu carta aquí arriba y revisar lo que salga."
            ejemplo="Torta de chocolate — $45.000"
          >
            <Textarea
              rows={7}
              placeholder={"Producto — $precio\nProducto — $precio"}
              value={ficha.catalogo ?? ""}
              onChange={(e) => set({ catalogo: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Alguno tiene opciones para elegir? ¿Cuántas puede escoger?"
            ayuda="Sabores, tamaños, toppings, colores…"
            ejemplo="La torta de 16 oz lleva 3 toppings a elección entre 8 sabores."
          >
            <Textarea
              rows={3}
              value={ficha.variantes ?? ""}
              onChange={(e) => set({ variantes: e.target.value })}
            />
          </Campo>
        </>
      ),
    },
    {
      titulo: "Tus servicios",
      subtitulo:
        "Con esto tu asistente sabe qué ofreces, a qué precio y cuánto ocupa cada cita.",
      contenido: (
        <>
          <LectorDeCarta
            pedirDuracion
            onLeido={(texto) =>
              set({ catalogo: [ficha.catalogo, texto].filter(Boolean).join("\n") })
            }
          />
          <Campo
            titulo="Tus servicios con su precio, uno por línea"
            ayuda="Puedes escribirlos, o subir el PDF o la foto de tu catálogo aquí arriba. Si agrupas con títulos (PESTAÑAS, CEJAS…), se guardan como categorías. Si sabes cuánto dura alguno, ponlo en la misma línea."
            ejemplo="Volumen ruso — $150.000 · 180 min"
          >
            <Textarea
              rows={8}
              placeholder={
                "PESTAÑAS\nVolumen ruso — $150.000 · 180 min\nLifting de pestañas — $80.000 · 60 min\n\nCEJAS\nCejas en henna — $30.000 · 45 min"
              }
              value={ficha.catalogo ?? ""}
              onChange={(e) => set({ catalogo: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Cuánto dura una cita normal?"
            ayuda="En minutos. Es lo que evita que se te crucen dos clientas a la misma hora. Se usa para los servicios a los que no les pusiste duración arriba; después puedes ajustar cada uno en la pantalla de Servicios."
            ejemplo="60"
          >
            <Input
              inputMode="numeric"
              className="w-32"
              placeholder="60"
              value={ficha.duracionTipicaMin ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                set({
                  duracionTipicaMin: Number.isFinite(n) && n > 0 ? n : undefined,
                });
              }}
            />
          </Campo>
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
                <Input
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
                <Input
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
                <Input
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
            <Input
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
        </>
      ),
    },
    {
      titulo: "Cómo te pagan",
      subtitulo: "Estos datos se los dará el asistente a tus clientes tal cual los escribas.",
      contenido: (
        <>
          <Campo titulo="¿Qué formas de pago aceptas?" ejemplo="Transferencia y efectivo.">
            <Input
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
            <Input
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
        </>
      ),
    },
    {
      titulo: "Lo que más te preguntan",
      subtitulo: "Entre más completes aquí, menos veces te va a interrumpir el asistente.",
      contenido: (
        <div className="space-y-4">
          {(ficha.preguntasFrecuentes ?? [{ pregunta: "", respuesta: "" }]).map(
            (p, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <Input
                  placeholder="¿Qué te preguntan? Ej: ¿hacen envíos fuera de la ciudad?"
                  value={p.pregunta}
                  onChange={(e) => {
                    const copia = [...(ficha.preguntasFrecuentes ?? [p])];
                    copia[i] = { respuesta: p.respuesta, pregunta: e.target.value };
                    set({ preguntasFrecuentes: copia });
                  }}
                />
                <Textarea
                  rows={2}
                  placeholder="¿Qué responderías tú?"
                  value={p.respuesta}
                  onChange={(e) => {
                    const copia = [...(ficha.preguntasFrecuentes ?? [p])];
                    copia[i] = { pregunta: p.pregunta, respuesta: e.target.value };
                    set({ preguntasFrecuentes: copia });
                  }}
                />
              </div>
            )
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set({
                preguntasFrecuentes: [
                  ...(ficha.preguntasFrecuentes ?? []),
                  { pregunta: "", respuesta: "" },
                ],
              })
            }
          >
            + Agregar otra pregunta
          </Button>
        </div>
      ),
    },
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
  ];

  /*
   * Cada vertical ve SU etapa de catálogo.
   *
   * Antes, a un negocio de citas se le ocultaba "Lo que vendes" entera y no se
   * le ofrecía nada a cambio: terminaba el alta sin un solo servicio y sin que
   * nada se lo advirtiera. Su agente no sabía qué ofrecía ni a qué precio, y
   * cargarlo significaba ir a otra pantalla a teclear 46 servicios de uno en
   * uno. Ahora ve "Tus servicios", que pide lo mismo más la duración — de la
   * que depende que no se le crucen dos citas.
   */
  const etapaSobra = (titulo: string) =>
    ficha.vertical === "citas"
      ? titulo === "Lo que vendes"
      : titulo === "Tus servicios";
  const visibles = etapas.filter((e) => !etapaSobra(e.titulo));
  // `visibles` nunca está vacío (las etapas son literales), pero TypeScript no
  // puede saberlo: el fallback evita un `actual` posiblemente indefinido sin
  // ensuciar el JSX con interrogaciones.
  const actual = visibles[Math.min(etapa, visibles.length - 1)] ?? etapas[0]!;
  const ultima = etapa >= visibles.length - 1;

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
      setError(d?.message ?? "No se pudo guardar. Revisa que no falte nada.");
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
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Barra de progreso: saber cuánto falta es lo que evita el abandono. */}
      <div className="flex items-center gap-2">
        {visibles.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= etapa ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">
        Paso {etapa + 1} de {visibles.length}
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
