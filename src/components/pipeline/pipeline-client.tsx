"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MessageSquareText, Settings2, Trophy, XCircle } from "lucide-react";
import type { StageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/components/inbox/helpers";
import { ConversationPreview } from "./conversation-preview";
import { StageManager } from "./stage-manager";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  /** Última vez que escribió el cliente. Null si nunca lo hizo. */
  lastInboundAt: string | null;
  contact: { id: string; name: string; phone: string | null };
  conversationId: string | null;
};

/**
 * Días completos que el cliente lleva sin escribir. Null si nunca escribió o si
 * contestó hoy — ahí no hay nada que reprochar y la tarjeta no debe gritar.
 */
function diasSinResponder(lastInboundAt: string | null): number | null {
  if (!lastInboundAt) return null;
  const dias = Math.floor(
    (Date.now() - new Date(lastInboundAt).getTime()) / 86_400_000
  );
  return dias >= 1 ? dias : null;
}

export function PipelineClient() {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [leads, setLeads] = useState<BoardLead[]>([]);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);
  /** Tarjeta cuya conversación se está mirando al lado del tablero. */
  const [viendo, setViendo] = useState<BoardLead | null>(null);

  /*
   * Ratón y dedo necesitan reglas distintas para empezar a arrastrar.
   *
   * Con un único PointerSensor por distancia, en un teléfono cualquier deslizar
   * para pasar la lista se interpretaba como arrastre: la tarjeta cambiaba de
   * etapa sin querer, y eso se guarda en la base. Con el dedo hay que mantener
   * pulsado un cuarto de segundo (con 8px de margen de tembleque) para levantar
   * la tarjeta; los deslizamientos rápidos siguen siendo scroll. El ratón
   * conserva exactamente el umbral de 6px de siempre.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );

  const refetch = useCallback(async () => {
    const res = await fetch("/api/pipeline/board").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { stages: StageDto[]; leads: BoardLead[] };
    setStages(data.stages);
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(event.active.id);
    const overStage = event.over ? String(event.over.id) : null;
    if (!overStage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === overStage) return;

    const position = leads.filter((l) => l.stageId === overStage).length;
    // Optimista + persistencia
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stageId: overStage, position } : l))
    );
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId: overStage, position }),
    }).catch(() => null);
    void refetch();
  }

  /*
   * El panel se alimenta de la lista viva, no de la copia que se guardó al
   * pulsar: así, si la tarjeta cambia de etapa o le llega actividad mientras se
   * mira, el encabezado no se queda con datos viejos.
   */
  const leadViendo = viendo
    ? (leads.find((l) => l.id === viendo.id) ?? viendo)
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="font-semibold">Pipeline</h2>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setManaging(true)}
        >
          <Settings2 className="h-4 w-4" /> Gestionar etapas
        </Button>
      </header>

      {/* `min-h-0` es lo que permite que tablero y panel tengan su propio
          scroll: sin él, un hijo flexible se niega a encoger por debajo de su
          contenido y el desplazamiento se va a la página entera. */}
      <div className="flex min-h-0 flex-1">
        {/* El tablero se desplaza de lado dentro de su caja: la página nunca se
            mueve. En móvil la columna siguiente asoma y se ve que hay más. */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-3 md:p-4">
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragEnd={(e) => void onDragEnd(e)}
          >
            <div className="flex h-full gap-3">
              {stages.map((stage) => (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  leads={leads
                    .filter((l) => l.stageId === stage.id)
                    .sort((a, b) => a.position - b.position)}
                  onVerConversacion={setViendo}
                  viendoId={viendo?.id ?? null}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        {leadViendo && (
          <ConversationPreview
            // Al cambiar de tarjeta se remonta el panel: así el hilo empieza
            // limpio y abajo del todo, en vez de heredar el scroll del anterior.
            key={leadViendo.id}
            lead={leadViendo}
            onClose={() => setViendo(null)}
          />
        )}
      </div>

      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  onVerConversacion,
  viendoId,
}: {
  stage: StageDto;
  leads: BoardLead[];
  onVerConversacion: (lead: BoardLead) => void;
  viendoId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[17rem] shrink-0 flex-col rounded-lg border bg-card/50 md:w-64",
        isOver && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 text-primary" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {stage.name}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <DraggableLead
            key={lead.id}
            lead={lead}
            onVerConversacion={onVerConversacion}
            viendo={lead.id === viendoId}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableLead({
  lead,
  onVerConversacion,
  viendo,
}: {
  lead: BoardLead;
  onVerConversacion: (lead: BoardLead) => void;
  viendo: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} onVerConversacion={onVerConversacion} viendo={viendo} />
    </div>
  );
}

function LeadCard({
  lead,
  overlay = false,
  onVerConversacion,
  viendo = false,
}: {
  lead: BoardLead;
  overlay?: boolean;
  /** Ausente en la tarjeta fantasma que sigue al dedo mientras se arrastra. */
  onVerConversacion?: (lead: BoardLead) => void;
  viendo?: boolean;
}) {
  const sinResponder = diasSinResponder(lead.lastInboundAt);
  return (
    <div
      className={cn(
        // `touch-manipulation` quita el retardo del doble toque sin desactivar
        // el scroll: el dedo sigue pudiendo recorrer la columna.
        "cursor-grab touch-manipulation rounded-md border bg-card p-3 shadow-sm",
        overlay && "rotate-2 shadow-xl",
        viendo && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.contact.name}</p>
          {/*
            Mientras el cliente responde, lo útil es cuándo fue la última vez.
            En cuanto se hace el silencio, lo útil es CUÁNTO lleva callado: es
            el dato con el que se decide a quién ir a recuperar primero.
          */}
          {sinResponder !== null ? (
            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
              Sin responder hace {sinResponder}{" "}
              {sinResponder === 1 ? "día" : "días"}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {lead.lastActivityAt
                ? `Actividad: ${formatTime(lead.lastActivityAt)}`
                : "Sin actividad"}
            </p>
          )}
        </div>
        {/*
          El botón corta los eventos de los DOS sensores: el de ratón escucha
          `mousedown` y el táctil `touchstart`, así que frenar solo
          `pointerdown` dejaría de protegerlo y abrir la conversación acabaría
          arrastrando la tarjeta.
        */}
        {lead.conversationId && onVerConversacion && (
          <button
            type="button"
            onClick={() => onVerConversacion(lead)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label={`Ver la conversación de ${lead.contact.name}`}
            aria-pressed={viendo}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-accent hover:text-foreground md:h-7 md:w-7",
              viendo ? "bg-accent text-foreground" : "text-muted-foreground"
            )}
          >
            <MessageSquareText className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
