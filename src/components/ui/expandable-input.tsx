import { cn } from "@/lib/utils";

/**
 * Un campo de una línea con el mismo aspecto de `Input`, pero que el usuario
 * puede ampliar arrastrando la esquina inferior derecha — como ya podía con
 * cualquier `Textarea` (25-ago-2026, pedido explícito: "todos los cuadros de
 * texto", dejando que el cliente decida si lo amplía o no).
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
  onKeyDown,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "flex h-10 w-full resize-y overflow-auto rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
        className
      )}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
        onKeyDown?.(e);
      }}
      {...props}
    />
  );
}
