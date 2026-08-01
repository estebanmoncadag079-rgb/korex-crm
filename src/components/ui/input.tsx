import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // `text-base` en móvil no es capricho de tamaño: Safari de iOS hace
        // zoom automático al enfocar un campo de menos de 16px y deja la
        // pantalla desencuadrada. A partir de `md` vuelve a 14px.
        "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
        className
      )}
      {...props}
    />
  );
}
