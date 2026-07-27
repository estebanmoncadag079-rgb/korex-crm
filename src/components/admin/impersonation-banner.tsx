"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";

/**
 * Aviso permanente mientras la agencia opera dentro de la cuenta de un
 * cliente: sin él es imposible saber a nombre de quién estás respondiendo.
 */
export function ImpersonationBanner({ clientName }: { clientName: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: null }),
    }).catch(() => null);
    setLeaving(false);
    if (!res?.ok) return;
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 border-b border-[#e6d9a8] bg-[#fdf6dd] px-4 py-2 text-[13px] text-[#6b5b1f]">
      <Eye className="h-4 w-4 shrink-0" strokeWidth={1.7} />
      <span className="min-w-0 flex-1 truncate">
        Estás dentro de <strong>{clientName}</strong> como administrador. Lo
        que respondas sale a nombre de ese negocio.
      </span>
      <button
        className="shrink-0 rounded border border-[#d9c98f] bg-white/70 px-2.5 py-1 font-medium hover:bg-white disabled:opacity-60"
        onClick={() => void leave()}
        disabled={leaving}
      >
        {leaving ? "Saliendo…" : "Volver a mi cuenta"}
      </button>
    </div>
  );
}
