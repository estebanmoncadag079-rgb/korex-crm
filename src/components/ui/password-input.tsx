"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

/**
 * Campo de contraseña con el ojo para verla.
 *
 * No es un adorno: escribir a ciegas una clave dictada por teléfono —que es
 * como se entregan aquí, sin correo de por medio— hace que un error de una
 * letra parezca "no me deja entrar". Ver lo que se teclea evita ese soporte.
 *
 * Vale igual para las claves de API y los secretos de webhook: se pegan desde
 * otra pantalla y lo único que se quiere comprobar es que se pegó entero.
 *
 * El botón queda **fuera del orden de tabulación** (`tabIndex={-1}`): quien
 * llega al campo con el teclado espera que el siguiente tabulador lo lleve a
 * enviar el formulario, no a un interruptor.
 */
export function PasswordInput({
  className,
  id,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="relative">
      <Input
        id={inputId}
        type={visible ? "text" : "password"}
        // Sitio para el botón, para que el texto largo no pase por debajo.
        className={cn("pr-10", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Ver contraseña"}
        aria-pressed={visible}
        aria-controls={inputId}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={1.7} />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={1.7} />
        )}
      </button>
    </div>
  );
}
