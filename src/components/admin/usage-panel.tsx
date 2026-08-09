"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Cuánto cuesta cada cliente este mes.
 *
 * La agencia cobra mensualidades fijas, así que el margen depende de un dato
 * que antes no existía en ninguna pantalla. Todo va en dólares, que es la
 * moneda en la que se paga a los proveedores y en la que llegan los importes:
 * convertir a pesos con una tasa fija daba una cifra que envejecía sola y que
 * no cuadraba con ninguna factura.
 */

type Fila = {
  organizationId: string;
  nombre: string;
  llamadasIa: number;
  tokensIn: number;
  tokensOut: number;
  costoIaUsd: number;
  mensajes: number;
  costoWhatsappUsd: number;
  totalUsd: number;
};

type Datos = {
  desde: string;
  filas: Fila[];
  total: {
    costoIaUsd: number;
    costoWhatsappUsd: number;
    totalUsd: number;
    mensajes: number;
    llamadasIa: number;
  };
};

function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Lo que cuesta UNA llamada al modelo.
 *
 * Es la cifra que hay que vigilar, y no la del mes: el total sube porque hay
 * más tráfico —eso es bueno— o porque cada llamada se encareció —eso es un
 * problema—, y solo este cociente distingue una cosa de la otra. Sube cuando
 * crece el prompt del sistema, que se manda entero en cada turno y domina el
 * costo, o cuando aparecen llamadas más caras (transcribir audios, reintentos).
 *
 * Cinco decimales porque lo que se vigila son movimientos pequeños: Lis pasó
 * de 0,00202 a 0,00288 —un 43 % más— y con menos resolución ese desvío avanza
 * a saltos en vez de verse venir.
 *
 * Sin llamadas se muestra una raya, no "$0": no gastó nada porque no hubo
 * tráfico, que no es lo mismo que atender gratis.
 */
function usdPorLlamada(costoUsd: number, llamadas: number): string {
  if (llamadas === 0) return "—";
  return `$${(costoUsd / llamadas).toFixed(5)}`;
}

export function UsagePanel() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/admin/usage").catch(() => null);
    if (res?.ok) setDatos((await res.json()) as Datos);
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) {
    return <p className="text-sm text-muted-foreground">Cargando consumo…</p>;
  }
  if (!datos) return null;

  const mes = new Date(datos.desde).toLocaleDateString("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumo de {mes}</CardTitle>
        <CardDescription>
          Lo que llevan gastado los clientes este mes en IA y en mensajes de
          WhatsApp. Se anota cada llamada al modelo y cada mensaje enviado, con
          el costo exacto que informa el proveedor. La columna que conviene
          vigilar es <strong className="text-foreground">Costo por llamada</strong>:
          el total sube también cuando hay más clientes, pero si sube el costo
          unitario es que algo se encareció.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/*
         * Siete columnas no caben en un teléfono. La tabla se desplaza dentro
         * de su caja (nunca la página entera) y `min-w` le impide encogerse
         * hasta partir cada cifra en dos líneas.
         */}
        <p className="mb-2 text-xs text-muted-foreground md:hidden">
          Desliza la tabla para ver todas las columnas.
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Cliente</th>
                <th className="whitespace-nowrap pb-2 pr-4 text-right font-medium">
                  Respuestas IA
                </th>
                <th className="whitespace-nowrap pb-2 pr-4 text-right font-medium">
                  Costo IA
                </th>
                <th className="whitespace-nowrap pb-2 pr-4 text-right font-medium">
                  Costo por llamada
                </th>
                <th className="pb-2 pr-4 text-right font-medium">Mensajes</th>
                <th className="whitespace-nowrap pb-2 pr-4 text-right font-medium">
                  Costo WhatsApp
                </th>
                <th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((f) => (
                <tr key={f.organizationId} className="border-b last:border-0">
                  <td className="py-2 pr-4">{f.nombre}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {f.llamadasIa.toLocaleString("es-CO")}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {usd(f.costoIaUsd)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {usdPorLlamada(f.costoIaUsd, f.llamadasIa)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {f.mensajes.toLocaleString("es-CO")}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {usd(f.costoWhatsappUsd)}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {usd(f.totalUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="pt-2 pr-4 font-medium">Total</td>
                <td className="pt-2 pr-4 text-right tabular-nums">
                  {datos.total.llamadasIa.toLocaleString("es-CO")}
                </td>
                <td className="pt-2 pr-4 text-right tabular-nums">
                  {usd(datos.total.costoIaUsd)}
                </td>
                {/*
                 * Promedio ponderado (gasto total ÷ llamadas totales), no la
                 * media de las columnas: así un cliente con cuatro llamadas no
                 * pesa lo mismo que uno con trescientas.
                 */}
                <td className="pt-2 pr-4 text-right tabular-nums">
                  {usdPorLlamada(datos.total.costoIaUsd, datos.total.llamadasIa)}
                </td>
                <td className="pt-2 pr-4 text-right tabular-nums">
                  {datos.total.mensajes.toLocaleString("es-CO")}
                </td>
                <td className="pt-2 pr-4 text-right tabular-nums">
                  {usd(datos.total.costoWhatsappUsd)}
                </td>
                <td className="pt-2 text-right font-semibold tabular-nums">
                  {usd(datos.total.totalUsd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {datos.total.costoWhatsappUsd === 0 && datos.total.mensajes > 0 && (
          <p className="mt-4 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">
              Los mensajes de WhatsApp aún no cuestan nada
            </strong>{" "}
            porque las respuestas dentro de la ventana de 24 h son gratuitas.
            Desde el <strong className="text-foreground">1 de octubre de 2026</strong>{" "}
            Meta empieza a cobrarlos todos: los {datos.total.mensajes.toLocaleString("es-CO")}{" "}
            mensajes de este mes rondarían los{" "}
            <strong className="text-foreground">
              {usd(datos.total.mensajes * 0.0008)}
            </strong>{" "}
            a la tarifa estimada de 0,0008 USD por mensaje. Se cuentan desde ya
            para que esa factura no sea una sorpresa.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
