/** DTOs que viajan por la API interna (lado cliente). */

export type ConversationDto = {
  id: string;
  contact: { id: string; name: string; phone: string };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  preview: string | null;
};

export type MessageDto = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  aiGenerated: boolean;
  /** Trae adjunto descargable en /api/media/{id} (comprobantes, fotos). */
  hasMedia?: boolean;
  mimeType?: string | null;
  createdAt: string;
};

export type TemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: "draft" | "pending" | "approved" | "rejected";
  rejectionReason: string | null;
};

export type StageDto = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

export type ContactDto = {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  archivedAt: string | null;
};

/**
 * Una línea del transcript del Laboratorio.
 *
 * `sistema` no es un mensaje que viera el cliente: es una acción que el agente
 * ejecutó de verdad (escaló, registró el pedido). Sin ella el juez calificaba
 * solo por el texto y no podía distinguir un "ya te contactan" con handoff real
 * de una promesa vacía — marcaba en rojo conversaciones bien resueltas.
 */
export type TranscriptLine = {
  role: "cliente" | "agente" | "sistema";
  text: string;
};
