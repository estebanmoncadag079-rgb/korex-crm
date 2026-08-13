import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";

/**
 * El panel de la agencia se pinta SIEMPRE con la marca de korex.ia.
 *
 * El layout raíz inyecta el acento del tenant activo, y en el CRM eso es lo
 * correcto: mientras un superadmin está dentro de la cuenta de un cliente ve lo
 * mismo que ve él. Pero esta pantalla no es de ningún cliente —es la lista de
 * todos—, y acababa vestida con el color del último negocio en el que se
 * hubiera entrado.
 *
 * Redefinir los mismos tokens basta: al ir después en el documento gana en la
 * cascada, sin `!important` y sin JavaScript. Y como son variables heredadas,
 * repinta la pantalla entera —barra lateral incluida— mientras se está aquí.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: accentCssVariables(DEFAULT_BRANDING.accent),
        }}
      />
      {children}
    </>
  );
}
