"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Aprendizaje del agente a partir de conversaciones reales.
 *
 * El modelo no cambia nunca; lo que crece es el conocimiento del negocio, que
 * el agente lee en cada mensaje. Por eso lo aprobado surte efecto al instante.
 *
 * Nada entra solo: cada propuesta pasa por aprobación. Si el agente aprendiera
 * a ciegas de lo que responde el equipo, heredaría también sus prisas y sus
 * erratas —un precio mal escrito, algo de un día suelto— y se lo repetiría a
 * todos los clientes durante meses.
 */

type Propuesta = {
  id: string;
  question: string;
  answer: string;
  evidence: string | null;
};

export function AprendizajeSection({ onAprendido }: { onAprendido: () => void }) {
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/agent/aprendizaje").catch(() => null);
    // 403 = no es la agencia: la sección no se muestra siquiera.
    if (res?.ok) setPropuestas(((await res.json()) as { propuestas: Propuesta[] }).propuestas);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function buscar() {
    setBuscando(true);
    setAviso(null);
    const res = await fetch("/api/agent/aprendizaje", { method: "POST" }).catch(
      () => null
    );
    setBuscando(false);
    if (!res?.ok) {
      setAviso("No se pudo analizar. Inténtalo de nuevo en un momento.");
      return;
    }
    const data = (await res.json()) as {
      propuestas: Propuesta[];
      mensajesRevisados: number;
    };
    setPropuestas(data.propuestas);
    setAviso(
      data.propuestas.length === 0
        ? `Revisé ${data.mensajesRevisados} mensajes y no encontré nada nuevo que valga la pena. Es una buena señal: el agente ya sabe responder lo que preguntan.`
        : `Revisé ${data.mensajesRevisados} mensajes y encontré ${data.propuestas.length} cosa(s) que el agente aún no sabe.`
    );
  }

  async function decidir(
    id: string,
    decision: "approve" | "reject",
    edicion?: { question: string; answer: string }
  ) {
    const res = await fetch(`/api/agent/aprendizaje/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, ...edicion }),
    }).catch(() => null);
    if (!res?.ok) return;
    setPropuestas((p) => p.filter((x) => x.id !== id));
    if (decision === "approve") onAprendido();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Aprendizaje</CardTitle>
            <CardDescription>
              Revisa las conversaciones de la última semana y propone lo que el
              agente aún no sabe responder — sobre todo lo que tuvo que
              contestar una persona. Lo que apruebes entra en el conocimiento y
              lo usará en el siguiente mensaje.
            </CardDescription>
          </div>
          <Button onClick={() => void buscar()} disabled={buscando}>
            <Sparkles className="mr-1.5 h-4 w-4" strokeWidth={1.7} />
            {buscando ? "Analizando…" : "Buscar aprendizajes"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {aviso && (
          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            {aviso}
          </p>
        )}

        {propuestas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay propuestas pendientes. Pulsa &ldquo;Buscar aprendizajes&rdquo;
            cuando quieras revisar las conversaciones recientes.
          </p>
        ) : (
          propuestas.map((p) => (
            <PropuestaRow key={p.id} propuesta={p} onDecidir={decidir} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Una propuesta, editable antes de aprobarla. */
function PropuestaRow({
  propuesta,
  onDecidir,
}: {
  propuesta: Propuesta;
  onDecidir: (
    id: string,
    decision: "approve" | "reject",
    edicion?: { question: string; answer: string }
  ) => Promise<void>;
}) {
  const [question, setQuestion] = useState(propuesta.question);
  const [answer, setAnswer] = useState(propuesta.answer);
  const [enviando, setEnviando] = useState(false);

  async function decidir(decision: "approve" | "reject") {
    setEnviando(true);
    await onDecidir(
      propuesta.id,
      decision,
      decision === "approve" ? { question, answer } : undefined
    );
    setEnviando(false);
  }

  return (
    <div className="space-y-2 rounded-md border p-4">
      <Input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        aria-label="Pregunta propuesta"
        className="font-medium"
      />
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        aria-label="Respuesta propuesta"
        rows={3}
      />
      {propuesta.evidence && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">De la conversación:</span>{" "}
          &ldquo;{propuesta.evidence}&rdquo;
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={enviando || !question.trim() || !answer.trim()}
          onClick={() => void decidir("approve")}
        >
          Aprobar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={enviando}
          onClick={() => void decidir("reject")}
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}
