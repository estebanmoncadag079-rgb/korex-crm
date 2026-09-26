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
import { comprimirImagen } from "@/lib/comprimir-imagen";

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
    /**
     * CANÓNICO: un día está abierto si —y solo si— tiene su franja aquí.
     * Ver `@/server/horario`. El resto de campos son su proyección y los
     * recalcula el servidor al guardar; esta pantalla no los escribe.
     */
    porDia?: Record<string, { abre: string; cierra: string }>;
    dias: number[];
    abre: string;
    cierra: string;
    abreDomingo?: string;
    cierraDomingo?: string;
  };
  /** Contexto libre sobre el horario. No decide nada (ver `@/server/horario`). */
  observacionesHorario?: string;
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
    /** Pedido mínimo para domicilio, en centavos. Ausente = sin mínimo. */
    minimoDomicilioCents?: number;
  };
  /** Dónde más te pueden pedir: apps de domicilio, tienda web, marketplace. */
  canales?: { nombre: string; enlace?: string }[];
  pago?: {
    formas: string;
    datosDeCuenta?: string;
    compruebaUnaPersona: boolean;
    /** Doc 200: las formas de pago como dato, por modalidad. */
    porModalidad?: { domicilio?: MetodoDePago[]; recoger?: MetodoDePago[] };
    /** Doc 200: cuándo se dan los datos de la cuenta. Vacío = si la piden. */
    cuentaAntesDeConfirmar?: "si_la_piden" | "nunca";
  };
  /** Doc 200, solo citas: la política de cancelación, tal cual. */
  politicaDeCancelacion?: string;
  /** Doc 200: ¿se toman pedidos con el negocio cerrado? Vacío = sí. */
  fueraDeHorario?: { tomaPedidos: boolean };
  /** Doc 200: qué hacer cuando responden a una historia/estado. Vacío = responder. */
  respuestaAPublicaciones?: "responder" | "pasar_al_equipo";
  /** Doc 200: lo que el asistente envía tal cual en momentos fijos. */
  mensajes?: {
    derivar?: string;
    fueraDeHorario?: string;
    pedirBarrio?: string;
    domicilioPendiente?: string;
  };
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

type MetodoDePago = "transferencia" | "efectivo" | "tarjeta";

const METODOS: { valor: MetodoDePago; texto: string }[] = [
  { valor: "transferencia", texto: "Transferencia (Nequi, Daviplata, llave)" },
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "tarjeta", texto: "Tarjeta" },
];

const NOMBRE_LARGO = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

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

/**
 * Aviso de contenido posiblemente mezclado (1-sep-2026, auditoría de
 * fichas): el backend ya analizó el texto (`analizarContenidoConfigurable`,
 * nunca duplicado aquí) y devolvió advertencias por campo. Puramente
 * informativo, mismo estilo visual que `AvisoCorto` — nunca bloquea
 * avanzar ni guardar. Deliberadamente sin jerga técnica: el dueño del
 * negocio no sabe qué es "mezcla_de_audiencia", pero sí entiende la
 * diferencia entre "lo que le digo al cliente" y "lo que le digo al bot".
 */
function AvisoContenidoMezclado({
  campo,
  advertencias,
}: {
  campo: string;
  advertencias: { campo: string }[];
}) {
  if (!advertencias.some((a) => a.campo === campo)) return null;
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      ⚠️ Este texto parece contener una instrucción para el asistente junto con
      información que podría mostrarse al cliente. Revisa si ambas cosas
      deberían estar separadas — las instrucciones especiales van mejor en
      &ldquo;Reglas propias del negocio&rdquo;.
    </p>
  );
}

/**
 * Qué es cada respuesta para el asistente (doc 200, 26-sep-2026):
 *
 *  - `literal`: el asistente la ENVÍA tal cual al cliente (el saludo, los datos
 *    de la cuenta, el mensaje al pasar con el equipo). Lo que se escribe aquí es
 *    exactamente lo que va a leer el cliente, así que se muestra en una burbuja.
 *  - `instruccion`: el asistente la USA para decidir, pero el cliente nunca la
 *    ve tal cual (el tono, las reglas, cuándo llamarte).
 *
 * Mezclar las dos cosas en un mismo campo es lo que hacía que el bot le copiara
 * al cliente una orden pensada para él, o que resumiera con sus palabras un
 * dato que tenía que ir exacto.
 */
type TipoDeCampo = "literal" | "instruccion";

const MARCA: Record<TipoDeCampo, { borde: string; etiqueta: string; texto: string }> = {
  literal: {
    borde: "border-l-emerald-500",
    etiqueta:
      "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    texto: "💬 Tu asistente lo envía tal cual",
  },
  instruccion: {
    borde: "border-l-slate-400 dark:border-l-slate-500",
    etiqueta: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
    texto: "🧠 Instrucción para tu asistente · tus clientes no la ven",
  },
};

/** Cómo lo va a ver el cliente en WhatsApp: solo para lo que se envía tal cual. */
function Burbuja({ texto }: { texto?: string }) {
  const t = (texto ?? "").trim();
  if (!t) return null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tl-none bg-[#dcf8c6] px-3 py-2 text-[13px] text-neutral-900 shadow-sm dark:bg-[#005c4b] dark:text-neutral-50">
        {t}
      </div>
    </div>
  );
}

/** Explica las dos marcas una vez, arriba de cada paso. */
function LeyendaDeCampos() {
  return (
    <div className="flex flex-wrap gap-2 text-[12px]">
      <span className={`rounded-full px-2 py-0.5 ${MARCA.literal.etiqueta}`}>
        {MARCA.literal.texto}
      </span>
      <span className={`rounded-full px-2 py-0.5 ${MARCA.instruccion.etiqueta}`}>
        {MARCA.instruccion.texto}
      </span>
    </div>
  );
}

/** Una pregunta con su explicación y su ejemplo, como en el cuestionario. */
function Campo({
  titulo,
  ayuda,
  ejemplo,
  tipo,
  vista,
  children,
}: {
  titulo: string;
  ayuda?: string;
  ejemplo?: string;
  /** Qué es la respuesta para el asistente. Sin tipo = un dato de configuración (horario, sí/no). */
  tipo?: TipoDeCampo;
  /** Solo en `literal`: lo que verá el cliente, para mostrarlo en la burbuja. */
  vista?: string;
  children: React.ReactNode;
}) {
  const marca = tipo ? MARCA[tipo] : null;
  return (
    <div className={`space-y-2 ${marca ? `border-l-4 pl-3 ${marca.borde}` : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[15px] font-medium">{titulo}</Label>
        {marca ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${marca.etiqueta}`}>
            {marca.texto}
          </span>
        ) : null}
      </div>
      {ayuda ? <p className="text-[13px] text-muted-foreground">{ayuda}</p> : null}
      {children}
      {tipo === "literal" ? <Burbuja texto={vista} /> : null}
      {ejemplo ? (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-500">
          Ejemplo: {ejemplo}
        </p>
      ) : null}
    </div>
  );
}

/** Elegir una opción entre pocas, con botones (mismo estilo que "¿Haces domicilios?"). */
function Opciones<T extends string>({
  valor,
  opciones,
  onChange,
}: {
  valor: T | undefined;
  opciones: { valor: T; texto: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map((o) => (
        <Button
          key={o.valor}
          type="button"
          variant={valor === o.valor ? "default" : "outline"}
          onClick={() => onChange(o.valor)}
        >
          {o.texto}
        </Button>
      ))}
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
          autoResize
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

  async function subir(archivo: File) {
    if (!etiqueta.trim()) {
      setError("Primero escribe de qué es la foto.");
      return;
    }
    setError(null);
    setSubiendo(true);
    try {
      const base64 = await comprimirImagen(archivo);
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
          autoResize
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
  /**
   * Advertencias de contenido mezclado, por campo (1-sep-2026). Solo
   * informativas — nunca impiden avanzar ni guardar. El análisis vive en
   * el backend (`analizarContenidoConfigurable`); aquí solo se muestra lo
   * que la API ya calculó.
   */
  const [advertenciasContenido, setAdvertenciasContenido] = useState<{ campo: string }[]>([]);

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
    const res = await fetch("/api/onboarding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ borrador: datos }),
    }).catch(() => null);
    // Informativo, nunca bloqueante: si la respuesta no trae advertencias
    // (o falló la petición), simplemente no se muestra ninguna — el
    // guardado en sí ya ocurrió (o no) independientemente de esto.
    const data = await res
      ?.json()
      .catch(() => null) as { advertenciasContenido?: { campo: string }[] } | null;
    setAdvertenciasContenido(data?.advertenciasContenido ?? []);
    setGuardando(false);
  }, []);

  /**
   * El horario, en su forma canónica: un día está abierto si tiene franja.
   *
   * Se lee de `porDia` y, mientras queden fichas sin migrar, se deriva de los
   * campos viejos — así un cliente que abra su cuestionario antes de la
   * migración ve sus días marcados igual.
   */
  const porDia: Record<string, { abre: string; cierra: string }> = (() => {
    const h = ficha.horario;
    if (!h) return {};
    if (h.porDia) return h.porDia;
    const comun = { abre: h.abre ?? "", cierra: h.cierra ?? "" };
    const domingo =
      h.abreDomingo && h.cierraDomingo
        ? { abre: h.abreDomingo, cierra: h.cierraDomingo }
        : null;
    const salida: Record<string, { abre: string; cierra: string }> = {};
    for (const d of h.dias ?? []) {
      // Ojo: la franja de domingo solo cuenta si el domingo está entre los
      // días. Al revés fue el fallo que originó todo esto.
      salida[String(d)] = d === 7 ? (domingo ?? comun) : comun;
    }
    return salida;
  })();

  const diasMarcados = DIAS.map((d) => d.n).filter((n) => porDia[String(n)]);

  /**
   * Días marcados a los que les falta la hora, o la tienen ilegible.
   *
   * Sin esto el día se marcaba, se guardaba y **desaparecía en silencio**: el
   * servidor descarta una franja que no sabe leer, así que el negocio se
   * quedaba cerrado ese día creyendo que lo había configurado (H-1 de la
   * auditoría del 20-sep-2026). El servidor ya lo rechaza; aquí se ve antes,
   * que es donde se puede arreglar.
   */
  const horaLegible = (v: string) => /^\s*\d{1,2}\s*:\s*\d{2}\s*$/.test(v);
  const diasSinHora = diasMarcados.filter((n) => {
    const f = porDia[String(n)];
    return !f || !horaLegible(f.abre) || !horaLegible(f.cierra);
  });

  /** Escribe el canónico. Los derivados los recalcula el servidor al guardar. */
  const guardarPorDia = (nuevo: Record<string, { abre: string; cierra: string }>) => {
    const dias = DIAS.map((d) => d.n).filter((n) => nuevo[String(n)]);
    const primero = dias[0] ? nuevo[String(dias[0])] : undefined;
    set({
      horario: {
        porDia: nuevo,
        // Se mandan también los derivados para que un servidor que todavía no
        // conozca `porDia` no reciba una ficha a medias. Al guardar se
        // recalculan desde el canónico, así que nunca mandan.
        dias,
        abre: primero?.abre ?? "",
        cierra: primero?.cierra ?? "",
      },
    });
  };

  /**
   * Marcar o desmarcar un día. Desmarcar BORRA su franja: no queda un horario
   * huérfano que luego abra el día por su cuenta.
   */
  const alternarDia = (n: number) => {
    const copia = { ...porDia };
    if (copia[String(n)]) {
      delete copia[String(n)];
    } else {
      const modelo = diasMarcados[0] ? porDia[String(diasMarcados[0])] : undefined;
      copia[String(n)] = { abre: modelo?.abre ?? "", cierra: modelo?.cierra ?? "" };
    }
    guardarPorDia(copia);
  };

  const ponerFranja = (n: number, cambio: { abre?: string; cierra?: string }) => {
    const actual = porDia[String(n)];
    if (!actual) return;
    guardarPorDia({ ...porDia, [String(n)]: { ...actual, ...cambio } });
  };

  const copiarFranjaATodos = () => {
    const modelo = diasMarcados[0] ? porDia[String(diasMarcados[0])] : undefined;
    if (!modelo) return;
    const copia: Record<string, { abre: string; cierra: string }> = {};
    for (const n of diasMarcados) copia[String(n)] = { ...modelo };
    guardarPorDia(copia);
  };


  const etapas = [
    {
      titulo: "Tu negocio",
      subtitulo: "Lo básico, para que el asistente sepa de quién habla.",
      contenido: (
        <>
          <Campo titulo="¿Cómo se llama tu negocio?" ejemplo="Pastelería La Dulce">
            <ExpandableInput
              autoResize
              value={ficha.nombre ?? ""}
              onChange={(e) => set({ nombre: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Qué vendes o qué servicio ofreces?"
            ayuda="Una frase. Con esto el asistente sabe cómo presentarse ante tus clientes."
            ejemplo="Vendemos tortas y postres artesanales por encargo."
            tipo="instruccion"
          >
            <Textarea
              autoResize
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
          <Campo titulo="¿En qué ciudad y barrio estás?" ejemplo="Cali, barrio Granada" tipo="instruccion">
            <ExpandableInput
              autoResize
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
      subtitulo: "Marca los días que atiendes y a qué hora. El asistente no ofrece nada fuera de esto.",
      contenido: (
        <>
          <Campo
            titulo="¿Qué días atiendes y en qué horario?"
            ayuda="Un día sin marcar está CERRADO: el asistente no tomará pedidos ni citas ese día. Cada día puede tener su propio horario."
          >
            <div className="space-y-2">
              {DIAS.map((d) => {
                const franja = porDia[String(d.n)];
                const abierto = Boolean(franja);
                return (
                  <div
                    key={d.n}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={abierto ? "default" : "outline"}
                      className="w-[104px] justify-start"
                      aria-pressed={abierto}
                      onClick={() => alternarDia(d.n)}
                    >
                      {abierto ? "☑" : "☐"} {d.nombre}
                    </Button>
                    {franja ? (
                      <div className="flex items-center gap-2">
                        <Input
                          className={`w-[92px] ${horaLegible(franja.abre) ? "" : "border-destructive"}`}
                          placeholder="10:00"
                          aria-label={`Hora de apertura del ${d.nombre}`}
                          aria-invalid={!horaLegible(franja.abre)}
                          value={franja.abre}
                          onChange={(e) => ponerFranja(d.n, { abre: e.target.value })}
                        />
                        <span className="text-muted-foreground text-[13px]">a</span>
                        <Input
                          className={`w-[92px] ${horaLegible(franja.cierra) ? "" : "border-destructive"}`}
                          placeholder="19:00"
                          aria-label={`Hora de cierre del ${d.nombre}`}
                          aria-invalid={!horaLegible(franja.cierra)}
                          value={franja.cierra}
                          onChange={(e) => ponerFranja(d.n, { cierra: e.target.value })}
                        />
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">Cerrado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Campo>
          {diasSinHora.length ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Falta la hora de:{" "}
              {diasSinHora.map((n) => NOMBRE_LARGO[n - 1]).join(", ")}. Escríbela como
              10:00 y 19:00, o desmarca el día si ese día no atiendes — un día marcado
              sin hora no se puede guardar.
            </p>
          ) : null}
          {diasMarcados.length > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copiarFranjaATodos}
            >
              Aplicar el horario del {NOMBRE_LARGO[diasMarcados[0]! - 1]} a todos los días marcados
            </Button>
          ) : null}
          <p className="text-[13px] text-muted-foreground">
            ¿El domingo abres a otra hora? Márcalo y ponle su horario aquí mismo — ya no
            hay que escribirlo en ningún otro sitio.
          </p>
          <Campo
            titulo="Información adicional sobre tus horarios (opcional)"
            ayuda="Para lo que las casillas de arriba no saben decir. Esto lo puede contar el asistente, pero NO cambia cuándo atiende: eso lo deciden los días y horas marcados arriba."
            ejemplo="Recibimos pedidos por WhatsApp desde las 10:00, pero el local abre al público a la 1:00 p. m."
            tipo="instruccion"
          >
            <Textarea
              rows={3}
              placeholder="Ej: el local abre más tarde que el WhatsApp; los festivos cerramos antes…"
              value={ficha.observacionesHorario ?? ""}
              onChange={(e) => set({ observacionesHorario: e.target.value })}
            />
          </Campo>
          {ficha.vertical !== "citas" ? (
            <>
              {/*
                Doc 200: antes era una regla fija para todos ("se toma el
                pedido y se coordina al abrir"). Ahora lo decide el negocio.
              */}
              <Campo
                titulo="Si te escriben con el negocio cerrado, ¿tomas el pedido?"
                ayuda="Si eliges tomarlo, el asistente lo anota y avisa que se prepara apenas abras. Si no, le dice a qué hora abres."
                tipo="instruccion"
              >
                <Opciones
                  valor={ficha.fueraDeHorario?.tomaPedidos === false ? "no" : "si"}
                  opciones={[
                    { valor: "si", texto: "Sí, lo tomo para cuando abra" },
                    { valor: "no", texto: "No, que escriban cuando abra" },
                  ]}
                  onChange={(v) => set({ fueraDeHorario: { tomaPedidos: v === "si" } })}
                />
              </Campo>
              <Campo
                titulo="¿Quieres un mensaje propio para cuando estás cerrado? (opcional)"
                ayuda="Si lo dejas vacío, el asistente lo dice con sus palabras y con tu tono."
                ejemplo="¡Hola! 💗 Ahorita estamos cerrados, pero te tomo el pedido y lo preparamos apenas abramos."
                tipo="literal"
                vista={ficha.mensajes?.fueraDeHorario}
              >
                <Textarea
                  autoResize
                  rows={2}
                  value={ficha.mensajes?.fueraDeHorario ?? ""}
                  onChange={(e) =>
                    set({ mensajes: { ...(ficha.mensajes ?? {}), fueraDeHorario: e.target.value } })
                  }
                />
              </Campo>
            </>
          ) : null}
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
                tipo="instruccion"
              >
                <ExpandableInput
                  autoResize
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
                ayuda="Es el dato que más discusiones evita. Si el cliente no lo sabe, cree que el total ya lo incluye. Va tal cual en el resumen del pedido."
                ejemplo="El domicilio se paga aparte, directo al repartidor cuando llega."
                tipo="literal"
                vista={ficha.entrega?.quienPagaElDomicilio}
              >
                <ExpandableInput
                  autoResize
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
                <AvisoContenidoMezclado
                  campo="entrega.quienPagaElDomicilio"
                  advertencias={advertenciasContenido}
                />
              </Campo>
              <Campo
                titulo="¿Alguna restricción para entregar?"
                ejemplo="No entramos a conjuntos ni centros comerciales; entregamos en portería."
                tipo="instruccion"
              >
                <ExpandableInput
                  autoResize
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
              {/*
                El pedido mínimo, en PESOS para quien lo escribe y en centavos
                para quien lo guarda. Vacío = sin mínimo, que es lo normal.

                Se pregunta en pesos y no "cuántas unidades" porque la regla
                real es económica —un domicilio no sale a cuenta por menos de
                X— y porque un mínimo por unidades no puede expresar "dos
                pequeños o uno grande".
              */}
              <Campo
                titulo="¿Hay un pedido mínimo para domicilio? (déjalo vacío si no)"
                ejemplo="18000 — así no sale un domiciliario por un solo producto pequeño."
              >
                <ExpandableInput
                  inputMode="numeric"
                  placeholder="18000"
                  value={
                    ficha.entrega?.minimoDomicilioCents
                      ? String(Math.round(ficha.entrega.minimoDomicilioCents / 100))
                      : ""
                  }
                  onChange={(e) => {
                    // Solo dígitos: quien escribe "18.000" o "$18000" quiere
                    // decir lo mismo, y un NaN silencioso aquí borraría el
                    // mínimo sin que nadie lo pidiera.
                    const pesos = Number(e.target.value.replace(/\D/g, ""));
                    set({
                      entrega: {
                        ...(ficha.entrega ?? { haceDomicilios: true }),
                        minimoDomicilioCents: pesos > 0 ? pesos * 100 : undefined,
                      },
                    });
                  }}
                />
              </Campo>
              {/*
                Doc 200: dos frases que antes eran fijas e iguales para todos
                los negocios. Vacías = el texto de siempre.
              */}
              <Campo
                titulo="Si el domicilio te lo cotizan aparte: ¿qué le dice el asistente al cerrar? (opcional)"
                ayuda="Va en el resumen final, debajo del valor de los productos. Solo aplica si el valor del domicilio lo confirma tu equipo."
                ejemplo="Domicilio: te confirmamos el valor apenas lo cotice el repartidor 🛵"
                tipo="literal"
                vista={ficha.mensajes?.domicilioPendiente}
              >
                <ExpandableInput
                  autoResize
                  value={ficha.mensajes?.domicilioPendiente ?? ""}
                  onChange={(e) =>
                    set({ mensajes: { ...(ficha.mensajes ?? {}), domicilioPendiente: e.target.value } })
                  }
                />
              </Campo>
              <Campo
                titulo="Si tus tarifas son por barrio: ¿cómo pide el asistente el barrio? (opcional)"
                ayuda="Solo aplica si tienes tu tabla de domicilios por barrio cargada. Se usa cuando la dirección no dice el barrio."
                ejemplo="¿Me regalas el barrio, porfa? Así te doy el total con el domicilio 💕"
                tipo="literal"
                vista={ficha.mensajes?.pedirBarrio}
              >
                <ExpandableInput
                  autoResize
                  value={ficha.mensajes?.pedirBarrio ?? ""}
                  onChange={(e) =>
                    set({ mensajes: { ...(ficha.mensajes ?? {}), pedirBarrio: e.target.value } })
                  }
                />
              </Campo>
            </>
          ) : null}
          <Campo
            titulo="¿Pueden recoger donde ti? ¿Cómo funciona?"
            ejemplo="Sí, pasando por el local en horario de atención."
            tipo="instruccion"
          >
            <ExpandableInput
              autoResize
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
            ayuda="Si preguntan, el asistente les pasa el enlace tal cual."
            ejemplo="Rappi — https://rappi.app.link/mi-negocio"
            tipo="literal"
            vista={canalesATexto(ficha.canales)}
          >
            <Textarea
              autoResize
              rows={2}
              value={canalesATexto(ficha.canales)}
              onChange={(e) => set({ canales: textoACanales(e.target.value) })}
            />
          </Campo>
          {ficha.vertical === "citas" ? (
            <Campo
              titulo="¿Cuál es tu política de cancelación y cambios? (opcional)"
              ayuda="Si una clienta pregunta, el asistente se la dice tal cual."
              ejemplo="Puedes cambiar o cancelar tu cita con 24 horas de anticipación."
              tipo="literal"
              vista={ficha.politicaDeCancelacion}
            >
              <Textarea
                autoResize
                rows={2}
                value={ficha.politicaDeCancelacion ?? ""}
                onChange={(e) => set({ politicaDeCancelacion: e.target.value })}
              />
            </Campo>
          ) : null}
        </>
      ),
    },
    {
      titulo: "Cómo te pagan",
      subtitulo: "Estos datos se los dará el asistente a tus clientes tal cual los escribas.",
      contenido: (
        <>
          <Campo
            titulo="¿Qué formas de pago aceptas? Cuéntalo con tus palabras"
            ayuda="Sirve para explicarle al cliente cómo pagar. Las casillas de abajo son las que el asistente usa para decir que sí o que no."
            ejemplo="Transferencia y efectivo; el efectivo solo si recogen en el local."
            tipo="instruccion"
          >
            <ExpandableInput
              autoResize
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
          {ficha.vertical !== "citas" ? (
            <>
              {/*
                Doc 200, caso Sofía (MALIA): con la frase libre "efectivo pero
                solo recogiendo" se llegó a aprobar efectivo contra entrega. Con
                estas casillas, el asistente responde con un dato exacto.
              */}
              <Campo
                titulo="¿Qué aceptas en cada caso?"
                ayuda="Marca lo que aceptas a domicilio y lo que aceptas cuando recogen. Con esto el asistente nunca aprueba un pago que no manejas."
                tipo="instruccion"
              >
                <div className="space-y-2">
                  {(
                    [
                      ["domicilio", "A domicilio"],
                      ["recoger", "Si recogen en el local"],
                    ] as const
                  ).map(([modalidad, rotulo]) => {
                    const marcados = ficha.pago?.porModalidad?.[modalidad] ?? [];
                    return (
                      <div key={modalidad} className="rounded-md border border-border/60 px-3 py-2">
                        <p className="mb-1 text-[13px] font-medium">{rotulo}</p>
                        <div className="flex flex-wrap gap-3">
                          {METODOS.map((m) => {
                            const marcado = marcados.includes(m.valor);
                            return (
                              <label key={m.valor} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  onChange={() => {
                                    const siguiente = marcado
                                      ? marcados.filter((x) => x !== m.valor)
                                      : [...marcados, m.valor];
                                    const base = ficha.pago ?? { formas: "", compruebaUnaPersona: true };
                                    set({
                                      pago: {
                                        ...base,
                                        porModalidad: { ...(base.porModalidad ?? {}), [modalidad]: siguiente },
                                      },
                                    });
                                  }}
                                  className="h-4 w-4 accent-primary"
                                />
                                {m.texto}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Campo>
            </>
          ) : null}
          <Campo
            titulo="Si aceptas transferencia: ¿a qué cuenta y a nombre de quién?"
            ayuda="⚠️ Revísalo con calma: el asistente lo copia tal cual. Un dígito mal es dinero perdido."
            ejemplo="Bancolombia Ahorros 12345678901 — a nombre de María Pérez"
            tipo="literal"
            vista={ficha.pago?.datosDeCuenta}
          >
            <Textarea
              autoResize
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
            <AvisoContenidoMezclado campo="pago.datosDeCuenta" advertencias={advertenciasContenido} />
          </Campo>
          {ficha.vertical !== "citas" ? (
            <Campo
              titulo="¿Cuándo le das los datos de la cuenta al cliente?"
              ayuda="Siempre van en el mensaje final, cuando confirma el pedido. La pregunta es si también se los das antes, si te los pide."
              tipo="instruccion"
            >
              <Opciones
                valor={ficha.pago?.cuentaAntesDeConfirmar ?? "si_la_piden"}
                opciones={[
                  { valor: "si_la_piden", texto: "Si me los pide, se los doy" },
                  { valor: "nunca", texto: "Solo cuando confirme el pedido" },
                ]}
                onChange={(v) =>
                  set({
                    pago: {
                      ...(ficha.pago ?? { formas: "", compruebaUnaPersona: true }),
                      cuentaAntesDeConfirmar: v,
                    },
                  })
                }
              />
            </Campo>
          ) : null}
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
            ayuda="Piensa en cómo hablas tú por WhatsApp: ¿formal o cercano? ¿Usas emojis? ¿Mensajes cortos o más detallados? Esto manda sobre cualquier otra regla de estilo del asistente."
            ejemplo="Cercano y alegre, con emojis, hablando siempre de nosotros."
            tipo="instruccion"
          >
            <Textarea
              autoResize
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
            ayuda="Si lo llenas, el asistente preguntará si es un regalo y pedirá los datos de quien lo recibe."
            ejemplo="Sí, y se puede agregar una tarjeta con mensaje."
            tipo="instruccion"
          >
            <ExpandableInput
              autoResize
              value={ficha.regalos ?? ""}
              onChange={(e) => set({ regalos: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Quieres un saludo propio para quien escribe por primera vez?"
            ayuda="Si lo dejas vacío, usamos uno con el nombre de tu negocio."
            ejemplo="¡Hola! 💗 Bienvenid@ a La Dulce. ¿Qué se te antoja hoy?"
            tipo="literal"
            vista={ficha.saludoInicial}
          >
            <Textarea
              autoResize
              rows={2}
              value={ficha.saludoInicial ?? ""}
              onChange={(e) => set({ saludoInicial: e.target.value })}
            />
          </Campo>
          <Campo
            titulo="¿Quieres que el cliente elija de un menú al escribirte por primera vez?"
            ayuda="En vez de escribir libremente, tu cliente toca una opción. Déjalo vacío si prefieres que el asistente conteste libremente, como hasta ahora."
            ejemplo="Ver menú y precios · Hacer un pedido · Preguntas frecuentes · Hablar con un asesor"
            tipo="literal"
            vista={(ficha.menu?.opciones ?? []).filter((o) => o.trim()).join("\n")}
          >
            <Lista
              valores={ficha.menu?.opciones ?? []}
              marcador="Ej: Hacer un pedido"
              onChange={(v) => set({ menu: { opciones: v } })}
            />
          </Campo>
          <Campo
            titulo="¿Qué dice el asistente cuando le pasa la conversación a tu equipo? (opcional)"
            ayuda="Si lo dejas vacío: «Dame un momentico 🙏 Te comunico con una persona del equipo para ayudarte mejor.»"
            ejemplo="¡Ya te paso con alguien de nuestro equipo! 💗 En un momento te escriben."
            tipo="literal"
            vista={ficha.mensajes?.derivar}
          >
            <ExpandableInput
              autoResize
              value={ficha.mensajes?.derivar ?? ""}
              onChange={(e) => set({ mensajes: { ...(ficha.mensajes ?? {}), derivar: e.target.value } })}
            />
          </Campo>
          <Campo
            titulo="Si responden a una historia o estado tuyo y preguntan por lo que vieron…"
            ayuda="El asistente no puede ver tus historias. Puede contestar con lo que sabe de tu catálogo (y preguntar de qué producto hablan si no está claro), o pasarte la conversación."
            tipo="instruccion"
          >
            <Opciones
              valor={ficha.respuestaAPublicaciones ?? "responder"}
              opciones={[
                { valor: "responder", texto: "Que conteste con lo que sabe" },
                { valor: "pasar_al_equipo", texto: "Que me la pase a mí" },
              ]}
              onChange={(v) => set({ respuestaAPublicaciones: v })}
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
            tipo="instruccion"
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
            tipo="instruccion"
          >
            <Lista
              valores={ficha.nuncaPrometer ?? []}
              marcador="Ej: Una hora exacta de entrega"
              onChange={(v) => set({ nuncaPrometer: v })}
            />
          </Campo>
          <Campo
            titulo="¿Algo más que debamos saber de tu negocio?"
            ayuda="Cualquier regla tuya que no encaje arriba. Estas suelen ser las que más te distinguen, y mandan sobre las reglas generales del asistente."
            ejemplo="Las bebidas solo se venden en el local · El domingo cerramos a las 3"
            tipo="instruccion"
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
      titulo: "Qué necesita tu asistente para cerrar",
      subtitulo:
        "No hay un guion fijo: el asistente tiene la meta de cerrar la venta o la cita y va pidiendo lo que falta, con naturalidad.",
      contenido: (
        <Campo
          titulo="¿Qué datos del cliente son obligatorios?"
          ayuda="Además de lo que pide (y la dirección si es a domicilio, o si es un regalo cuando manejas regalos), el asistente pedirá estos datos antes de cerrar. Los datos de contacto y de entrega los pide juntos, en un solo mensaje. Se guardan en el contacto."
          tipo="instruccion"
        >
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
          <LeyendaDeCampos />
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
          <Button
            type="button"
            onClick={() => void terminar()}
            disabled={guardando || diasSinHora.length > 0}
          >
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
            /*
             * No se avanza con un día marcado sin hora. Guardar el borrador
             * así no rompe nada —es un avance a medias—, pero dejar pasar la
             * etapa hace que la persona se olvide, y al terminar el servidor
             * rechaza con un mensaje que ya no sabe a qué día pertenece.
             */
            disabled={diasSinHora.length > 0}
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
