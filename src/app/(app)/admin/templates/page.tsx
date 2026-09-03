import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { AdminTemplates } from "@/components/admin/admin-templates";

export const dynamic = "force-dynamic";

/** Panel de administración de plantillas: solo el superadmin de la plataforma. */
export default async function AdminTemplatesPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (session.platformRole !== "superadmin") redirect("/inbox");

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="font-semibold">Plantillas</h2>
        <p className="text-sm text-muted-foreground">
          Administración centralizada de plantillas de WhatsApp para todos
          los clientes.
        </p>
        <nav className="mt-3 flex gap-1 text-sm">
          <Link
            href="/admin"
            className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted"
          >
            Clientes
          </Link>
          <span className="rounded-md bg-muted px-3 py-1.5 font-medium">Plantillas</span>
        </nav>
      </header>
      <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        <AdminTemplates />
      </div>
    </div>
  );
}
