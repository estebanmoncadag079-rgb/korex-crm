import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Hace que un `<textarea>` crezca (y encoja) en alto para mostrar TODO su texto,
 * en vez de quedarse en un alto fijo con scroll interno.
 *
 * Nació de un pedido del dueño: en el cuestionario de alta, las respuestas
 * largas se cortaban y quedaban con una barra de scroll dentro de la caja. Aquí
 * la caja se adapta a lo que el cliente escribe.
 *
 * Es **opt-in** (`enabled`): las cajas pensadas como un área fija con scroll
 * —pegar un catálogo largo, editar una plantilla— no lo activan y se quedan
 * como estaban.
 *
 * El ajuste corre tras cada render —el `value` controlado cambia al teclear y
 * también al abrir un paso con una respuesta ya guardada, así que crece en ambos
 * casos— y además en `onInput`, para que crezca en el mismo golpe de tecla sin
 * esperar al re-render. Se pone `height: auto` antes de medir para que la caja
 * también ENCOJA cuando el cliente borra texto.
 */
export function useAutoResize(enabled?: boolean) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const ajustar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    if (enabled) ajustar();
  });

  return { ref, ajustar: enabled ? ajustar : undefined };
}
