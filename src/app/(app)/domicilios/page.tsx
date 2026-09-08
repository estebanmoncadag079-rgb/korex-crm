import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { ZonasDomicilio } from "@/components/domicilios/zonas-domicilio";

export const dynamic = "force-dynamic";

/**
 * Las zonas de domicilio de un negocio de PEDIDOS: a qué barrio entrega y por
 * cuánto. Única fuente — sin una lista de tarifas suelta en el texto del
 * cuestionario que quede sin efecto y sin que nadie se entere.
 *
 * Los negocios de CITAS no pasan por aquí: no hacen entregas.
 */
export default async function DomiciliosPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <ZonasDomicilio />;
}
