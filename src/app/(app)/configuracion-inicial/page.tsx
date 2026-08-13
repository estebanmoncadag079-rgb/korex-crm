import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * La configuración inicial del negocio, que contesta el propio cliente.
 *
 * Vive dentro de su cuenta y no en `/admin` a propósito: quien mejor conoce el
 * menú, el horario y las reglas del negocio es su dueño. Antes esto era un Word
 * que alguien de la agencia transcribía a mano, y esa transcripción era el
 * cuello de botella que impedía crecer.
 *
 * ⚠️ **`h-full overflow-y-auto` no es decorativo**: el armazón de `(app)` es
 * `overflow-hidden` y cada pantalla hace su propio scroll. Sin esto, el
 * formulario se corta por abajo y **los botones de Atrás/Siguiente quedan fuera
 * de la vista** — el cliente ve las preguntas y no puede avanzar. Pasó en la
 * primera versión. `pb-10` deja aire bajo el último botón, que si no queda
 * pegado al borde.
 */
export default async function ConfiguracionInicialPage() {
  await requireSession();
  return (
    <div className="h-full overflow-y-auto p-4 pb-10 md:p-6 md:pb-12">
      <div className="mx-auto mb-6 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cuéntanos sobre tu negocio
        </h1>
        <p className="mt-1 text-muted-foreground">
          Con esto configuramos tu asistente de WhatsApp. No hace falta que sepas
          de tecnología: responde con tus palabras y lo que no sepas lo hablamos
          después. Puedes salir y seguir en otro momento.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
