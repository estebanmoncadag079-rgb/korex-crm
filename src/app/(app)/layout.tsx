import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import { AppNav } from "@/components/app-nav";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });

  return (
    /*
     * `dvh` en vez de `vh` donde el navegador lo soporte: en Safari de iOS
     * 100vh mide la pantalla COMO SI no hubiera barra de direcciones, y en un
     * armazón que no hace scroll (overflow-hidden) eso deja los últimos ~50px
     * debajo de la barra del navegador — justo donde vive el cuadro para
     * escribir la respuesta. `dvh` mide lo que de verdad se ve.
     */
    <div className="flex h-screen overflow-hidden bg-background supports-[height:100dvh]:h-[100dvh]">
      <AppNav
        branding={branding}
        userName={authSession?.user.name ?? "Usuario"}
        role={session.role}
        isPlatformAdmin={session.platformRole === "superadmin"}
      />
      {/* `pt-12` compensa la barra superior fija de móvil que dibuja AppNav
          (h-12); en escritorio no existe y el contenido vuelve arriba del todo. */}
      <div className="flex min-w-0 flex-1 flex-col pt-12 md:pt-0">
        {session.impersonating && (
          <ImpersonationBanner clientName={branding.name} />
        )}
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
