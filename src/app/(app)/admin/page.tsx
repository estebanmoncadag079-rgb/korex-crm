import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { AdminClients } from "@/components/admin/admin-clients";
import { UsagePanel } from "@/components/admin/usage-panel";
import { Cotizador } from "@/components/admin/cotizador";

export const dynamic = "force-dynamic";

/** Panel de agencia: solo el superadmin de la plataforma. */
export default async function AdminPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (session.platformRole !== "superadmin") redirect("/inbox");

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h2 className="font-semibold">Clientes</h2>
        <p className="text-sm text-muted-foreground">
          Cada cliente es una cuenta aislada: sus conversaciones, contactos y
          agente solo los ve él.
        </p>
      </header>
      <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-6">
        {/* Los clientes van primero: es a lo que se entra al abrir el panel.
            El consumo y el cotizador se consultan de vez en cuando. */}
        <AdminClients activeOrganizationId={session.organizationId} />
        <UsagePanel />
        <Cotizador />
      </div>
    </div>
  );
}
