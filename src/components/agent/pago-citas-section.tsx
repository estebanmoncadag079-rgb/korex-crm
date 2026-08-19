"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "¿Este negocio cobra por adelantado al confirmar una cita?" — solo la
 * interfaz para editar `ficha.cierre.pagoAntesDeLaCita`
 * (docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md).
 *
 * Solo aplica a citas: la API dice `aplica: false` en pedidos (y cuando no
 * hay ficha) y esta pantalla no se muestra. Un solo interruptor, sin botón
 * "Guardar" aparte — se guarda al cambiarlo, igual que el encendido del
 * agente arriba de esta misma pantalla.
 */
export function PagoCitasSection() {
  const [aplica, setAplica] = useState(false);
  const [sinFicha, setSinFicha] = useState(true);
  const [antes, setAntes] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/agent/pago-citas").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!r) return;
    setAplica(r.aplica);
    setSinFicha(r.sinFicha);
    setAntes(r.antes);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function guardar(valor: boolean) {
    const anterior = antes;
    setAntes(valor);
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/agent/pago-citas", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ antes: valor }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      setAntes(anterior);
      setError("No se pudo guardar.");
      return;
    }
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2000);
  }

  if (sinFicha || !aplica) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pago al confirmar una cita</CardTitle>
        <CardDescription>
          Decide si el agente pide el pago por adelantado al agendar, o si la
          conversación termina en la confirmación sin mencionarlo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={antes}
            disabled={guardando}
            onChange={(e) => void guardar(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Pedir el pago por adelantado (con los datos de la cuenta que ya
          tienes configurados) para dejar la cita en firme.
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {guardado && <span className="text-xs text-primary">Guardado ✓</span>}
      </CardContent>
    </Card>
  );
}
