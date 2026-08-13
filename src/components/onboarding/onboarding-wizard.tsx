"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, PartyPopper } from "lucide-react";
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

export function OnboardingWizard() {
  const [ficha, setFicha] = useState<Ficha>({});
  const [etapa, setEtapa] = useState(0);
  const [cargado, setCargado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [terminado, setTerminado] = useState(false);
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
          <Campo
            titulo="Tus productos con su precio, uno por línea"
            ayuda="Si tienes el menú en PDF o foto, mándanoslo y lo cargamos nosotros."
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

  // El catálogo escrito a mano no aplica al vertical de citas: ahí los
  // servicios se cargan con sus duraciones desde la pantalla de Servicios.
  const visibles = etapas.filter(
    (e) => !(ficha.vertical === "citas" && e.titulo === "Lo que vendes")
  );
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

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={etapa === 0}
          onClick={() => setEtapa((e) => e - 1)}
        >
          <ArrowLeft className="h-4 w-4" /> Atrás
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
