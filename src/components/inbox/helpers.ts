/** Utilidades de presentación de la bandeja. */

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  template: "Plantilla",
};

export function mediaLabel(type: string): string {
  return MEDIA_LABELS[type] ?? "Contenido";
}

export function previewText(preview: string | null): string {
  if (!preview) return "";
  return MEDIA_LABELS[preview] ? `📎 ${MEDIA_LABELS[preview]}` : preview;
}

/**
 * Quién atiende esta conversación, para verlo SIN abrirla.
 *
 * Nace de un incidente real (MALIA, 8-sep-2026): una clienta esperó 14 minutos
 * mientras escribía cinco veces. La conversación estaba en manos de una persona
 * y nadie de la bandeja lo notó, porque desde la lista las dos se ven igual.
 *
 * El criterio es EL MISMO que usa `modo-atencion.tsx` en la cabecera del chat
 * —`agentReady && aiEnabled && !handoffAt`—, escrito una sola vez aquí y
 * compartido: si la lista y el chat pudieran discrepar, el indicador haría más
 * daño que no tenerlo.
 *
 * Cubre el caso que hoy no se ve: `aiEnabled: false` **sin** relevo. Pasó con
 * Carol —`handoff_at` en null y el interruptor apagado— y la lista no mostraba
 * nada, así que el equipo daba por hecho que la IA seguía atendiendo mientras
 * estaba muda.
 */
export type ModoDeAtencion = "ia" | "humano" | "apagado";

export function modoDeAtencion(
  c: { aiEnabled: boolean; handoffAt: string | null },
  agentReady: boolean
): ModoDeAtencion {
  if (!agentReady) return "apagado";
  return c.aiEnabled && !c.handoffAt ? "ia" : "humano";
}
