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
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { useEvents } from "@/components/use-events";

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

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[#26262a] bg-[#0e0e10] px-3 pb-3.5 pt-4 text-white">
      {/* Brand white-label */}
      <div className="mb-4 flex items-center gap-2.5 px-2">
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-white/10 text-white"
          aria-hidden
        >
          <KorexMark className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-[650] leading-tight tracking-tight text-white">
            {branding.name}
          </span>
          <span className="block text-[11px] text-[#8a8a92]">CRM · WhatsApp</span>
        </span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 font-semibold text-white"
                  : "text-[#9a9aa2] hover:bg-white/[0.06] hover:text-white"
              )}
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

      <div className="flex-1" />

      {isPlatformAdmin && (
        <Link
          href="/admin"
          className={cn(
            "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/admin")
              ? "bg-white/10 font-semibold text-white"
              : "text-[#9a9aa2] hover:bg-white/[0.06] hover:text-white"
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
          "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
          pathname.startsWith("/settings")
            ? "bg-white/10 font-semibold text-white"
            : "text-[#9a9aa2] hover:bg-white/[0.06] hover:text-white"
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
        className="flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium text-[#9a9aa2] transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-60"
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
  );
}
