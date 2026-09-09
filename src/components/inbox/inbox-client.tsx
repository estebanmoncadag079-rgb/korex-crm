"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, PanelRight } from "lucide-react";
import { cn, formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { useEvents } from "@/components/use-events";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";
import { ModoAtencion } from "./modo-atencion";
import { MarcarCliente } from "./marcar-cliente";

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  /*
   * En móvil los detalles no son una columna sino una hoja que se pide y se
   * cierra. Es un estado aparte del de escritorio a propósito: `panelOpen` es
   * una preferencia guardada del puesto de trabajo y cerrar la hoja del
   * teléfono no debe apagarle a nadie la columna del escritorio.
   */
  const [detallesAbiertos, setDetallesAbiertos] = useState(false);
  // Se incrementa con cada evento SSE que puede cambiar la etapa/lead o el
  // estado del agente: el panel de detalles lo observa y refetch en vivo.
  const [detailRev, setDetailRev] = useState(0);
  // El indicador de la cabecera necesita saber si el agente está encendido
  // para el negocio: sin esto diría "IA" en una conversación que nadie atiende.
  const [agentReady, setAgentReady] = useState(false);

  useEffect(() => {
    setPanelOpen(localStorage.getItem("vocero.panelOpen") !== "false");
  }, []);

  // Se refresca con el SSE: si alguien apaga el agente desde otra pestaña, el
  // indicador de la cabecera no puede quedarse mintiendo.
  useEffect(() => {
    let vivo = true;
    void fetch("/api/agent/profile")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        if (vivo) {
          setAgentReady(
            Boolean(data?.aiConfigured) && Boolean(data?.profile?.enabled)
          );
        }
      });
    return () => {
      vivo = false;
    };
  }, [detailRev]);

  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem("vocero.panelOpen", String(open));
  }, []);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const lastFetchRef = useRef<string | null>(null);

  const refetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { conversations: ConversationDto[] };
    setConversations(data.conversations);
    lastFetchRef.current = new Date().toISOString();
  }, []);

  const refetchMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(
      `/api/conversations/${conversationId}/messages`
    ).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: MessageDto[] };
    if (selectedIdRef.current === conversationId) setMessages(data.messages);
  }, []);

  useEffect(() => {
    void refetchConversations();
  }, [refetchConversations]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMessages([]);
      // Cada conversación se abre en su hilo, nunca en la hoja de detalles
      // que quedó abierta de la anterior.
      setDetallesAbiertos(false);
      void refetchMessages(id);
      void fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      });
    },
    [refetchMessages]
  );

  // Enlace directo desde Contactos/Pipeline: /inbox?contact=<id>
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  useEffect(() => {
    if (!contactParam || selectedIdRef.current) return;
    const match = conversations?.find((c) => c.contact.id === contactParam);
    if (match) select(match.id);
  }, [contactParam, conversations, select]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        const m = message as MessageDto;
        setMessages((prev) =>
          prev.some((x) => x.id === m.id) ? prev : [...prev, m]
        );
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
      void refetchConversations();
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageStatus: ({ conversationId, messageId, status }) => {
      if (selectedIdRef.current !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: status as MessageDto["status"] } : m
        )
      );
    },
    onConversationUpdated: () => {
      void refetchConversations();
      // El agente movió de etapa o cambió el handoff: refresca el panel en vivo.
      setDetailRev((v) => v + 1);
    },
    onReconnect: () => {
      // Catch-up tras reconexión (contrato sse.md): refetch completo.
      void refetchConversations();
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      setDetailRev((v) => v + 1);
    },
  });

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  const sendText = useCallback(
    async (text: string): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar el mensaje";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      return null;
    },
    [refetchMessages, refetchConversations]
  );

  const patchConversation = useCallback(
    async (patch: {
      aiEnabled?: boolean;
      reactivate?: boolean;
      markWon?: boolean;
    }) => {
      if (!selectedIdRef.current) return;
      await fetch(`/api/conversations/${selectedIdRef.current}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      void refetchConversations();
    },
    [refetchConversations]
  );

  return (
    <div className="flex h-full">
      {/*
        En un teléfono la lista y el hilo no caben a la vez, así que se turnan:
        con una conversación abierta la lista se retira y la flecha de la
        cabecera la trae de vuelta. De `md` en adelante conviven como siempre;
        entre `md` y `lg` la lista cede 60px para que al hilo le quede un ancho
        con el que se pueda leer.
      */}
      <section
        className={cn(
          "w-full shrink-0 overflow-hidden md:block md:w-[300px] md:border-r lg:w-[360px]",
          selectedId && "hidden"
        )}
      >
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={select}
          onSeeded={() => void refetchConversations()}
          agentReady={agentReady}
        />
      </section>

      <section
        className={cn(
          "min-w-0 flex-1 flex-col md:flex",
          selectedId ? "flex" : "hidden"
        )}
      >
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-2 border-b bg-background px-2 py-2 md:px-4 md:py-2.5">
              <div className="flex min-w-0 items-center gap-2 md:gap-3">
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setDetallesAbiertos(false);
                  }}
                  aria-label="Volver a la lista"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-text-2 transition-colors hover:bg-accent hover:text-foreground md:hidden"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={1.7} />
                </button>
                {/* El avatar es identidad de apoyo: en móvil el ancho vale más
                    para el nombre y el estado de la ventana. */}
                <span className="hidden md:block">
                  <ContactAvatar
                    name={selected.contact.name}
                    seed={selected.contact.id}
                    size="md"
                  />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-[650] leading-tight">
                    {selected.contact.name}
                  </p>
                  <p
                    className={
                      selected.windowOpen
                        ? "truncate text-xs font-medium text-success"
                        : "truncate text-xs text-text-3"
                    }
                  >
                    {selected.windowOpen
                      ? "ventana abierta"
                      : formatPhone(selected.contact.phone)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 md:gap-2">
                <ModoAtencion
                  conversation={selected}
                  agentReady={agentReady}
                  onPatch={patchConversation}
                />
                <MarcarCliente
                  onMarcar={() => patchConversation({ markWon: true })}
                />
                {/* Escritorio ancho: reabre la columna que el operador plegó. */}
                {!panelOpen && (
                  <button
                    onClick={() => togglePanel(true)}
                    aria-label="Mostrar detalles"
                    className="hidden rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground lg:block"
                  >
                    <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                )}
                {/* Pantallas estrechas: los detalles están a un toque. */}
                <button
                  onClick={() => setDetallesAbiertos(true)}
                  aria-label="Ver detalles del contacto"
                  className="flex h-10 w-10 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-accent hover:text-foreground lg:hidden"
                >
                  <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </button>
              </div>
            </header>
            <MessageThread messages={messages} />
            <Composer
              conversation={selected}
              onSend={sendText}
              onSent={() => {
                if (selectedIdRef.current)
                  void refetchMessages(selectedIdRef.current);
                void refetchConversations();
              }}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat text-sm text-text-3">
            Elige una conversación para ver el hilo
          </div>
        )}
      </section>

      {/*
        Un solo panel con dos formas: hoja a pantalla completa cuando la
        pantalla es estrecha (solo si se pide) y tercera columna plegable
        cuando hay sitio. Se evita montarlo dos veces para no duplicar sus
        peticiones al abrirlo.

        El corte aquí es `lg` y no `md` a propósito: tres columnas fijas
        (menú + lista + detalles) dejaban al hilo unos 90px en una tableta o
        en una ventana a media pantalla. Por debajo de 1024px los detalles se
        piden y se cierran; por encima siguen siendo la columna de siempre.
      */}
      <section
        className={cn(
          "overflow-hidden border-l bg-background",
          // Aquí vivía una duración a medida de 220 ms que nunca llegó a
          // aplicarse: con el plugin `tailwindcss-animate`, un valor arbitrario
          // de duración es ambiguo (transición o animación) y Tailwind lo
          // descarta avisando al compilar. El plegado siempre ha usado los
          // 150 ms por defecto de `transition-*`, y así se queda.
          "lg:block lg:shrink-0 lg:transition-[width]",
          panelOpen && selected ? "lg:w-[320px]" : "lg:w-0 lg:border-l-0",
          detallesAbiertos && selected
            ? "fixed inset-0 z-40 lg:static lg:z-auto"
            : "hidden"
        )}
      >
        {selected && (
          <div className="h-full w-full lg:w-[320px]">
            <ContactPanel
              conversation={selected}
              refreshKey={detailRev}
              onPatchConversation={patchConversation}
              onClose={() => {
                // El mismo botón cierra la hoja del móvil o pliega la columna
                // del escritorio, según cuál esté a la vista.
                if (detallesAbiertos) setDetallesAbiertos(false);
                else togglePanel(false);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
