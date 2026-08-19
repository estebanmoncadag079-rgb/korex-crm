import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { GruposDeOpciones } from "@/components/catalogo/grupos-de-opciones";

export const dynamic = "force-dynamic";

/**
 * La configuración del catálogo que hasta hoy solo se podía cambiar con un
 * script contra producción.
 *
 * **No se filtra por vertical**: quien tenga grupos de opciones los ve aquí,
 * venda churros, manicuras o cambios de frenos. Si no tiene ninguno, la
 * pantalla lo dice y el menú ni siquiera la ofrece.
 */
export default async function CatalogoPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <GruposDeOpciones />;
}
