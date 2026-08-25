"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useEvents } from "@/components/use-events";
import type { TranscriptLine } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableInput } from "@/components/ui/expandable-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Run = {
  id: string;
  status: "running" | "done" | "failed";
  score: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  delta: number | null;
};

type Hallazgo = {
  tipo: "alucinacion" | "fuera_de_kb" | "debio_escalar" | "tono";
  evidencia: string;
  sugerencia?: { pregunta: string; respuesta: string };
};

type Case = {
  id: string;
  persona: string;
  personaLabel: string;
  status: string;
  veredicto: "verde" | "amarillo" | "rojo" | null;
  hallazgos: Hallazgo[];
  transcript: TranscriptLine[];
};

const TIPO_LABELS: Record<Hallazgo["tipo"], string> = {
  alucinacion: "Alucinación",
  fuera_de_kb: "Fuera del conocimiento",
  debio_escalar: "Debió escalar",
  tono: "Tono",
};

export function LabClient() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [aiConfigured, setAiConfigured] = useState(true);
  // null = la agencia, que no tiene cupo.
  const [quota, setQuota] = useState<{ used: number; limit: number | null; left: number | null } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: Run; cases: Case[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetchRuns = useCallback(async () => {
    const res = await fetch("/api/lab/runs").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      runs: Run[];
      aiConfigured: boolean;
      quota?: { used: number; limit: number | null; left: number | null };
    };
    setRuns(data.runs);
    setAiConfigured(data.aiConfigured);
    setQuota(data.quota ?? null);
    if (!selectedRunId && data.runs[0]) setSelectedRunId(data.runs[0].id);
  }, [selectedRunId]);

  const refetchDetail = useCallback(async (runId: string) => {
    const res = await fetch(`/api/lab/runs/${runId}`).catch(() => null);
    if (!res?.ok) return;
    setDetail((await res.json()) as { run: Run; cases: Case[] });
  }, []);

  useEffect(() => {
    void refetchRuns();
  }, [refetchRuns]);

  useEffect(() => {
    if (selectedRunId) void refetchDetail(selectedRunId);
  }, [selectedRunId, refetchDetail]);

  useEvents({
    onLabRun: (data) => {
      setProgress(data.status === "running" ? data.progress : null);
      void refetchRuns();
      if (selectedRunId === data.runId || !selectedRunId) {
        setSelectedRunId(data.runId);
        void refetchDetail(data.runId);
      }
    },
  });

  async function launch() {
    setLaunching(true);
    setError(null);
    const res = await fetch("/api/lab/runs", { method: "POST" }).catch(() => null);
    setLaunching(false);
    if (!res) return;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo lanzar la corrida");
      return;
    }
    const data = (await res.json()) as { runId: string };
    setSelectedRunId(data.runId);
    setProgress({ done: 0, total: 6 });
    void refetchRuns();
  }

  if (!aiConfigured) {
    return (
      <div className="flex h-full flex-col">
        <Header running={false} launching={false} onLaunch={() => {}} disabled />
        <div className="m-4 rounded-lg border border-brand-soft bg-brand-tint p-6 text-center md:m-6 md:p-8">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">
            Configura tu proveedor de IA para usar el Laboratorio
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            El Laboratorio necesita el agente activo: agrega{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> a la
            instancia y vuelve aquí.
          </p>
        </div>
      </div>
    );
  }

  const running = runs.some((r) => r.status === "running");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Header
        running={running}
        launching={launching}
        onLaunch={() => void launch()}
        disabled={quota?.left === 0}
        quota={quota}
      />
      {error && (
        <p className="px-4 pt-3 text-sm text-destructive md:px-6">{error}</p>
      )}

      {running && progress && (
        <div className="mx-4 mt-4 rounded-lg border bg-card p-4 md:mx-6">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Evaluando personas…</span>
            <span className="text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 p-4 md:gap-6 md:p-6 lg:grid-cols-[280px_1fr]">
        <HistoryList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
        {detail ? (
          <Report detail={detail} onApplied={() => void refetchDetail(detail.run.id)} />
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {runs.length === 0
              ? "Corre tu primera evaluación: 6 clientes simulados conversarán con tu agente y un juez calificará cada conversación."
              : "Elige una corrida del historial."}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({
  running,
  launching,
  onLaunch,
  disabled,
  quota,
}: {
  running: boolean;
  launching: boolean;
  onLaunch: () => void;
  disabled: boolean;
  quota?: { used: number; limit: number | null; left: number | null } | null;
}) {
  return (
    <header className="flex flex-col gap-3 border-b px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-6 md:py-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="h-4 w-4 text-primary" /> Laboratorio
        </h2>
        <p className="text-xs text-muted-foreground">
          Sandbox interno — no envía mensajes reales
          {quota?.limit != null && (
            <>
              {" · "}
              <span className={quota.left === 0 ? "text-destructive" : undefined}>
                {quota.left === 0
                  ? `Sin pruebas este mes (${quota.limit} de ${quota.limit} usadas)`
                  : `Te quedan ${quota.left} de ${quota.limit} pruebas este mes`}
              </span>
            </>
          )}
        </p>
      </div>
      <Button
        className="w-full shrink-0 sm:w-auto"
        onClick={onLaunch}
        disabled={disabled || running || launching}
      >
        <Play className="h-4 w-4" />
        {running ? "Corrida en curso…" : "Correr evaluación"}
      </Button>
    </header>
  );
}

function HistoryList({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    /*
     * Debajo de `lg` el historial es una tira que se desliza en horizontal: en
     * columna habría que pasar por delante de todas las corridas antes de
     * llegar al reporte, que es lo que se viene a leer.
     */
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Historial
      </p>
      {runs.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin corridas todavía.</p>
      )}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {runs.map((run) => (
          <button
            key={run.id}
            onClick={() => onSelect(run.id)}
            className={`w-40 shrink-0 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 lg:w-full ${
              selectedRunId === run.id ? "border-primary/50 bg-accent/60" : "bg-card"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <ScoreBadge run={run} />
              {run.delta !== null && run.delta !== 0 && (
                <span
                  className={`flex items-center gap-0.5 text-xs font-medium ${
                    run.delta > 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {run.delta > 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  {run.delta > 0 ? "+" : ""}
                  {run.delta}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {new Date(run.startedAt).toLocaleString("es-MX", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScoreBadge({ run }: { run: Run }) {
  if (run.status === "running") return <Badge variant="secondary">En curso…</Badge>;
  if (run.status === "failed") return <Badge variant="destructive">Fallida</Badge>;
  const score = run.score ?? 0;
  const variant = score >= 80 ? "success" : score >= 50 ? "warning" : "destructive";
  return <Badge variant={variant}>Score {score}</Badge>;
}

function Report({
  detail,
  onApplied,
}: {
  detail: { run: Run; cases: Case[] };
  onApplied: () => void;
}) {
  const { run, cases } = detail;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Reporte</CardTitle>
            <ScoreBadge run={run} />
          </div>
          {run.status === "failed" && (
            <p className="text-sm text-destructive">
              La corrida falló: {run.error ?? "error desconocido"}. Vuelve a
              intentarlo.
            </p>
          )}
        </CardHeader>
        {run.status === "done" && (
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              {(["verde", "amarillo", "rojo"] as const).map((v) => (
                <div key={v} className="rounded-md border p-3">
                  <p className="text-2xl font-bold">
                    {cases.filter((c) => c.veredicto === v).length}
                  </p>
                  <p className="capitalize text-muted-foreground">{v}s</p>
                </div>
              ))}
            </div>
            {cases.some((c) => c.status === "judge_failed") && (
              <p className="mt-3 text-xs text-[#8a6d3b]">
                {cases.filter((c) => c.status === "judge_failed").length} caso(s) sin
                veredicto (el juez no respondió válido); excluidos del score.
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {cases.map((c) => (
        <CaseCard key={c.id} testCase={c} onApplied={onApplied} />
      ))}
    </div>
  );
}

function CaseCard({ testCase, onApplied }: { testCase: Case; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const c = testCase;
  const icon =
    c.veredicto === "verde" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : c.veredicto === "amarillo" ? (
      <AlertTriangle className="h-4 w-4 text-[#8a6d3b]" />
    ) : c.veredicto === "rojo" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => setOpen(!open)}
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className="shrink-0">{icon}</span>
            <span className="truncate">{c.personaLabel}</span>
            {c.status === "judge_failed" && (
              <Badge className="shrink-0" variant="secondary">
                sin veredicto
              </Badge>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {c.hallazgos.length > 0 && `${c.hallazgos.length} hallazgo(s)`}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {c.hallazgos.map((h, i) => (
            <HallazgoCard key={i} hallazgo={h} caseId={c.id} index={i} onApplied={onApplied} />
          ))}
          <div className="rounded-md border bg-background/40 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transcript
            </p>
            <div className="space-y-1.5 text-sm">
              {c.transcript.map((t, i) =>
                // Las líneas de sistema no son mensajes al cliente: son lo que
                // el agente hizo de verdad. Se marcan aparte para que nadie las
                // lea como algo que el cliente vio.
                t.role === "sistema" ? (
                  <p key={i} className="italic text-muted-foreground">
                    ⚙ {t.text}
                  </p>
                ) : (
                  <p key={i}>
                    <span
                      className={
                        t.role === "cliente" ? "text-[#5b7291]" : "text-primary"
                      }
                    >
                      {t.role === "cliente" ? "Cliente" : "Agente"}:
                    </span>{" "}
                    {t.text}
                  </p>
                )
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function HallazgoCard({
  hallazgo,
  caseId,
  index,
  onApplied,
}: {
  hallazgo: Hallazgo;
  caseId: string;
  index: number;
  onApplied: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pregunta, setPregunta] = useState(hallazgo.sugerencia?.pregunta ?? "");
  const [respuesta, setRespuesta] = useState(hallazgo.sugerencia?.respuesta ?? "");
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function apply() {
    setSaving(true);
    const res = await fetch("/api/lab/suggestions/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, hallazgoIndex: index, pregunta, respuesta }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setApplied(true);
      setEditing(false);
      onApplied();
    }
  }

  return (
    <div className="rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="warning">{TIPO_LABELS[hallazgo.tipo]}</Badge>
        {hallazgo.sugerencia && !applied && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Agregar al conocimiento
          </Button>
        )}
        {applied && (
          <span className="text-xs text-success">Agregado al conocimiento ✓</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Evidencia:</span>{" "}
        {hallazgo.evidencia}
      </p>
      {editing && hallazgo.sugerencia && (
        <div className="mt-3 space-y-2 rounded-md border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor={`sug-q-${caseId}-${index}`}>Pregunta</Label>
            <ExpandableInput
              id={`sug-q-${caseId}-${index}`}
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`sug-a-${caseId}-${index}`}>Respuesta</Label>
            <Textarea
              id={`sug-a-${caseId}-${index}`}
              rows={3}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void apply()}
              disabled={saving || !pregunta.trim() || !respuesta.trim()}
            >
              {saving ? "Guardando…" : "Guardar en el KB"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
