import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { LabClient } from "@/components/lab/lab-client";

export const dynamic = "force-dynamic";

/**
 * Solo la agencia (superadmin). Cada corrida cuesta ~33 llamadas al modelo
 * que paga la agencia — dejárselo a un cliente es dejar que gaste el saldo
 * de otro sin límite real. Para probar el agente de un cliente puntual,
 * "Entrar como" ese cliente en /admin y luego venir aquí.
 */
export default async function LabPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (session.platformRole !== "superadmin") redirect("/inbox");

  return <LabClient />;
}
