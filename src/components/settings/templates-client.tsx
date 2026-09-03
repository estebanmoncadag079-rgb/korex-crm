"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_BADGE: Record<
  TemplateDto["status"],
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending: { label: "Pendiente de Meta", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

/**
 * Fase 9M, sección 20 — vista SOLO LECTURA del cliente: solo plantillas
 * `approved` de su organización. Crear/editar/enviar a aprobación es
 * exclusivo del panel de superadmin (`/admin/templates`) — no hay ningún
 * formulario aquí.
 */
export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/templates").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { templates: TemplateDto[] };
    setTemplates(data.templates.filter((t) => t.status === "approved"));
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await fetch("/api/templates/sync", { method: "POST" }).catch(
      () => null
    );
    setSyncing(false);
    if (res?.ok) {
      const data = (await res.json()) as { updated: number };
      setSyncMsg(
        data.updated > 0
          ? `${data.updated} plantilla(s) actualizada(s)`
          : "Todo al día"
      );
      void refetch();
    } else {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSyncMsg(data?.error?.message ?? "No se pudo sincronizar");
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <p className="text-sm text-muted-foreground">
          Plantillas aprobadas para reabrir conversaciones con la ventana de
          24 h cerrada. Korex administra la creación y el envío a aprobación
          — si necesitas una nueva, pídesela a tu agencia.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={syncing}
          onClick={() => void sync()}
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-all font-mono text-sm font-medium">
                {t.name}{" "}
                <span className="text-muted-foreground">({t.language})</span>
              </p>
              <Badge
                className="shrink-0 whitespace-nowrap"
                variant={STATUS_BADGE[t.status].variant}
              >
                {STATUS_BADGE[t.status].label}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t.body}</p>
          </div>
        ))}
        {templates.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía no tienes plantillas aprobadas.
          </p>
        )}
      </div>
    </div>
  );
}
