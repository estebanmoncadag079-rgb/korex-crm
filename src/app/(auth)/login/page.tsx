import { getEnv } from "@/lib/env";
import { LoginForm } from "@/components/auth/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const whatsapp = getEnv().SUPPORT_WHATSAPP?.replace(/\D/g, "") || null;
  return <LoginForm supportWhatsapp={whatsapp} />;
}
