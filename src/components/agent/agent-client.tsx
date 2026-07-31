"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AprendizajeSection } from "@/components/agent/aprendizaje-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
  notifyPhones: string | null;
  notifyTemplate: string | null;
  notifyTemplateLang: string | null;
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function AgentClient({ esAgencia = false }: { esAgencia?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>) {
    await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="font-semibold">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label="Agente encendido"
            disabled={!aiConfigured}
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              profile.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-6 mt-6 rounded-lg border border-brand-soft bg-brand-tint p-6 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configura tu proveedor de IA para activar el agente</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Agrega <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> y{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_MODEL</code> a las variables
            de entorno de la instancia y reiníciala. Mientras tanto puedes dejar listo el
            comportamiento y el conocimiento aquí abajo.
          </p>
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <ProfileSection profile={profile} onSave={saveProfile} />
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
        {esAgencia && (
          <div className="lg:col-span-2">
            <AprendizajeSection onAprendido={() => void refetch()} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  useEffect(() => setForm(profile), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del agente</Label>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            placeholder="p. ej. cercano y directo, con usted"
            value={form.tone ?? ""}
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instrucciones</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder="Qué debe y no debe hacer el agente…"
            value={form.instructions ?? ""}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">Reglas de escalado</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder="Cuándo pasar la conversación a un humano…"
            value={form.escalationRules ?? ""}
            onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">Saludo</Label>
          <Input
            id="agent-greeting"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-notify">Avisar pedidos a estos WhatsApp</Label>
          <Input
            id="agent-notify"
            placeholder="573001112233, 573004445566"
            value={form.notifyPhones ?? ""}
            onChange={(e) => setForm({ ...form, notifyPhones: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Cuando un cliente confirme un pedido, estas personas reciben el
            detalle por WhatsApp. Con indicativo y separados por coma. El pedido
            siempre queda en la bandeja aunque el aviso falle.
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Importante:</strong> WhatsApp solo deja escribirle a quien
            le haya escrito al negocio en las últimas 24 horas. Que cada persona
            de esta lista le mande un mensaje al número del negocio a diario
            (basta un &quot;hola&quot;) para seguir recibiendo los pedidos.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-notify-template">
            Plantilla del aviso{" "}
            <span className="text-muted-foreground">(opcional, tiene costo)</span>
          </Label>
          <Input
            id="agent-notify-template"
            placeholder="vacío = mensaje normal, sin costo"
            value={form.notifyTemplate ?? ""}
            onChange={(e) =>
              setForm({ ...form, notifyTemplate: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            Una plantilla aprobada llega siempre, sin depender de las 24 horas,
            pero WhatsApp cobra cada envío. Déjalo vacío para usar mensajes
            normales.
          </p>
        </div>
        <Button onClick={() => void onSave(form)}>Guardar comportamiento</Button>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qa", question, answer }),
    }).catch(() => null);
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "block", content: block }),
    }).catch(() => null);
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-[#8a6d3b]">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considera depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva pregunta / respuesta</p>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void addQa()}
            disabled={!question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar P/R
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo bloque de texto libre</p>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <Button size="sm" onClick={() => void addBlock()} disabled={!block.trim()}>
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <KbRow
              key={e.id}
              entry={e}
              onChanged={onChanged}
              onRemove={() => void remove(e.id)}
            />
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Entrada del conocimiento: se lee y se corrige en el sitio. Antes solo se
 * podía borrar y volver a escribir, que es lo peor cuando lo único mal es un
 * horario o un precio.
 */
function KbRow({
  entry,
  onChanged,
  onRemove,
}: {
  entry: KbEntry;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(entry.question ?? "");
  const [answer, setAnswer] = useState(entry.answer ?? "");
  const [content, setContent] = useState(entry.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isQa = entry.kind === "qa";
  const unchanged = isQa
    ? question === (entry.question ?? "") && answer === (entry.answer ?? "")
    : content === (entry.content ?? "");
  const incomplete = isQa
    ? !question.trim() || !answer.trim()
    : !content.trim();

  function cancel() {
    setQuestion(entry.question ?? "");
    setAnswer(entry.answer ?? "");
    setContent(entry.content ?? "");
    setError(null);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/kb/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isQa ? { question, answer } : { content }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError("No se pudo guardar el cambio");
      return;
    }
    setEditing(false);
    onChanged();
  }

  if (!editing) {
    return (
      <li className="flex items-start gap-2 rounded-md border p-3">
        <div className="min-w-0 flex-1 text-sm">
          {isQa ? (
            <>
              <p className="font-medium">{entry.question}</p>
              <p className="mt-0.5 text-muted-foreground">{entry.answer}</p>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {entry.content}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Editar entrada"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Eliminar entrada"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded-md border p-3">
      {isQa ? (
        <>
          <Input
            aria-label="Pregunta"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            aria-label="Respuesta"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </>
      ) : (
        <Textarea
          aria-label="Contenido"
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || incomplete || unchanged}
          onClick={() => void save()}
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button size="sm" variant="outline" onClick={cancel}>
          Cancelar
        </Button>
      </div>
    </li>
  );
}
