import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { CatalogoProductos } from "@/components/catalogo/catalogo-productos";

export const dynamic = "force-dynamic";

/**
 * El catálogo de un negocio de PEDIDOS: productos, grupos de opciones y sus
 * opciones, todo desde aquí — **única fuente**, sin un texto libre aparte que
 * quede sin efecto una vez migrado.
 *
 * Los negocios de CITAS no pasan por aquí: su catálogo vive en Servicios,
 * con duración y quién atiende cada uno, que este núcleo no necesita saber.
 */
export default async function CatalogoPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <CatalogoProductos />;
}
