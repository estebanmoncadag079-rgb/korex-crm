import { cn } from "@/lib/utils";

/**
 * `<select>` nativo con el estilo del sistema (mismo alto, borde, foco y bg-card
 * que ya usaban los selects sueltos de la bandeja y de plantillas). Nativo a
 * propósito: el desplegable del sistema operativo es más fiable con el pulgar en
 * el móvil que uno hecho a mano.
 *
 * `text-base` en móvil evita el zoom automático de iOS al enfocar (igual que Input).
 */
export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-card px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
        className
      )}
      {...props}
    />
  );
}
