"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarClock,
  KeyRound,
  LogIn,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
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

type Client = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  accounts: number;
  conversations: number;
  unread: number;
  agentEnabled: boolean;
  phone: string | null;
  ownAccount: boolean;
  connectionStatus: "connected" | "reconnect_required" | null;
  appointmentsEnabled: boolean;
};

type Account = {
  id: string;
  name: string;
  email: string;
  role: string;
  isPlatformAdmin: boolean;
};

/** Contraseña temporal legible (sin caracteres ambiguos). */
function generatePassword(): string {
  const alphabet =
    "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function AdminClients({
  activeOrganizationId,
}: {
  activeOrganizationId: string;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<
    { label: string; email: string; password: string } | null
  >(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/admin/clients").catch(() => null);
    setLoading(false);
    if (!res?.ok) return;
    const data = (await res.json()) as { clients: Client[] };
    setClients(data.clients);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function enter(organizationId: string | null) {
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo entrar en esa cuenta");
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <div className="max-w-4xl space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {credentials && (
        <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-4 text-sm">
          <p className="font-medium text-[#3f6b52]">
            {credentials.label} — comparte estos datos ahora (no se vuelven a
            mostrar):
          </p>
          {/* `break-all`: correo y contraseña temporal no caben de una pieza
              en un teléfono y se salían de la tarjeta. */}
          <p className="mt-1.5 break-all text-[#3f6b52]/90">
            Entra en <code>/login</code> con <code>{credentials.email}</code> ·
            contraseña <code>{credentials.password}</code>
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setCredentials(null)}
          >
            Ya los copié
          </Button>
        </div>
      )}

      <NewClientForm
        open={creating}
        onOpenChange={setCreating}
        onCreated={(c) => {
          setCredentials(c);
          void refetch();
        }}
      />

      <div className="space-y-3">
        {loading && (
          <p className="text-sm text-muted-foreground">Cargando clientes…</p>
        )}
        {!loading && clients.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no hay clientes.
          </p>
        )}
        {clients.map((c) => (
          <ClientCard
            key={c.id}
            client={c}
            isActive={c.id === activeOrganizationId}
            onEnter={() => void enter(c.id)}
            onAccountCreated={(cred) => {
              setCredentials(cred);
              void refetch();
            }}
            onDeleted={() => void refetch()}
            onChanged={() => void refetch()}
          />
        ))}
      </div>
    </div>
  );
}

function NewClientForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: { label: string; email: string; password: string }) => void;
}) {
  const [organizationName, setOrganizationName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [needsAppointments, setNeedsAppointments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => onOpenChange(true)}>
        <Plus className="h-4 w-4" />
        Nuevo cliente
      </Button>
    );
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName,
        ownerName,
        ownerEmail,
        password,
        needsAppointments,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear el cliente");
      return;
    }
    onCreated({
      label: `Cuenta de ${organizationName}`,
      email: ownerEmail,
      password,
    });
    setOrganizationName("");
    setOwnerName("");
    setOwnerEmail("");
    setPassword("");
    setPhone("");
    setNeedsAppointments(false);
    onOpenChange(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo cliente</CardTitle>
        <CardDescription>
          Se crea su cuenta aislada (embudo y agente incluidos) y el acceso de
          su dueño. Solo verá sus propias conversaciones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-name">Nombre del negocio</Label>
          <Input
            id="org-name"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="La Churra"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="owner-name">Nombre del dueño</Label>
            <Input
              id="owner-name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-email">Correo del dueño</Label>
            <Input
              id="owner-email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-phone">
            Número de WhatsApp <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="client-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="573155136091"
            inputMode="tel"
          />
          <p className="text-xs text-muted-foreground">
            Sus mensajes entrantes se enrutan por este número. Se puede
            conectar después.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="owner-password">Contraseña temporal</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="owner-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
            />
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => setPassword(generatePassword())}
            >
              Generar
            </Button>
          </div>
        </div>
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Funcionalidades
          </p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={needsAppointments}
              onChange={(e) => setNeedsAppointments(e.target.checked)}
              className="h-4 w-4 accent-primary"
              aria-describedby="needs-appointments-hint"
            />
            ¿Este cliente necesita gestionar citas?
          </label>
          <p id="needs-appointments-hint" className="text-xs text-muted-foreground">
            Actívalo para negocios con agendamiento (peluquería, estética,
            spa…): servicios, especialistas y horarios por cita. Déjalo
            apagado para el flujo normal de pedidos.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              saving ||
              !organizationName.trim() ||
              !ownerName.trim() ||
              !ownerEmail.trim() ||
              password.length < 8
            }
            onClick={() => void submit()}
          >
            {saving ? "Creando…" : "Crear cliente"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ClientCard({
  client,
  isActive,
  onEnter,
  onAccountCreated,
  onDeleted,
  onChanged,
}: {
  client: Client;
  isActive: boolean;
  onEnter: () => void;
  onAccountCreated: (c: {
    label: string;
    email: string;
    password: string;
  }) => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && accounts === null) {
      const res = await fetch(`/api/admin/clients/${client.id}/accounts`).catch(
        () => null
      );
      if (!res?.ok) return;
      const data = (await res.json()) as { accounts: Account[] };
      setAccounts(data.accounts);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Building2 className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              {client.name}
              {isActive && <Badge variant="secondary">Estás aquí</Badge>}
              {client.appointmentsEnabled && (
                <Badge variant="outline" className="gap-1">
                  <CalendarClock className="h-3 w-3" strokeWidth={1.7} />
                  Citas
                </Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {client.phone ? `+${client.phone}` : "Sin número conectado"}
              {client.connectionStatus === "reconnect_required" &&
                " · reconexión pendiente"}
            </p>
          </div>
          {/* En móvil la fila entera envuelve: los dos botones caen juntos
              debajo del nombre en vez de estrangularlo. */}
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => void toggle()}
            >
              <KeyRound className="h-4 w-4" />
              Cuentas
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={onEnter}>
              <LogIn className="h-4 w-4" />
              Entrar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.7} />
            {client.conversations} conversaciones
            {client.unread > 0 && ` · ${client.unread} sin leer`}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" strokeWidth={1.7} />
            {client.accounts} {client.accounts === 1 ? "cuenta" : "cuentas"}
          </span>
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
            Agente {client.agentEnabled ? "activo" : "apagado"}
          </span>
        </div>

        {open && (
          <>
            <AppointmentsToggle
              clientId={client.id}
              enabled={client.appointmentsEnabled}
              onChanged={onChanged}
            />
            <ClientNumber
              clientId={client.id}
              phone={client.phone}
              ownAccount={client.ownAccount}
            />
            <DeleteClient
              client={client}
              isActive={isActive}
              onDeleted={onDeleted}
            />
            <ClientAccounts
              clientId={client.id}
              clientName={client.name}
              accounts={accounts}
              onCreated={(cred, account) => {
                setAccounts((prev) => (prev ? [...prev, account] : [account]));
                onAccountCreated(cred);
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * El vertical de citas se decide al crear el cliente, pero un clic
 * equivocado ahí no debe quedar sin arreglo: este toggle lo corrige después
 * sin tener que recrear el cliente.
 */
function AppointmentsToggle({
  clientId,
  enabled,
  onChanged,
}: {
  clientId: string;
  enabled: boolean;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appointmentsEnabled: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError("No se pudo actualizar");
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Funcionalidades
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => void set(e.target.checked)}
          className="h-4 w-4 accent-primary"
          aria-describedby={`appointments-toggle-hint-${clientId}`}
        />
        Gestiona citas (peluquería, estética, spa…)
      </label>
      <p
        id={`appointments-toggle-hint-${clientId}`}
        className="text-xs text-muted-foreground"
      >
        Enciende o apaga el panel de citas para este cliente sin recrearlo.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ClientNumber({
  clientId,
  phone,
  ownAccount,
}: {
  clientId: string;
  phone: string | null;
  ownAccount: boolean;
}) {
  const [value, setValue] = useState(phone ?? "");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [state, setState] = useState<
    { ok: true; webhookUrl: string | null } | { ok: false; message: string } | null
  >(null);
  /**
   * Las credenciales se guardan y se confirman APARTE del número.
   *
   * Antes había un solo botón, arriba junto al número, y los dos campos de
   * secreto colgando debajo dentro del desplegable. Al guardar se vacían (son
   * contraseñas: no se pueden repintar), pero nada decía qué había entrado —
   * así que parecía que se hubieran borrado, y se reescribían a ciegas una y
   * otra vez. Cada campo tiene ahora su propio guardado y su propio acuse.
   */
  const [credState, setCredState] = useState<
    { ok: true; guardado: string[] } | { ok: false; message: string } | null
  >(null);
  /** Refleja lo recién guardado sin esperar a que la página se recargue. */
  const [conCuentaPropia, setConCuentaPropia] = useState(ownAccount);

  /** El endpoint exige el número, así que va en las dos llamadas. */
  async function enviar(extra: Record<string, string>) {
    return fetch(`/api/admin/clients/${clientId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: value, ...extra }),
    }).catch(() => null);
  }

  async function guardarNumero() {
    setSaving(true);
    setState(null);
    // Sin claves en el cuerpo: corregir el número nunca toca lo ya guardado.
    const res = await enviar({});
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setState({
        ok: false,
        message: data?.error?.message ?? "No se pudo guardar el número",
      });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      webhookUrl?: string | null;
    } | null;
    setState({ ok: true, webhookUrl: data?.webhookUrl ?? null });
  }

  async function guardarCredenciales() {
    const clave = apiKey.trim();
    const secreto = webhookSecret.trim();
    if (!clave && !secreto) return;
    setSavingCreds(true);
    setCredState(null);
    const res = await enviar({
      ...(clave ? { ycloudApiKey: clave } : {}),
      ...(secreto ? { ycloudWebhookSecret: secreto } : {}),
    });
    setSavingCreds(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setCredState({
        ok: false,
        message: data?.error?.message ?? "No se pudieron guardar las claves",
      });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      webhookUrl?: string | null;
    } | null;
    const guardado: string[] = [];
    if (clave) guardado.push("API key");
    if (secreto) guardado.push("secreto del webhook");
    setApiKey("");
    setWebhookSecret("");
    if (clave) setConCuentaPropia(true);
    setCredState({ ok: true, guardado });
    if (data?.webhookUrl) setState({ ok: true, webhookUrl: data.webhookUrl });
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Número de WhatsApp
      </p>
      <p className="text-xs text-muted-foreground">
        Los mensajes que lleguen a este número entran en la bandeja de este
        cliente y de ningún otro.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="573155136091"
          inputMode="tel"
          aria-label="Número de WhatsApp del cliente"
        />
        <Button
          variant="outline"
          className="shrink-0"
          disabled={saving || value.trim().length < 8}
          onClick={() => void guardarNumero()}
        >
          {saving ? "Guardando…" : "Guardar número"}
        </Button>
      </div>
      {state?.ok === true && (
        <p className="text-xs text-[#3f6b52]">Número conectado ✓</p>
      )}
      {state?.ok === false && (
        <p className="text-xs text-destructive">{state.message}</p>
      )}

      <details className="pt-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Cuenta propia de YCloud{" "}
          {conCuentaPropia ? "· configurada ✓" : "· opcional"}
        </summary>
        <div className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">
            Si el cliente trae su propia cuenta de YCloud, paga sus mensajes y
            aporta su cupo de número: no consume ninguno de los tuyos. Déjalo
            vacío para que salga por la cuenta de la agencia.
          </p>
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key del cliente"
            type="password"
            aria-label="API key de YCloud del cliente"
          />
          <Input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="Secreto del webhook (whsec_…)"
            type="password"
            aria-label="Secreto del webhook de YCloud del cliente"
          />
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              className="shrink-0"
              disabled={
                savingCreds || (!apiKey.trim() && !webhookSecret.trim())
              }
              onClick={() => void guardarCredenciales()}
            >
              {savingCreds ? "Guardando…" : "Guardar claves"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Se pueden guardar de una en una; el campo que dejes vacío
              conserva lo que ya había.
            </span>
          </div>
          {credState?.ok === true && (
            <p className="text-xs text-[#3f6b52]">
              Guardado ✓ {credState.guardado.join(" y ")}. Por seguridad los
              campos se vacían: lo guardado sigue ahí aunque no se vea.
            </p>
          )}
          {credState?.ok === false && (
            <p className="text-xs text-destructive">{credState.message}</p>
          )}
          {state?.ok === true && state.webhookUrl && (
            <div className="rounded border bg-background p-2">
              <p className="text-xs text-muted-foreground">
                Pega esta dirección como webhook en la consola de YCloud del
                cliente:
              </p>
              <code className="block break-all text-xs">{state.webhookUrl}</code>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/** Baja de un cliente: destructiva, por eso pide escribir su nombre. */
function DeleteClient({
  client,
  isActive,
  onDeleted,
}: {
  client: Client;
  isActive: boolean;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/admin/clients/${client.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmName }),
    }).catch(() => null);
    setDeleting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo eliminar el cliente");
      return;
    }
    setConfirmName("");
    onDeleted();
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/[0.03] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Eliminar cliente
      </p>
      <p className="text-xs text-muted-foreground">
        Borra sus conversaciones, contactos, embudo, agente y cuentas. No se
        puede deshacer. Escribe <strong>{client.name}</strong> para confirmar.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={client.name}
          aria-label="Confirmar nombre del cliente"
          disabled={isActive}
        />
        <Button
          variant="outline"
          className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={deleting || isActive || confirmName !== client.name}
          onClick={() => void remove()}
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Eliminando…" : "Eliminar"}
        </Button>
      </div>
      {isActive && (
        <p className="text-xs text-muted-foreground">
          Estás dentro de esta cuenta: vuelve a la tuya para poder eliminarla.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ClientAccounts({
  clientId,
  clientName,
  accounts,
  onCreated,
}: {
  clientId: string;
  clientName: string;
  accounts: Account[] | null;
  onCreated: (
    cred: { label: string; email: string; password: string },
    account: Account
  ) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/clients/${clientId}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password, role: "owner" }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      return;
    }
    onCreated(
      { label: `Cuenta de ${clientName}`, email, password },
      {
        id: `tmp_${email}`,
        name,
        email,
        role: "owner",
        isPlatformAdmin: false,
      }
    );
    setName("");
    setEmail("");
    setPassword("");
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      {accounts === null && (
        <p className="text-xs text-muted-foreground">Cargando cuentas…</p>
      )}
      {accounts?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Este cliente todavía no tiene acceso.
        </p>
      )}
      {accounts?.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {a.name}{" "}
            <span className="text-muted-foreground">· {a.email}</span>
          </span>
          <Badge
            className="shrink-0"
            variant={a.role === "owner" ? "default" : "secondary"}
          >
            {a.isPlatformAdmin
              ? "Agencia"
              : a.role === "owner"
                ? "Propietario"
                : "Equipo"}
          </Badge>
        </div>
      ))}

      <div className="grid gap-3 border-t pt-3 md:grid-cols-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          aria-label="Nombre de la cuenta"
        />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo"
          aria-label="Correo de la cuenta"
        />
        <div className="flex gap-2">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            aria-label="Contraseña temporal"
          />
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => setPassword(generatePassword())}
          >
            Generar
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        disabled={
          saving || !name.trim() || !email.trim() || password.length < 8
        }
        onClick={() => void submit()}
      >
        <Plus className="h-4 w-4" />
        {saving ? "Creando…" : "Crear cuenta de acceso"}
      </Button>
    </div>
  );
}
