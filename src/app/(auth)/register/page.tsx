import { redirect } from "next/navigation";
import { isPublicSignupAllowed } from "@/server/auth/registration";
import { RegisterForm } from "@/components/auth/register-form";

export const dynamic = "force-dynamic";

/**
 * Solo sirve para arrancar una instancia vacía. Con la instancia ya en marcha
 * no hay registro público: cada cliente recibe su cuenta creada por la agencia,
 * así que la ruta redirige al login en vez de mostrar un formulario que
 * siempre fallaría.
 */
export default async function RegisterPage() {
  if (!(await isPublicSignupAllowed())) redirect("/login");
  return <RegisterForm />;
}
