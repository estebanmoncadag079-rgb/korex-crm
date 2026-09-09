"use client";

import { Sparkles, UserRound } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { modoDeAtencion } from "./helpers";

/**
 * Quién está atendiendo esta conversación, a la vista y de un clic.
 *
 * El interruptor ya existía, pero vivía en el panel lateral de detalles: si el
 * panel estaba cerrado no había forma de saber si el agente seguía respondiendo
 * — y el caso más común (alguien contesta desde el celular del negocio y el
 * agente calla dos horas) pasaba desapercibido.
 *
 * Pasar a humano aquí NO caduca: a diferencia del relevo automático, que se
 * devuelve solo a las dos horas, esto es una decisión del supervisor y se
 * mantiene hasta que la revierta.
 */

const MOTIVOS: Record<string, string> = {
  cliente: "el cliente pidió un humano",
  modelo: "el agente decidió escalar",
  operador: "alguien escribió desde el celular del negocio",
  error: "falló el proveedor de IA",
  ventana: "la ventana de 24 h está cerrada",
};

export function ModoAtencion({
  conversation,
  agentReady,
  onPatch,
}: {
  conversation: ConversationDto;
  /** El agente está configurado y encendido a nivel del negocio. */
  agentReady: boolean;
  onPatch: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<void>;
}) {
  /**
   * La MISMA regla que pinta la insignia de la bandeja (`helpers.ts`), no una
   * copia: si el chat y la lista pudieran discrepar sobre quién atiende, el
   * indicador haría más daño que no tenerlo.
   */
  const modo = modoDeAtencion(conversation, agentReady);
  const enIa = modo === "ia";

  if (modo === "apagado") {
    return (
      <span
        title="El agente está apagado para todo el negocio. Actívalo en Agente."
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[12px] text-text-3"
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
        Agente apagado
      </span>
    );
  }

  const motivo = conversation.handoffReason
    ? MOTIVOS[conversation.handoffReason]
    : null;

  return (
    <button
      type="button"
      onClick={() => {
        // Volver a la IA limpia también el relevo; pasar a humano solo apaga.
        void onPatch(enIa ? { aiEnabled: false } : { reactivate: true });
      }}
      title={
        enIa
          ? "Responde la IA. Pulsa para pasar la conversación a una persona."
          : `Atiende una persona${motivo ? ` (${motivo})` : ""}. Pulsa para devolvérsela a la IA.`
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        enIa
          ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
          : "border-[#ece2cf] bg-[#faf7f0] text-[#8a6d3b] hover:bg-[#f3ead8]"
      )}
    >
      {enIa ? (
        <>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          IA
        </>
      ) : (
        <>
          <UserRound className="h-3.5 w-3.5" strokeWidth={1.7} />
          Humano
        </>
      )}
    </button>
  );
}
