"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KorexMark } from "@/components/korex-mark";
import {
  Building2,
  FlaskConical,
  Inbox,
  Kanban,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { useEvents } from "@/components/use-events";

/* Las tres piezas de una fila del menú, compartidas por enlaces y por el botón
   de salir para que no se desincronicen al retocar densidad o color. */
const NAV_ITEM =
  "flex items-center gap-[11px] rounded-sm px-2.5 py-2.5 text-sm font-medium transition-colors md:py-2";
const NAV_ACTIVO = "bg-white/10 font-semibold text-white";
const NAV_INACTIVO = "text-[#9a9aa2] hover:bg-white/[0.06] hover:text-white";

const NAV = [
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/agent", label: "Agente", icon: Sparkles },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical },
] as const;

export function AppNav({
  branding,
  userName,
  role,
  isPlatformAdmin = false,
}: {
  branding: Branding;
  userName: string;
  role: string;
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [leaving, setLeaving] = useState(false);
  /*
   * En un teléfono el menú no puede estar siempre puesto: 224px fijos se comen
   * más de la mitad de la pantalla y dejan el trabajo sin sitio. Debajo de
   * `md` es un cajón que se abre sobre el contenido; de `md` en adelante sigue
   * siendo la columna fija de siempre y este estado no pinta nada.
   */
  const [cajonAbierto, setCajonAbierto] = useState(false);

  async function refetchUnread() {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      conversations: { unreadCount: number }[];
    };
    setUnread(data.conversations.reduce((a, c) => a + c.unreadCount, 0));
  }

  useEffect(() => {
    void refetchUnread();
  }, []);

  useEvents({
    onMessageNew: () => void refetchUnread(),
    onConversationUpdated: () => void refetchUnread(),
  });

  // Navegar cierra el cajón: nadie quiere tapar con el menú la pantalla que
  // acaba de pedir.
  useEffect(() => {
    setCajonAbierto(false);
  }, [pathname]);

  // Escape es la salida que espera cualquiera que lo abra sin querer.
  useEffect(() => {
    if (!cajonAbierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCajonAbierto(false);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [cajonAbierto]);

  return (
    <>
      {/*
        Barra superior solo de móvil. Va fija arriba en lugar de dentro del
        flujo porque el armazón es una fila (menú | contenido): así da el botón
        de menú sin robarle ancho al trabajo. Su altura la compensa el layout
        con `pt-12`.
      */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-1 border-b border-[#26262a] bg-[#0e0e10] px-2 text-white md:hidden">
        <button
          type="button"
          onClick={() => setCajonAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={cajonAbierto}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-white transition-colors hover:bg-white/10"
        >
          <Menu className="h-5 w-5" strokeWidth={1.7} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[15px] font-[650] tracking-tight">
          {branding.name}
        </span>
        {unread > 0 && (
          <span className="mr-1 flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-white/15 px-1.5 text-[11px] font-semibold text-[#c8c8d0]">
            {unread}
          </span>
        )}
      </header>

      {/* Velo: toca fuera y se cierra. */}
      {cajonAbierto && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setCajonAbierto(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[82vw] flex-col overflow-y-auto border-r border-[#26262a] bg-[#0e0e10] px-3 pb-3.5 pt-4 text-white",
          // La transición incluye `visibility` a propósito: así el cajón
          // cerrado sale del orden de tabulación sin perder la animación de
          // salida (visibility cambia al final de la transición).
          "transition-[transform,visibility] duration-200",
          cajonAbierto
            ? "translate-x-0"
            : "invisible -translate-x-full md:visible",
          "md:static md:z-auto md:w-56 md:max-w-none md:shrink-0 md:translate-x-0 md:transition-none"
        )}
      >
        {/* Brand white-label */}
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-white/10 text-white"
            aria-hidden
          >
            <KorexMark className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-[650] leading-tight tracking-tight text-white">
              {branding.name}
            </span>
            <span className="block text-[11px] text-[#8a8a92]">CRM · WhatsApp</span>
          </span>
          <button
            type="button"
            onClick={() => setCajonAbierto(false)}
            aria-label="Cerrar menú"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-[#9a9aa2] transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>

        {/* `py-2.5` en móvil deja la fila en 40px, cómoda para el pulgar; en
            escritorio vuelve a la densidad original. */}
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(NAV_ITEM, active ? NAV_ACTIVO : NAV_INACTIVO)}
              >
                <item.icon
                  className={cn("h-[18px] w-[18px]", active ? "text-white" : "text-[#6e6e76]")}
                  strokeWidth={1.7}
                />
                <span className="flex-1">{item.label}</span>
                {"badge" in item && item.badge && unread > 0 && (
                  <span
                    className={cn(
                      "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold",
                      active ? "bg-white text-[#0e0e10]" : "bg-white/15 text-[#c8c8d0]"
                    )}
                  >
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="min-h-4 flex-1" />

        {isPlatformAdmin && (
          <Link
            href="/admin"
            className={cn(
              NAV_ITEM,
              pathname.startsWith("/admin") ? NAV_ACTIVO : NAV_INACTIVO
            )}
          >
            <Building2
              className={cn(
                "h-[18px] w-[18px]",
                pathname.startsWith("/admin") ? "text-white" : "text-[#6e6e76]"
              )}
              strokeWidth={1.7}
            />
            Clientes
          </Link>
        )}

        <Link
          href="/settings"
          className={cn(
            NAV_ITEM,
            pathname.startsWith("/settings") ? NAV_ACTIVO : NAV_INACTIVO
          )}
        >
          <Settings
            className={cn(
              "h-[18px] w-[18px]",
              pathname.startsWith("/settings") ? "text-white" : "text-[#6e6e76]"
            )}
            strokeWidth={1.7}
          />
          Ajustes
        </Link>

        <div className="mt-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
            {initials(userName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">{userName}</span>
            <span className="block text-[11px] text-[#8a8a92]">
              {isPlatformAdmin
                ? "Agencia"
                : role === "owner"
                  ? "Propietario"
                  : "Equipo"}{" "}
              · En línea
            </span>
          </span>
        </div>

        {/* Salir devuelve a la página inicial, no al login: quien cierra sesión
            normalmente quiere irse, no volver a entrar. */}
        <button
          className={cn(NAV_ITEM, NAV_INACTIVO, "disabled:opacity-60")}
          disabled={leaving}
          onClick={async () => {
            setLeaving(true);
            await signOut();
            router.push("/");
            router.refresh();
          }}
        >
          <LogOut className="h-[18px] w-[18px] text-[#6e6e76]" strokeWidth={1.7} />
          {leaving ? "Saliendo…" : "Salir"}
        </button>
      </aside>
    </>
  );
}
