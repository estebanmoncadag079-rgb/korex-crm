"use client";

import { cn } from "@/lib/utils";
import { useAutoResize } from "./use-auto-resize";

type ExpandableInputProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /**
   * La caja crece sola en alto según lo que se escribe, sin scroll interno ni
   * tener que arrastrar el tirador. Opt-in, para no cambiar los campos que ya
   * funcionan como una sola línea ampliable a mano.
   */
  autoResize?: boolean;
};

/**
 * Un campo de una línea con el mismo aspecto de `Input`, pero que el usuario
 * puede ampliar arrastrando la esquina inferior derecha — como ya podía con
 * cualquier `Textarea` (25-ago-2026, pedido explícito: "todos los cuadros de
 * texto", dejando que el cliente decida si lo amplía o no).
 *
 * Con `autoResize` la caja se amplía sola a medida que crece el texto (pedido
 * del dueño para el cuestionario de alta, donde las respuestas largas se
 * cortaban con scroll dentro de la caja).
 *
 * Enter se comporta como en un `<input>` dentro de un formulario (dispara el
 * submit si hay uno) en vez de saltar de línea, salvo Shift+Enter — mismo
 * patrón que ya usa el compositor de chat (`composer.tsx`). Así los pocos
 * campos con su propio atajo de Enter (agregar una opción, una etapa) se
 * dejaron como `Input` normal en vez de tocarlos.
 */
export function ExpandableInput({
  className,
  rows = 1,
  autoResize,
  onKeyDown,
  onInput,
  ...props
}: ExpandableInputProps) {
  const { ref, ajustar } = useAutoResize(autoResize);
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "flex h-10 w-full resize-y overflow-auto rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
        /* Al auto-crecer manda el contenido: sin alto fijo, sin scroll, sin tirador. */
        autoResize && "h-auto min-h-10 resize-none overflow-hidden md:min-h-9",
        className
      )}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
        onKeyDown?.(e);
      }}
      onInput={(e) => {
        ajustar?.();
        onInput?.(e);
      }}
      {...props}
    />
  );
}
