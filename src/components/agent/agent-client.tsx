"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AprendizajeSection } from "@/components/agent/aprendizaje-section";
import { EntrenamientoCard } from "@/components/agent/entrenamiento-card";
import { ExpandableInput } from "@/components/ui/expandable-input";
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
      {/* El interruptor es lo más usado de esta pantalla: se queda pegado a la
          derecha del título aunque la cabecera se estreche. */}
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="truncate font-semibold">Agente de IA</h2>
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label={
              profile.enabled ? "Apagar el agente" : "Encender el agente"
            }
            disabled={!aiConfigured || !esAgencia}
            title={
              esAgencia
                ? undefined
                : "Solo el administrador de la plataforma puede encender o apagar el agente"
            }
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
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
        <div className="mx-4 mt-4 rounded-lg border border-brand-soft bg-brand-tint p-5 text-center md:mx-6 md:mt-6 md:p-6">
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

      {/*
        La entrada a la configuración inicial, arriba del todo.
        Se considera "configurado" si ya tiene instrucciones: un negocio recién
        creado las trae vacías, y ahí es cuando hay que invitarlo a empezar en
        vez de dejarlo frente a campos técnicos que no le dicen nada.
      */}
      <div className="p-4 pb-0 md:p-6 md:pb-0">
        <EntrenamientoCard configurado={Boolean(profile.instructions?.trim())} />
      </div>

      <div className="grid gap-4 p-4 md:gap-6 md:p-6 lg:grid-cols-2">
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
        <CardTitle>Avisos</CardTitle>
        <CardDescription>
          A quién le llegan los pedidos que confirma el agente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          Aquí se editaban a mano el nombre, el tono, las instrucciones, las
          reglas de escalado y el saludo. Se quitaron el 15-ago-2026.

          No era una pantalla de más: era una pantalla que **mentía**. Esos cinco
          campos los reescribe `generarPerfil()` cada vez que se envía el
          cuestionario o se pasa `regenerar:flota`, así que lo que se escribiera
          aquí duraba hasta el siguiente clic —sin aviso, sin rastro y sin forma
          de saber que se había perdido—. La conducta es **la misma para todos
          los clientes** (`conducta.ts`) y lo propio del negocio sale de su
          ficha: ninguna de las dos se corrige cliente por cliente.

          Cambiarlas aquí, además, rompía el modelo entero: una lección
          aprendida se escribe UNA vez en `conducta.ts` y llega a toda la flota.
          Un prompt editado a mano se queda fuera de esa mejora para siempre.

          Lo que sí sigue aquí abajo es lo que NO se genera: a qué teléfonos
          avisar. Eso es de cada negocio y cambia cuando cambia su equipo.
        */}
        <div className="space-y-1.5">
          <Label htmlFor="agent-notify">Avisar pedidos a estos WhatsApp</Label>
          <ExpandableInput
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
        {/* Acción principal a lo ancho en móvil: es el objetivo más grande
            posible al final de un formulario largo. */}
        {/* Solo los campos de avisos: mandar `form` entero devolvería a la base
            el prompt que esta pantalla tenía cargado, que puede ser anterior a
            la última regeneración. */}
        <Button
          className="w-full sm:w-auto"
          onClick={() =>
            void onSave({
              notifyPhones: form.notifyPhones,
              notifyTemplate: form.notifyTemplate,
              notifyTemplateLang: form.notifyTemplateLang,
            })
          }
        >
          Guardar avisos
        </Button>
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge
              className="shrink-0 whitespace-nowrap"
              variant={kbSize.warning ? "warning" : "secondary"}
            >
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
          <ExpandableInput
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
            className="w-full sm:w-auto"
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
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => void addBlock()}
            disabled={!block.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            Sin entradas todavía: agrega lo que el agente debe saber.
          </p>
        ) : (
          // Con muchas entradas, cada una colapsada seguía siendo un listado
          // larguísimo de títulos. Esto envuelve TODO el listado en un solo
          // desplegable: por defecto solo se ve cuántas hay, y se abre entero
          // de un clic — cada entrada, adentro, sigue siendo su propio
          // <details> para leer una sin desplegar las demás.
          <details className="group rounded-md border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
              <span>
                Ver las {entries.length}{" "}
                {entries.length === 1 ? "entrada guardada" : "entradas guardadas"}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <ul className="space-y-2 border-t p-3">
              {entries.map((e) => (
                <KbRow
                  key={e.id}
                  entry={e}
                  onChanged={onChanged}
                  onRemove={() => void remove(e.id)}
                />
              ))}
            </ul>
          </details>
        )}
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
    // Sin pregunta propia (bloque de texto libre), el resumen colapsado es
    // su primera línea — lo que alguien escribiría como título si tuviera uno.
    const titulo = isQa ? entry.question : (entry.content ?? "").split("\n")[0];
    return (
      <li className="rounded-md border">
        {/* <details> nativo: colapsa/expande sin JS propio, y el teclado y
            los lectores de pantalla ya saben qué hacer con <summary>. */}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-2 p-3 text-sm marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 truncate font-medium">{titulo}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex items-start gap-1 border-t p-3">
            <div className="min-w-0 flex-1 break-words text-sm">
              {isQa ? (
                <p className="text-muted-foreground">{entry.answer}</p>
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
          </div>
        </details>
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded-md border p-3">
      {isQa ? (
        <>
          <ExpandableInput
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
