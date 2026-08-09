"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cerrar la venta a mano, desde la propia conversación (9-ago-2026).
 *
 * El embudo se cierra solo cuando el agente confirma un pedido o cuando entra
 * un comprobante de pago. Nada de eso cubre lo que se cobra en efectivo o se
 * acuerda por fuera del chat, y hasta hoy la única salida era ir al tablero,
 * buscar la tarjeta entre decenas y arrastrarla.
 *
 * El estado no se persiste en el DTO a propósito: `onLeadWon` ya ignora al lead
 * que estaba ganado, así que pulsar de más no hace daño y la conversación no
 * necesita cargar el embudo entero para pintar un botón.
 */
export function MarcarCliente({
  onMarcar,
}: {
  onMarcar: () => Promise<void>;
}) {
  const [estado, setEstado] = useState<"listo" | "guardando" | "hecho">("listo");

  async function marcar() {
    if (estado !== "listo") return;
    setEstado("guardando");
    try {
      await onMarcar();
      setEstado("hecho");
      window.setTimeout(() => setEstado("listo"), 2500);
    } catch {
      setEstado("listo");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void marcar()}
      disabled={estado !== "listo"}
      title="Pasar este contacto a la columna de clientes del embudo."
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        estado === "hecho"
          ? "border-success/30 bg-success/10 text-success"
          : "border-border text-text-3 hover:bg-accent hover:text-foreground"
      )}
    >
      <Trophy className="h-3.5 w-3.5" strokeWidth={1.7} />
      <span className="hidden sm:inline">
        {estado === "hecho"
          ? "Es cliente"
          : estado === "guardando"
            ? "Guardando…"
            : "Marcar cliente"}
      </span>
    </button>
  );
}
