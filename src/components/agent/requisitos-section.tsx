"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * "Datos que deben solicitarse antes de confirmar" — solo la interfaz para
 * editar `ficha.cierre.requisitos` (docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md).
 *
 * Ninguna lógica de negocio vive aquí: el catálogo de opciones lo fija el
 * servidor (`REQUISITOS_DISPONIBLES`, en `ficha.ts`), este componente solo
 * marca/desmarca y manda la lista de ids. Qué se exige y cuándo lo decide
 * `requisitosDe()` y el guardarraíl del pipeline — nunca esta pantalla.
 */

type Disponible = { id: string; etiqueta: string };

export function RequisitosSection() {
  const [disponibles, setDisponibles] = useState<Disponible[]>([]);
  const [obligatorios, setObligatorios] = useState<Set<string>>(new Set());
  const [sinFicha, setSinFicha] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/agent/requisitos").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!r) return;
    setDisponibles(r.disponibles);
    setObligatorios(new Set(r.obligatorios));
    setSinFicha(r.sinFicha);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function toggle(id: string) {
    setObligatorios((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/agent/requisitos", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ obligatorios: [...obligatorios] }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      setError("No se pudo guardar.");
      return;
    }
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2000);
  }

  if (sinFicha) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos que deben solicitarse antes de confirmar</CardTitle>
        <CardDescription>
          El agente pedirá estos datos —si el cliente no los ha dado— antes de
          cerrar un pedido o una cita. Se guardan en el contacto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {disponibles.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={obligatorios.has(r.id)}
                onChange={() => toggle(r.id)}
                className="h-4 w-4 accent-primary"
              />
              Solicitar {r.etiqueta}.
            </label>
          ))}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={guardando} onClick={() => void guardar()}>
            Guardar
          </Button>
          {guardado && <span className="text-xs text-primary">Guardado ✓</span>}
        </div>
      </CardContent>
    </Card>
  );
}
