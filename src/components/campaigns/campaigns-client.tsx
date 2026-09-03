"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Fase 10G — módulo de campañas. Un cliente puede crear un borrador,
 * elegir plantilla y audiencia, ver la estimación, y pedir aprobación.
 * Todo lo que gasta dinero de la agencia (preparar/aprobar/rechazar/
 * iniciar/pausar/reanudar/cancelar) solo lo ve y puede tocar el
 * superadmin — mismo principio ya aplicado a plantillas.
 */

type CampaignStatus =
  | "draft"
  | "pending_approval"
  | "ready"
  | "scheduled"
  | "processing"
  | "paused"
  | "completed"
  | "cancelled"
  | "rejected"
  | "failed";

type AudienceType = "todos_los_contactos" | "pipeline_stage" | "selected_contacts" | "fixed_count" | "budget";

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  templateId: string | null;
  audienceType: AudienceType;
  audienceFilter: Record<string, unknown> | null;
  estimatedRecipients: number | null;
  estimatedCostUsd: string | null;
  currency: string;
  rejectionReason: string | null;
};

type Template = { id: string; name: string; language: string; category: string; body: string; status: string };
type Stage = { id: string; name: string; kind: "open" | "won" | "lost" };

const STATUS_BADGE: Record<CampaignStatus, { label: string; variant: "secondary" | "warning" | "success" | "destructive" }> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending_approval: { label: "Pendiente de aprobación", variant: "warning" },
  ready: { label: "Aprobada", variant: "success" },
  scheduled: { label: "Programada", variant: "success" },
  processing: { label: "En proceso", variant: "warning" },
  paused: { label: "Pausada", variant: "warning" },
  completed: { label: "Completada", variant: "success" },
  cancelled: { label: "Cancelada", variant: "secondary" },
  rejected: { label: "Rechazada", variant: "destructive" },
  failed: { label: "Fallida", variant: "destructive" },
};

async function leerError(res: Response | null): Promise<string> {
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? "Algo salió mal";
}

export function CampaignsClient({ isPlatformAdmin, organizationId }: { isPlatformAdmin: boolean; organizationId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [detalle, setDetalle] = useState<Campaign | null>(null);

  const refetch = async () => {
    setLoading(true);
    const res = await fetch("/api/campaigns").catch(() => null);
    setLoading(false);
    if (!res?.ok) return;
    const data = (await res.json()) as { campaigns: Campaign[] };
    setCampaigns(data.campaigns);
  };

  useEffect(() => {
    void refetch();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Campañas</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Envía una plantilla aprobada a los contactos que elijas.
            {!isPlatformAdmin &&
              " Tú armas el borrador y pides aprobación; Korex revisa y la envía."}
          </p>
        </div>
        {!creando && (
          <Button onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" />
            Nueva campaña
          </Button>
        )}
      </div>

      {creando && (
        <CampaignForm
          onCancel={() => setCreando(false)}
          onCreated={(id) => {
            setCreando(false);
            void refetch();
            void fetch(`/api/campaigns/${id}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d: { campaign: Campaign } | null) => d && setDetalle(d.campaign));
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando campañas…</p>
      ) : campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay campañas. Crea la primera arriba.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Destinatarios estimados</th>
                <th className="p-3">Costo estimado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="max-w-[220px] truncate p-3 font-medium">{c.name}</td>
                  <td className="p-3">
                    <Badge variant={STATUS_BADGE[c.status].variant}>{STATUS_BADGE[c.status].label}</Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{c.estimatedRecipients ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {c.estimatedCostUsd ? `${Number(c.estimatedCostUsd).toFixed(2)} ${c.currency}` : "—"}
                  </td>
                  <td className="p-3">
                    <Button variant="outline" size="sm" onClick={() => setDetalle(c)}>
                      Ver
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detalle && (
        <CampaignDetail
          campaign={detalle}
          isPlatformAdmin={isPlatformAdmin}
          organizationId={organizationId}
          onClose={() => setDetalle(null)}
          onChanged={(actualizado) => {
            setDetalle(actualizado);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function CampaignForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("todos_los_contactos");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [fixedCount, setFixedCount] = useState("100");
  const [budgetUsd, setBudgetUsd] = useState("10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { templates: Template[] } | null) => setTemplates((d?.templates ?? []).filter((t) => t.status === "approved")))
      .catch(() => {});
    fetch("/api/pipeline/board")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stages: Stage[] } | null) => setStages(d?.stages ?? []))
      .catch(() => {});
  }, []);

  function audienceFilter() {
    if (audienceType === "pipeline_stage") return { type: "pipeline_stage", stageIds };
    if (audienceType === "fixed_count")
      return { type: "fixed_count", limit: Number(fixedCount) || 0, selectionStrategy: "oldest_first" as const };
    if (audienceType === "budget") return { type: "budget", budgetUsd: Number(budgetUsd) || 0 };
    return null;
  }

  async function crear() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, templateId: templateId || undefined }),
    }).catch(() => null);
    if (!res?.ok) {
      setSaving(false);
      setError(await leerError(res));
      return;
    }
    const { id } = (await res.json()) as { id: string };
    // Segundo paso: fija audiencia (la creación solo toma nombre+plantilla).
    const resPatch = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audienceType, audienceFilter: audienceFilter() }),
    }).catch(() => null);
    setSaving(false);
    if (!resPatch?.ok) {
      setError(await leerError(resPatch));
      return;
    }
    onCreated(id);
  }

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva campaña</CardTitle>
        <CardDescription>Elige plantilla y a quién llega — la estimación de costo aparece antes de confirmar nada.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cf-name">Nombre</Label>
          <Input id="cf-name" placeholder="Promoción septiembre" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cf-template">Plantilla (solo aprobadas)</Label>
          <select id="cf-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectClass}>
            <option value="">Selecciona una plantilla aprobada</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="text-xs text-muted-foreground">Todavía no hay ninguna plantilla aprobada para esta cuenta.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cf-audience">Audiencia</Label>
          <select
            id="cf-audience"
            value={audienceType}
            onChange={(e) => setAudienceType(e.target.value as AudienceType)}
            className={selectClass}
          >
            <option value="todos_los_contactos">Todos los contactos elegibles</option>
            <option value="pipeline_stage">Una o varias etapas del Pipeline</option>
            <option value="fixed_count">Cantidad fija de contactos</option>
            <option value="budget">Presupuesto máximo</option>
          </select>
        </div>

        {audienceType === "pipeline_stage" && (
          <div className="space-y-1.5 rounded-md border p-3">
            <Label>Etapas incluidas</Label>
            <div className="flex flex-wrap gap-2">
              {stages.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={stageIds.includes(s.id)}
                    onChange={(e) =>
                      setStageIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                    }
                  />
                  {s.name}
                </label>
              ))}
              {stages.length === 0 && <p className="text-xs text-muted-foreground">Sin etapas configuradas.</p>}
            </div>
          </div>
        )}

        {audienceType === "fixed_count" && (
          <div className="space-y-1.5">
            <Label htmlFor="cf-count">Cantidad de contactos (los más antiguos primero)</Label>
            <Input id="cf-count" type="number" min={1} value={fixedCount} onChange={(e) => setFixedCount(e.target.value)} />
          </div>
        )}

        {audienceType === "budget" && (
          <div className="space-y-1.5">
            <Label htmlFor="cf-budget">Presupuesto máximo (USD)</Label>
            <Input id="cf-budget" type="number" min={0.01} step="0.01" value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={saving || !name.trim()} onClick={() => void crear()}>
            {saving ? "Guardando…" : "Guardar borrador"}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type Estimacion = {
  elegiblesTotal: number;
  seleccionados: number;
  costoEstimadoUsd: number;
  moneda: string;
  categoria: string;
};

type Recipients = {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  indeterminado: number;
  delivered: number;
  read: number;
  total: number;
};

function CampaignDetail({
  campaign,
  isPlatformAdmin,
  organizationId,
  onClose,
  onChanged,
}: {
  campaign: Campaign;
  isPlatformAdmin: boolean;
  organizationId: string;
  onClose: () => void;
  onChanged: (c: Campaign) => void;
}) {
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null);
  const [recipients, setRecipients] = useState<Recipients | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");

  useEffect(() => {
    fetch(`/api/campaigns/${campaign.id}/estimate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Estimacion | null) => setEstimacion(d))
      .catch(() => {});
    fetch(`/api/campaigns/${campaign.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { recipients: Recipients } | null) => d && setRecipients(d.recipients))
      .catch(() => {});
  }, [campaign.id]);

  async function accion(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaign.id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await leerError(res));
      return;
    }
    const data = (await res.json()) as { campaign: Campaign };
    onChanged(data.campaign);
  }

  const st = campaign.status;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{campaign.name}</CardTitle>
            <CardDescription>
              <Badge variant={STATUS_BADGE[st].variant}>{STATUS_BADGE[st].label}</Badge>
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {campaign.rejectionReason && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.03] p-3 text-sm text-destructive">
              Motivo del rechazo: {campaign.rejectionReason}
            </p>
          )}

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimación</p>
            {estimacion ? (
              <p className="mt-1">
                {estimacion.seleccionados} de {estimacion.elegiblesTotal} contactos elegibles — costo estimado{" "}
                {estimacion.costoEstimadoUsd.toFixed(4)} {estimacion.moneda} ({estimacion.categoria})
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">Sin plantilla o audiencia todavía.</p>
            )}
          </div>

          {recipients && recipients.total > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
              <Stat label="Enviados" value={recipients.sent} />
              <Stat label="Entregados" value={recipients.delivered} />
              <Stat label="Leídos" value={recipients.read} />
              <Stat label="Fallidos" value={recipients.failed} />
              <Stat label="Omitidos" value={recipients.skipped} />
              <Stat label="Pendientes" value={recipients.pending} />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            {!isPlatformAdmin && st === "draft" && (
              <Button disabled={busy} onClick={() => void accion("request-approval")}>
                Solicitar aprobación
              </Button>
            )}

            {isPlatformAdmin && st === "draft" && (
              <Button disabled={busy} onClick={() => void accion("prepare")}>
                Preparar (sin aprobación)
              </Button>
            )}
            {isPlatformAdmin && st === "pending_approval" && (
              <>
                <Button disabled={busy} onClick={() => void accion("approve")}>
                  Aprobar
                </Button>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Motivo del rechazo"
                    value={motivoRechazo}
                    onChange={(e) => setMotivoRechazo(e.target.value)}
                    className="h-9"
                  />
                  <Button
                    variant="outline"
                    disabled={busy || !motivoRechazo.trim()}
                    onClick={() => void accion("reject", { motivo: motivoRechazo.trim() })}
                  >
                    Rechazar
                  </Button>
                </div>
              </>
            )}
            {isPlatformAdmin && (st === "ready" || st === "scheduled") && (
              <Button disabled={busy} onClick={() => void accion("start")}>
                Iniciar envío
              </Button>
            )}
            {isPlatformAdmin && st === "processing" && (
              <Button variant="outline" disabled={busy} onClick={() => void accion("pause")}>
                Pausar
              </Button>
            )}
            {isPlatformAdmin && st === "paused" && (
              <Button disabled={busy} onClick={() => void accion("resume")}>
                Reanudar
              </Button>
            )}
            {isPlatformAdmin && !["completed", "cancelled", "failed"].includes(st) && (
              <Button variant="outline" disabled={busy} onClick={() => void accion("cancel")}>
                Cancelar
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                fetch(`/api/campaigns/${campaign.id}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d: { recipients: Recipients } | null) => d && setRecipients(d.recipients));
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Actualizar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-base font-semibold">{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}
