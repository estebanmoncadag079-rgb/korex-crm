"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Send, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type TemplateStatus = "draft" | "pending" | "approved" | "rejected";

/** Fase 9P — header/footer opcionales, espejo de `TemplateComponents` (server, `template-validation.ts`). */
type HeaderComponent =
  | { type: "NONE" }
  | { type: "TEXT"; text: string }
  | { type: "IMAGE"; mediaAssetId: string };

type TemplateComponents = {
  header: HeaderComponent;
  footer: { text: string } | null;
};

type AdminTemplate = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: TemplateStatus;
  provider: string | null;
  providerStatus: string | null;
  providerLastSyncAt: string | null;
  rejectionReason: string | null;
  waTemplateId: string | null;
  components: TemplateComponents | null;
  createdAt: string;
  updatedAt: string;
};

type Organizacion = { id: string; name: string };

type MediaAssetOption = { id: string; etiqueta: string; mimeType: string | null; tamano: number | null };

const STATUS_BADGE: Record<
  TemplateStatus,
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending: { label: "Pendiente", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

const CATEGORIAS = ["UTILITY", "MARKETING"] as const;
const IDIOMAS = ["es_MX", "es", "es_AR", "en_US"] as const;

function contarVariables(body: string): number {
  return (body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
}

function renderizarPreview(body: string, valor: string): string {
  return body.replace(/\{\{\s*1\s*\}\}/g, valor.trim() || "___");
}

/**
 * Espejo deliberado de `estadoSubmitYCloud()` (server, `templates.ts`) —
 * misma lógica, solo para decidir qué mostrar en la UI a partir de los
 * campos ya expuestos por el listado admin. No hay una segunda fuente de
 * verdad: si el backend cambia esa lógica, este espejo debe actualizarse
 * junto con él (Fase 9M).
 */
function estadoSubmitCliente(
  t: AdminTemplate
): "nunca_sometido" | "pendiente_reconciliar" | "fallo_explicito" | "creado" {
  if (t.waTemplateId) return "creado";
  if (!t.provider || !t.providerLastSyncAt) return "nunca_sometido";
  return t.rejectionReason ? "fallo_explicito" : "pendiente_reconciliar";
}

async function leerError(res: Response | null): Promise<string> {
  const data = (await res?.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? "Algo salió mal";
}

export function AdminTemplates() {
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroOrg, setFiltroOrg] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroProvider, setFiltroProvider] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [creando, setCreando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensajeSync, setMensajeSync] = useState<string | null>(null);
  const [editando, setEditando] = useState<AdminTemplate | null>(null);
  const [detalle, setDetalle] = useState<AdminTemplate | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filtroOrg) params.set("organizationId", filtroOrg);
    if (filtroStatus) params.set("status", filtroStatus);
    if (filtroProvider) params.set("provider", filtroProvider);
    if (busqueda.trim()) params.set("q", busqueda.trim());
    const res = await fetch(`/api/admin/templates?${params.toString()}`).catch(
      () => null
    );
    setLoading(false);
    if (!res?.ok) return;
    const data = (await res.json()) as { templates: AdminTemplate[] };
    setTemplates(data.templates);
  }, [filtroOrg, filtroStatus, filtroProvider, busqueda]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  /**
   * Trae a Korex las plantillas que el cliente creó y aprobó DIRECTAMENTE en
   * YCloud. Hasta el 15-sep-2026 el endpoint existía pero no había forma de
   * dispararlo desde la interfaz: había que llamarlo por código, así que en
   * la práctica las plantillas aprobadas no llegaban nunca.
   *
   * Pide una organización concreta a propósito: el endpoint sincroniza
   * contra el WABA de UN cliente, y hacerlo "para todos" a ciegas
   * multiplicaría llamadas al proveedor sin que nadie las haya pedido.
   */
  async function traerDeYCloud() {
    if (!filtroOrg) {
      setMensajeSync("Elige primero un cliente en el filtro de arriba.");
      return;
    }
    setSincronizando(true);
    setMensajeSync(null);
    const res = await fetch("/api/admin/templates/sync-ycloud", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: filtroOrg }),
    }).catch(() => null);
    setSincronizando(false);
    if (!res?.ok) {
      setMensajeSync(await leerError(res));
      return;
    }
    const r = (await res.json()) as {
      creadas: number;
      actualizadas: number;
      marcadasAusentes: number;
      total: number;
    };
    setMensajeSync(
      `${r.total} plantilla(s) en YCloud · ${r.creadas} nueva(s), ` +
        `${r.actualizadas} actualizada(s), ${r.marcadasAusentes} ya no está(n) allá.`
    );
    void refetch();
  }

  useEffect(() => {
    // Reutiliza el listado ya existente de clientes (mismo patrón que el
    // resto del panel de agencia) en vez de un endpoint nuevo solo para esto.
    fetch("/api/admin/clients")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { clients: Organizacion[] } | null) => {
        if (data) setOrganizaciones(data.clients);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Administración centralizada: solo Korex crea y envía plantillas a
          aprobación. Cada cliente solo ve sus plantillas ya aprobadas desde
          su propia configuración.
        </p>
        {!creando && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void traerDeYCloud()}
              disabled={sincronizando}
              title="Trae las plantillas que el cliente creó y aprobó directamente en YCloud"
            >
              <RefreshCw
                className={`h-4 w-4 ${sincronizando ? "animate-spin" : ""}`}
              />
              {sincronizando ? "Trayendo…" : "Traer de YCloud"}
            </Button>
            <Button onClick={() => setCreando(true)}>
              <Plus className="h-4 w-4" />
              Nuevo borrador
            </Button>
          </div>
        )}
      </div>

      {mensajeSync && (
        <p className="text-sm text-muted-foreground" role="status">
          {mensajeSync}
        </p>
      )}

      {creando && (
        <TemplateForm
          mode="create"
          organizaciones={organizaciones}
          onCancel={() => setCreando(false)}
          onSaved={() => {
            setCreando(false);
            void refetch();
          }}
        />
      )}

      {editando && (
        <TemplateForm
          mode="edit"
          template={editando}
          organizaciones={organizaciones}
          onCancel={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            void refetch();
          }}
        />
      )}

      <Filtros
        organizaciones={organizaciones}
        filtroOrg={filtroOrg}
        setFiltroOrg={setFiltroOrg}
        filtroStatus={filtroStatus}
        setFiltroStatus={setFiltroStatus}
        filtroProvider={filtroProvider}
        setFiltroProvider={setFiltroProvider}
        busqueda={busqueda}
        setBusqueda={setBusqueda}
      />

      <TemplatesTable
        templates={templates}
        loading={loading}
        onVer={(t) => setDetalle(t)}
        onEditar={(t) => setEditando(t)}
        onVerificar={async (t) => {
          await verificarEstado(t.id, t.organizationId);
          void refetch();
        }}
      />

      {detalle && (
        <TemplateDetailModal
          template={detalle}
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

async function verificarEstado(templateId: string, organizationId: string) {
  await fetch(`/api/admin/templates/${templateId}/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId }),
  }).catch(() => null);
}

function Filtros({
  organizaciones,
  filtroOrg,
  setFiltroOrg,
  filtroStatus,
  setFiltroStatus,
  filtroProvider,
  setFiltroProvider,
  busqueda,
  setBusqueda,
}: {
  organizaciones: Organizacion[];
  filtroOrg: string;
  setFiltroOrg: (v: string) => void;
  filtroStatus: string;
  setFiltroStatus: (v: string) => void;
  filtroProvider: string;
  setFiltroProvider: (v: string) => void;
  busqueda: string;
  setBusqueda: (v: string) => void;
}) {
  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm";
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor="filtro-org">Organización</Label>
        <select
          id="filtro-org"
          value={filtroOrg}
          onChange={(e) => setFiltroOrg(e.target.value)}
          className={selectClass}
        >
          <option value="">Todas</option>
          {organizaciones.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="filtro-status">Estado</Label>
        <select
          id="filtro-status"
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className={selectClass}
        >
          <option value="">Todos</option>
          <option value="draft">Borrador</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Aprobada</option>
          <option value="rejected">Rechazada</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="filtro-provider">Proveedor</Label>
        <select
          id="filtro-provider"
          value={filtroProvider}
          onChange={(e) => setFiltroProvider(e.target.value)}
          className={selectClass}
        >
          <option value="">Todos</option>
          <option value="ycloud">YCloud</option>
          <option value="graph">Graph</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="filtro-q">Buscar por nombre</Label>
        <Input
          id="filtro-q"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="confirmacion_pedido"
        />
      </div>
    </div>
  );
}

function TemplatesTable({
  templates,
  loading,
  onVer,
  onEditar,
  onVerificar,
}: {
  templates: AdminTemplate[];
  loading: boolean;
  onVer: (t: AdminTemplate) => void;
  onEditar: (t: AdminTemplate) => void;
  onVerificar: (t: AdminTemplate) => void;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando plantillas…</p>;
  }
  if (templates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Sin plantillas con estos filtros. Crea un borrador arriba.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3">Organización</th>
            <th className="p-3">Nombre</th>
            <th className="p-3">Categoría</th>
            <th className="p-3">Idioma</th>
            <th className="p-3">Estado Korex</th>
            <th className="p-3">Estado proveedor</th>
            <th className="p-3">Última sincronización</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => {
            const estado = estadoSubmitCliente(t);
            const pendienteReconciliar = t.status === "draft" && estado === "pendiente_reconciliar";
            return (
              <tr key={t.id} className="border-b last:border-0">
                <td className="max-w-[160px] truncate p-3">{t.organizationName}</td>
                <td className="max-w-[200px] truncate p-3 font-mono">{t.name}</td>
                <td className="p-3">{t.category}</td>
                <td className="p-3">{t.language}</td>
                <td className="p-3">
                  {pendienteReconciliar ? (
                    <Badge variant="warning">Pendiente de verificación</Badge>
                  ) : (
                    <Badge variant={STATUS_BADGE[t.status].variant}>
                      {STATUS_BADGE[t.status].label}
                    </Badge>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {t.providerStatus ?? "—"}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {t.providerLastSyncAt
                    ? new Date(t.providerLastSyncAt).toLocaleString()
                    : "—"}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {t.status === "draft" && !pendienteReconciliar && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => onEditar(t)}>
                          Editar
                        </Button>
                        <Button size="sm" onClick={() => onVer(t)}>
                          Enviar
                        </Button>
                      </>
                    )}
                    {(t.status === "pending" || pendienteReconciliar) && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => onVer(t)}>
                          Ver
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onVerificar(t)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Verificar estado
                        </Button>
                      </>
                    )}
                    {(t.status === "approved" || t.status === "rejected") && (
                      <Button variant="outline" size="sm" onClick={() => onVer(t)}>
                        Ver
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TemplateForm({
  mode,
  template,
  organizaciones,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  template?: AdminTemplate;
  organizaciones: Organizacion[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [organizationId, setOrganizationId] = useState(template?.organizationId ?? "");
  const [name, setName] = useState(template?.name ?? "");
  const [language, setLanguage] = useState(template?.language ?? "es_MX");
  const [category, setCategory] = useState<(typeof CATEGORIAS)[number]>(
    (template?.category as (typeof CATEGORIAS)[number]) ?? "UTILITY"
  );
  const [body, setBody] = useState(template?.body ?? "");
  const [variableExample, setVariableExample] = useState("");
  // Fase 9P — header/footer opcionales.
  const [headerTipo, setHeaderTipo] = useState<"NONE" | "IMAGE">(
    template?.components?.header.type === "IMAGE" ? "IMAGE" : "NONE"
  );
  const [headerMediaAssetId, setHeaderMediaAssetId] = useState(
    template?.components?.header.type === "IMAGE" ? template.components.header.mediaAssetId : ""
  );
  const [footerText, setFooterText] = useState(template?.components?.footer?.text ?? "");
  const [assets, setAssets] = useState<MediaAssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tieneVariable = contarVariables(body) === 1;

  useEffect(() => {
    if (headerTipo !== "IMAGE" || !organizationId) {
      setAssets([]);
      return;
    }
    setLoadingAssets(true);
    fetch(`/api/admin/media?organizationId=${encodeURIComponent(organizationId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { fotos: MediaAssetOption[] } | null) => setAssets(data?.fotos ?? []))
      .catch(() => setAssets([]))
      .finally(() => setLoadingAssets(false));
  }, [headerTipo, organizationId]);

  function construirComponents(): TemplateComponents | null {
    if (headerTipo === "NONE" && !footerText.trim()) return null;
    return {
      header:
        headerTipo === "IMAGE" && headerMediaAssetId
          ? { type: "IMAGE", mediaAssetId: headerMediaAssetId }
          : { type: "NONE" },
      footer: footerText.trim() ? { text: footerText.trim() } : null,
    };
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const components = construirComponents();
    const res =
      mode === "create"
        ? await fetch("/api/admin/templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId, name, language, category, body, components }),
          }).catch(() => null)
        : await fetch(`/api/admin/templates/${template!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              organizationId: template!.organizationId,
              name,
              language,
              category,
              body,
              components,
            }),
          }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(await leerError(res));
      return;
    }
    onSaved();
  }

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "Nuevo borrador" : "Editar borrador"}</CardTitle>
        <CardDescription>
          Cuerpo con máximo UNA variable <code>{"{{1}}"}</code>. Se guarda como
          borrador local — no se envía a ningún proveedor todavía.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tf-org">Organización</Label>
            <select
              id="tf-org"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              disabled={mode === "edit"}
              className={selectClass}
            >
              <option value="">Selecciona una organización</option>
              {organizaciones.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tf-name">Nombre</Label>
            <Input
              id="tf-name"
              placeholder="confirmacion_pedido"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tf-cat">Categoría</Label>
            <select
              id="tf-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CATEGORIAS)[number])}
              className={selectClass}
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tf-lang">Idioma</Label>
            <select
              id="tf-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={selectClass}
            >
              {IDIOMAS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tf-body">Contenido</Label>
          <Textarea
            id="tf-body"
            rows={3}
            placeholder="Hola {{1}}, tenemos una promoción especial."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {tieneVariable && (
          <div className="space-y-1.5">
            <Label htmlFor="tf-var">Ejemplo de variable {"{{1}}"}</Label>
            <Input
              id="tf-var"
              placeholder="Esteban"
              value={variableExample}
              onChange={(e) => setVariableExample(e.target.value)}
            />
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tf-header">Encabezado</Label>
            <select
              id="tf-header"
              value={headerTipo}
              onChange={(e) => {
                setHeaderTipo(e.target.value as "NONE" | "IMAGE");
                setHeaderMediaAssetId("");
              }}
              disabled={!organizationId}
              className={selectClass}
            >
              <option value="NONE">Sin encabezado</option>
              <option value="IMAGE">Imagen</option>
            </select>
          </div>
          {headerTipo === "IMAGE" && (
            <div className="space-y-1.5">
              <Label htmlFor="tf-header-asset">Imagen (de la organización elegida)</Label>
              <select
                id="tf-header-asset"
                value={headerMediaAssetId}
                onChange={(e) => setHeaderMediaAssetId(e.target.value)}
                className={selectClass}
              >
                <option value="">
                  {loadingAssets ? "Cargando imágenes…" : "Selecciona una imagen"}
                </option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.etiqueta}
                  </option>
                ))}
              </select>
              {!loadingAssets && organizationId && assets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Esta organización no tiene fotos guardadas todavía.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tf-footer">Pie de página (opcional)</Label>
          <Input
            id="tf-footer"
            placeholder="Korex.IA"
            maxLength={60}
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
          />
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Vista previa
          </p>
          {headerTipo === "IMAGE" && (
            <p className="mt-1 text-xs text-muted-foreground">
              [IMAGEN
              {headerMediaAssetId
                ? `: ${assets.find((a) => a.id === headerMediaAssetId)?.etiqueta ?? headerMediaAssetId}`
                : ""}
              ]
            </p>
          )}
          <p className="mt-1 text-sm">
            {body.trim()
              ? renderizarPreview(body, variableExample)
              : "Escribe el contenido para ver la vista previa"}
          </p>
          {footerText.trim() && (
            <p className="mt-1 text-xs text-muted-foreground">{footerText.trim()}</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            disabled={saving || !organizationId || !name.trim() || !body.trim()}
            onClick={() => void submit()}
          >
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

function TemplateDetailModal({
  template,
  onClose,
  onChanged,
}: {
  template: AdminTemplate;
  onClose: () => void;
  onChanged: (actualizado: AdminTemplate) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [variableExample, setVariableExample] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const estado = estadoSubmitCliente(template);
  const pendienteReconciliar = template.status === "draft" && estado === "pendiente_reconciliar";
  const tieneVariable = contarVariables(template.body) === 1;

  async function enviarAAprobacion() {
    setSaving(true);
    setError(null);
    setAviso(null);
    const res = await fetch(`/api/admin/templates/${template.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: template.organizationId,
        ...(variableExample.trim() ? { variableExample: variableExample.trim() } : {}),
      }),
    }).catch(() => null);
    setSaving(false);
    setConfirmando(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      // AMBIGUOUS/reconciliation_required: nunca se muestra como éxito ni
      // como aprobada — se refleja tal cual (Fase 9M, sección 15).
      if (data?.error?.code === "meta_unavailable") {
        setAviso("Resultado pendiente de verificación — YCloud no confirmó el envío con certeza.");
        onChanged({ ...template, provider: "ycloud", providerLastSyncAt: new Date().toISOString() });
        return;
      }
      setError(data?.error?.message ?? "No se pudo enviar a aprobación");
      return;
    }
    const data = (await res.json()) as { template: AdminTemplate };
    onChanged(data.template);
  }

  async function verificar() {
    setVerifying(true);
    setError(null);
    setAviso(null);
    const res = await fetch(`/api/admin/templates/${template.id}/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: template.organizationId }),
    }).catch(() => null);
    setVerifying(false);
    if (!res?.ok) {
      setError(await leerError(res));
      return;
    }
    const data = (await res.json()) as {
      reconciliation: "confirmado" | "no_encontrado_reintentable" | "pendiente";
      template: AdminTemplate;
    };
    if (data.reconciliation === "pendiente") {
      setAviso("Sigue pendiente de verificación — vuelve a intentarlo más tarde.");
    } else if (data.reconciliation === "no_encontrado_reintentable") {
      setAviso("YCloud no tiene esta plantilla — ya se puede reintentar el envío.");
    }
    onChanged(data.template);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="font-mono">{template.name}</CardTitle>
            <CardDescription>{template.organizationName}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {pendienteReconciliar ? (
              <Badge variant="warning">Resultado pendiente de verificación</Badge>
            ) : (
              <Badge variant={STATUS_BADGE[template.status].variant}>
                {STATUS_BADGE[template.status].label}
              </Badge>
            )}
            {template.providerStatus && (
              <Badge variant="outline">Proveedor: {template.providerStatus}</Badge>
            )}
            {template.provider && <Badge variant="outline">{template.provider}</Badge>}
          </div>

          <div className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">Categoría:</span> {template.category}
            </p>
            <p>
              <span className="text-muted-foreground">Idioma:</span> {template.language}
            </p>
            <div className="rounded-md border bg-muted/30 p-3">
              {template.components?.header.type === "IMAGE" && (
                <p className="text-xs text-muted-foreground">[IMAGEN]</p>
              )}
              {template.components?.header.type === "TEXT" && (
                <p className="text-xs font-medium">{template.components.header.text}</p>
              )}
              <p className="whitespace-pre-wrap">{template.body}</p>
              {template.components?.footer && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {template.components.footer.text}
                </p>
              )}
            </div>
          </div>

          {template.status === "rejected" && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.03] p-3 text-sm text-destructive">
              Motivo del rechazo:{" "}
              {template.rejectionReason ?? "Sin detalle del proveedor"}
            </p>
          )}

          {template.status === "draft" && !pendienteReconciliar && (
            <div className="space-y-3 rounded-md border p-4">
              {tieneVariable && (
                <div className="space-y-1.5">
                  <Label htmlFor="td-var">Ejemplo de variable {"{{1}}"}</Label>
                  <Input
                    id="td-var"
                    value={variableExample}
                    onChange={(e) => setVariableExample(e.target.value)}
                    placeholder="Esteban"
                  />
                </div>
              )}
              {!confirmando ? (
                <Button
                  disabled={tieneVariable && !variableExample.trim()}
                  onClick={() => setConfirmando(true)}
                >
                  <Send className="h-4 w-4" />
                  Enviar a aprobación
                </Button>
              ) : (
                <div className="space-y-3 rounded-md border border-primary/40 bg-primary/[0.04] p-3">
                  <p className="text-sm font-medium">
                    ¿Confirmas el envío de esta plantilla a aprobación?
                  </p>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    <li>Organización: {template.organizationName}</li>
                    <li>Nombre: {template.name}</li>
                    <li>Categoría: {template.category}</li>
                    <li>Idioma: {template.language}</li>
                    <li>Contenido: {renderizarPreview(template.body, variableExample)}</li>
                  </ul>
                  <div className="flex gap-2">
                    <Button disabled={saving} onClick={() => void enviarAAprobacion()}>
                      {saving ? "Enviando…" : "Confirmar y enviar"}
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmando(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(template.status === "pending" || pendienteReconciliar) && (
            <Button variant="outline" disabled={verifying} onClick={() => void verificar()}>
              <RefreshCw className={`h-4 w-4 ${verifying ? "animate-spin" : ""}`} />
              {verifying ? "Verificando…" : "Verificar estado"}
            </Button>
          )}

          {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
