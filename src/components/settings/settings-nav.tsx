"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * La conexión del número no se le muestra al cliente: ahí viven las
 * credenciales con las que su bot sale a WhatsApp, y sobrescribirlas lo deja
 * sin servicio sin que sea evidente por qué. La conecta la agencia al dar de
 * alta el cliente.
 */
const TABS = [
  { href: "/settings/whatsapp", label: "WhatsApp", soloAgencia: true },
  { href: "/settings/branding", label: "Marca", soloAgencia: false },
  { href: "/settings/templates", label: "Plantillas", soloAgencia: false },
  { href: "/settings/team", label: "Equipo", soloAgencia: false },
  { href: "/settings/cuenta", label: "Mi cuenta", soloAgencia: false },
] as const;

export function SettingsNav({ esAgencia = false }: { esAgencia?: boolean }) {
  const pathname = usePathname();
  return (
    // Pestañas deslizables en móvil (con su propio scroll, no el de la
    // página) y columna lateral de siempre en escritorio.
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-44 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
      {TABS.filter((t) => esAgencia || !t.soloAgencia).map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
