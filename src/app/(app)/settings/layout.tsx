import { getSessionOrNull } from "@/lib/auth/session";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h2 className="font-semibold">Configuración</h2>
      </header>
      <div className="flex min-h-0 flex-1">
        <SettingsNav esAgencia={session?.platformRole === "superadmin"} />
        <div className="min-w-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
