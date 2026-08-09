"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import type { MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { MessageThread } from "@/components/inbox/message-thread";
import type { BoardLead } from "./pipeline-client";

/**
 * La conversación de una tarjeta, sin salir del tablero.
 *
 * Antes el botón de la tarjeta era un enlace a la bandeja: para comparar dos
 * clientes había que ir, volver y buscar de nuevo la tarjeta. Aquí el hilo se
 * abre al lado y cambiar de cliente es un clic.
 *
 * Es **solo lectura a propósito**: responder arrastra el compositor, el relevo
 * del agente y la ventana de 24 h, que es justo la lógica delicada del inbox.
 * Para escribir está el enlace a la bandeja, donde eso ya funciona y está
 * probado.
 */

/** Cada cuánto se releen los mensajes mientras el panel está abierto. */
const REFRESCO_MS = 6000;

export function ConversationPreview({
  lead,
  onClose,
}: {
  lead: BoardLead;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  const conversationId = lead.conversationId;

  const cargar = useCallback(async () => {
    if (!conversationId) return;
    const res = await fetch(`/api/conversations/${conversationId}/messages`).catch(
      () => null
    );
    if (!res?.ok) {
      setError(true);
      setCargando(false);
      return;
    }
    const data = (await res.json()) as { messages: MessageDto[] };
    setMessages(data.messages);
    setError(false);
    setCargando(false);
  }, [conversationId]);

  /*
   * Al cambiar de tarjeta se vacía el hilo antes de pedir el nuevo: si no, se
   * quedan un instante los mensajes del cliente anterior bajo el nombre del
   * nuevo, que es la peor manera posible de equivocarse en un CRM.
   */
  useEffect(() => {
    setMessages([]);
    setCargando(true);
    setError(false);
    void cargar();
  }, [cargar]);

  /*
   * Refresco mientras el panel está abierto, para que una conversación viva se
   * vea moverse. Se detiene con la pestaña en segundo plano: el servidor tiene
   * un solo núcleo y nadie está mirando.
   */
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) void cargar();
    }, REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  return (
    <aside
      className={cn(
        "flex flex-col border-l bg-card",
        // En un teléfono no caben tablero y panel a la vez: ahí se abre encima,
        // a pantalla completa. Desde tablet convive con las columnas.
        "fixed inset-0 z-40 md:static md:z-auto",
        "md:w-[21rem] md:shrink-0 lg:w-[26rem]"
      )}
    >
      <header className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.contact.name}</p>
          {lead.contact.phone && (
            <p className="truncate text-[11px] text-muted-foreground">
              {lead.contact.phone}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label="Cerrar conversación"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {cargando && (
        <p className="p-4 text-sm text-muted-foreground">Cargando conversación…</p>
      )}
      {!cargando && error && (
        <p className="p-4 text-sm text-muted-foreground">
          No se pudo cargar la conversación.
        </p>
      )}
      {!cargando && !error && messages.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">
          Esta conversación todavía no tiene mensajes.
        </p>
      )}
      {!cargando && !error && messages.length > 0 && (
        <MessageThread messages={messages} />
      )}

      <footer className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-[11px] text-muted-foreground">Solo lectura</span>
        <Link
          href={`/inbox?contact=${lead.contact.id}`}
          className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Responder en Bandeja <ExternalLink className="h-3 w-3" />
        </Link>
      </footer>
    </aside>
  );
}
