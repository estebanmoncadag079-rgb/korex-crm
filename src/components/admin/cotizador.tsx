"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COSTO_PERSONA_MES_COP,
  COSTO_RESPUESTA_IA_USD,
  TARIFA_MARKETING_USD,
  TARIFA_MENSAJE_USD,
  conversacionesDeEquilibrio,
  cotizar,
  margenDe,
  precioParaMargen,
  type EntradasCotizacion,
} from "@/lib/cotizador";

/**
 * Calculadora para cotizar un cliente nuevo.
 *
 * La pregunta que resuelve: "un negocio me dice que le escriben 30 personas al
 * día, ¿cuánto le cobro?". Antes se respondía con una tabla fija de planes, y
 * esa tabla escondía el error de fondo: **el costo no depende de cuántas
 * conversaciones hay, sino de cuántos mensajes toma cerrar una venta**. Un
 * negocio que cierra en 8 y otro que necesita 20 cuestan el doble uno del otro
 * con el mismo número de clientes.
 *
 * Por eso los mensajes por conversación son un campo, no una constante.
 */

const usd = (n: number) => `$${n.toFixed(2)}`;
const cop = (n: number) =>
  n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
const pct = (n: number) => `${(n * 100).toFixed(0)} %`;

/** Lee un campo numérico sin pelear con el usuario mientras escribe. */
function useNumero(inicial: number) {
  const [texto, setTexto] = useState(String(inicial));
  const valor = Number(texto.replace(",", ".")) || 0;
  return { texto, setTexto, valor };
}

function Campo(props: {
  etiqueta: string;
  ayuda?: string;
  texto: string;
  onChange: (v: string) => void;
  sufijo?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{props.etiqueta}</Label>
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          value={props.texto}
          onChange={(e) => props.onChange(e.target.value)}
          className="h-9"
        />
        {props.sufijo && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {props.sufijo}
          </span>
        )}
      </div>
      {props.ayuda && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {props.ayuda}
        </p>
      )}
    </div>
  );
}

function Linea(props: { concepto: string; detalle?: string; usd: number; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <span className={props.fuerte ? "font-medium" : ""}>{props.concepto}</span>
        {props.detalle && (
          <span className="ml-2 text-xs text-muted-foreground">{props.detalle}</span>
        )}
      </div>
      <span
        className={`shrink-0 tabular-nums ${props.fuerte ? "font-semibold" : ""}`}
      >
        {usd(props.usd)}
      </span>
    </div>
  );
}

export function Cotizador() {
  const conversacionesDia = useNumero(30);
  const msgBot = useNumero(8);
  const msgPersona = useNumero(0);
  const campanas = useNumero(0);
  const contactos = useNumero(1000);
  const vps = useNumero(30);
  const clientesVps = useNumero(5);
  const trm = useNumero(3206);
  const precio = useNumero(600000);

  const tarifaIa = useNumero(COSTO_RESPUESTA_IA_USD);
  const tarifaMsg = useNumero(TARIFA_MENSAJE_USD);
  const tarifaMkt = useNumero(TARIFA_MARKETING_USD);
  const [avanzado, setAvanzado] = useState(false);

  const entradas: EntradasCotizacion = useMemo(
    () => ({
      conversacionesMes: conversacionesDia.valor * 30,
      mensajesBotPorConversacion: msgBot.valor,
      mensajesPersonaPorConversacion: msgPersona.valor,
      campanasPorMes: campanas.valor,
      contactosPorCampana: contactos.valor,
      costoVpsUsd: vps.valor,
      clientesEnVps: clientesVps.valor,
      trm: trm.valor,
      costoRespuestaIaUsd: tarifaIa.valor,
      tarifaMensajeUsd: tarifaMsg.valor,
      tarifaMarketingUsd: tarifaMkt.valor,
    }),
    [
      conversacionesDia.valor, msgBot.valor, msgPersona.valor, campanas.valor,
      contactos.valor, vps.valor, clientesVps.valor, trm.valor,
      tarifaIa.valor, tarifaMsg.valor, tarifaMkt.valor,
    ]
  );

  const r = useMemo(() => cotizar(entradas), [entradas]);
  const precioUsd = trm.valor > 0 ? precio.valor / trm.valor : 0;
  const margen = margenDe(precioUsd, r.costoTotalUsd);
  const equilibrio = conversacionesDeEquilibrio(precioUsd, entradas);
  const personaMes = COSTO_PERSONA_MES_COP;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cotizador</CardTitle>
        <CardDescription>
          Lo que cuesta atender a un cliente y lo que deja cobrarle. El número
          que más manda no es cuántas conversaciones tiene, sino{" "}
          <strong className="text-foreground">
            cuántos mensajes le toma cerrar una venta
          </strong>
          : un negocio que cierra en 8 y otro que necesita 20 cuestan el doble
          uno del otro con el mismo número de clientes.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---------------- ENTRADAS ---------------- */}
          <div className="space-y-4">
            <div>
              <h4 className="mb-3 text-sm font-medium">El negocio del cliente</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Conversaciones al día"
                  ayuda="Personas distintas que le escriben. Usa su DÍA MÁS PESADO, no el promedio."
                  texto={conversacionesDia.texto}
                  onChange={conversacionesDia.setTexto}
                />
                <Campo
                  etiqueta="Mensajes que manda el bot"
                  ayuda="Por conversación. Es lo que más pesa en el costo."
                  texto={msgBot.texto}
                  onChange={msgBot.setTexto}
                />
                <Campo
                  etiqueta="Mensajes que manda una persona"
                  ayuda="Por conversación. Cuestan WhatsApp, no IA."
                  texto={msgPersona.texto}
                  onChange={msgPersona.setTexto}
                />
                <Campo
                  etiqueta="Campañas al mes"
                  ayuda="Envíos masivos de promoción. Cobrar SIEMPRE aparte."
                  texto={campanas.texto}
                  onChange={campanas.setTexto}
                />
                {campanas.valor > 0 && (
                  <Campo
                    etiqueta="Contactos por campaña"
                    texto={contactos.texto}
                    onChange={contactos.setTexto}
                  />
                )}
              </div>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-medium">Tu operación</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Servidor al mes"
                  sufijo="USD"
                  texto={vps.texto}
                  onChange={vps.setTexto}
                />
                <Campo
                  etiqueta="Clientes en el servidor"
                  ayuda="El fijo se reparte entre todos: con pocos, pesa mucho."
                  texto={clientesVps.texto}
                  onChange={clientesVps.setTexto}
                />
                <Campo
                  etiqueta="TRM"
                  sufijo="COP/USD"
                  texto={trm.texto}
                  onChange={trm.setTexto}
                />
                <Campo
                  etiqueta="Lo que piensas cobrar"
                  sufijo="COP"
                  texto={precio.texto}
                  onChange={precio.setTexto}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAvanzado((v) => !v)}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {avanzado ? "Ocultar" : "Ver"} tarifas de los proveedores
            </button>
            {avanzado && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
                <Campo
                  etiqueta="IA por respuesta"
                  sufijo="USD"
                  ayuda="Medido en producción."
                  texto={tarifaIa.texto}
                  onChange={tarifaIa.setTexto}
                />
                <Campo
                  etiqueta="WhatsApp por mensaje"
                  sufijo="USD"
                  ayuda="Meta, desde el 1-oct-2026."
                  texto={tarifaMsg.texto}
                  onChange={tarifaMsg.setTexto}
                />
                <Campo
                  etiqueta="Marketing por mensaje"
                  sufijo="USD"
                  ayuda="15 veces más caro."
                  texto={tarifaMkt.texto}
                  onChange={tarifaMkt.setTexto}
                />
              </div>
            )}
          </div>

          {/* ---------------- RESULTADO ---------------- */}
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <h4 className="mb-2 text-sm font-medium">Lo que te cuesta al mes</h4>
              <div className="divide-y text-sm">
                <Linea
                  concepto="IA"
                  detalle={`${cop(r.respuestasIa)} respuestas`}
                  usd={r.costoIaUsd}
                />
                <Linea
                  concepto="WhatsApp"
                  detalle={`${cop(r.mensajesSalientes)} mensajes`}
                  usd={r.costoWhatsappUsd}
                />
                {r.costoMarketingUsd > 0 && (
                  <Linea
                    concepto="Marketing"
                    detalle={`${cop(r.mensajesMarketing)} envíos`}
                    usd={r.costoMarketingUsd}
                  />
                )}
                <Linea
                  concepto="Servidor"
                  detalle={`1 de ${cop(clientesVps.valor)}`}
                  usd={r.costoServidorUsd}
                />
                <Linea concepto="Total" usd={r.costoTotalUsd} fuerte />
              </div>
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                <strong className="text-foreground">{cop(r.costoTotalCop)} COP</strong>{" "}
                al mes ·{" "}
                <strong className="text-foreground">
                  {cop(r.costoPorConversacionUsd * trm.valor)} COP
                </strong>{" "}
                por conversación
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <h4 className="mb-3 text-sm font-medium">Si cobras {cop(precio.valor)} COP</h4>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Te queda
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {cop((precioUsd - r.costoTotalUsd) * trm.valor)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {usd(precioUsd - r.costoTotalUsd)}
                  </p>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Margen
                  </p>
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      margen < 0.5 ? "text-destructive" : ""
                    }`}
                  >
                    {pct(margen)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {margen < 0.5 ? "muy justo" : "sano"}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Con ese precio dejas de ganar a partir de{" "}
                <strong className="text-foreground">
                  {Number.isFinite(equilibrio)
                    ? `${cop(equilibrio)} conversaciones al mes (${cop(equilibrio / 30)} al día)`
                    : "cualquier volumen"}
                </strong>
                . Pon el tope del plan bastante por debajo: el mes que tenga un
                pico no se puede acabar el margen.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <h4 className="mb-2 text-sm font-medium">Precios de referencia</h4>
              <div className="space-y-1.5 text-sm">
                {[0.8, 0.85, 0.9].map((m) => (
                  <div key={m} className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      Margen del {pct(m)}
                    </span>
                    <span className="tabular-nums">
                      {cop(precioParaMargen(r.costoTotalUsd, m) * trm.valor)} COP
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                <strong className="text-foreground">
                  No pongas el precio por aquí.
                </strong>{" "}
                El cliente no compra tokens, compra que alguien conteste a las
                once de la noche. Una persona a jornada completa le cuesta{" "}
                <strong className="text-foreground">{cop(personaMes)} COP</strong>{" "}
                al mes y media jornada {cop(personaMes / 2)}. Tu precio se
                defiende contra eso — esta tabla solo te dice hasta dónde puedes
                bajar sin perder.
              </p>
            </div>

            {r.costoPorMensajeExtraUsd > 0 && (
              <p className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                <strong>Si el negocio necesitara un mensaje más</strong> en cada
                conversación, tu costo subiría{" "}
                <strong>{cop(r.costoPorMensajeExtraUsd * trm.valor)} COP</strong>{" "}
                al mes. Por eso conviene preguntarle cuántos mensajes le toma
                cerrar una venta antes de dar un número.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
