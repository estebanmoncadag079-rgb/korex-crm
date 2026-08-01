import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { appointmentsEnabledFor } from "@/server/appointments/queries";
import { AppointmentsClient } from "@/components/appointments/appointments-client";

export const dynamic = "force-dynamic";

/** Lista de citas agendadas: solo para clientes con el vertical de citas. */
export default async function AppointmentsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await appointmentsEnabledFor(session.organizationId))) redirect("/inbox");

  return <AppointmentsClient />;
}
