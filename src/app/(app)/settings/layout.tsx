import { getSessionOrNull } from "@/lib/auth/session";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3.5 md:px-6 md:py-4">
        <h2 className="font-semibold">Configuración</h2>
      </header>
      {/* En móvil las secciones se apilan: la navegación pasa a ser una fila
          de pestañas arriba en vez de una columna que roba 176px de ancho. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SettingsNav esAgencia={session?.platformRole === "superadmin"} />
        {/* `min-h-0` es lo que deja al panel encogerse dentro de la columna en
            móvil: sin él, un formulario largo crece hasta salirse y el botón
            de guardar queda fuera de alcance. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
