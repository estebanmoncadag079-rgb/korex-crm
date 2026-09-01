"use client";

import { cn } from "@/lib/utils";
import { useAutoResize } from "./use-auto-resize";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /**
   * La caja crece en alto para mostrar todo el texto, en lugar de recortarlo con
   * scroll interno. Opt-in: las cajas que deben ser un área fija (pegar un
   * catálogo, editar una plantilla) lo dejan apagado y no cambian.
   */
  autoResize?: boolean;
};

export function Textarea({ className, autoResize, onInput, ...props }: TextareaProps) {
  const { ref, ajustar } = useAutoResize(autoResize);
  return (
    <textarea
      ref={ref}
      onInput={(e) => {
        ajustar?.();
        onInput?.(e);
      }}
      className={cn(
        /* 16px en móvil: por debajo, iOS hace zoom al enfocar (ver Input). */
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        /* Al auto-crecer, el alto lo fija el contenido: sin scroll ni tirador. */
        autoResize && "resize-none overflow-hidden",
        className
      )}
      {...props}
    />
  );
}
