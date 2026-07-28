import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";

export const dynamic = "force-dynamic";

/**
 * Conectar el número es cosa de la agencia. Aquí se sobrescriben las
 * credenciales con las que el bot del cliente sale a WhatsApp: si él las toca,
 * su bot deja de responder y nada en la pantalla le dice por qué.
 * Ocultar el enlace no basta — la URL se puede escribir a mano.
 */
export default async function WhatsappSettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (session.platformRole !== "superadmin") redirect("/settings/branding");

  return <WhatsappWizard />;
}
