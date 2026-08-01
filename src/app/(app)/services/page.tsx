import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { appointmentsEnabledFor } from "@/server/appointments/queries";
import { ServicesClient } from "@/components/services/services-client";

export const dynamic = "force-dynamic";

/** Catálogo de servicios y personal: solo para clientes con el vertical de citas. */
export default async function ServicesPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await appointmentsEnabledFor(session.organizationId))) redirect("/inbox");

  return <ServicesClient />;
}
