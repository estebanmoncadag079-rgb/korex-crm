import { getEnv } from "@/lib/env";

/**
 * Qué modelo hace cada papel. **El único sitio donde se decide.**
 *
 * ## Por qué existe este archivo
 *
 * Hasta el 21-sep-2026 una sola variable, `OPENROUTER_MODEL`, mandaba sobre
 * cuatro trabajos distintos: conversar, transcribir notas de voz, describir
 * imágenes y leer cartas para el catálogo. Cambiar el modelo que conversa
 * cambiaba los otros tres de rebote.
 *
 * Eso salió a la luz al querer mover la conversación a `openai/gpt-5-mini`
 * para bajar el gasto de IA. Ese modelo declara `entrada: text, image, file`
 * — **no acepta audio**. Con la variable única, el cambio habría dejado sin
 * entender los 805 audios al mes (27 al día) que hoy pasan por transcripción
 * en cinco negocios, y sin ningún error visible: el bot simplemente no
 * respondería a lo que le dijeron hablando.
 *
 * ## Los dos papeles
 *
 * - **Conversar** (`OPENROUTER_MODEL`): interpreta al cliente, elige la
 *   acción y redacta la respuesta. Nunca decide precios, estado ni
 *   disponibilidad — de eso manda el backend.
 * - **Leer medios** (`OPENROUTER_TRANSCRIPTION_MODEL`): audio, imágenes y
 *   cartas. Convierte lo que no es texto en texto. **No habla con el
 *   cliente, no elige acciones, no toca el pedido.**
 *
 * Las imágenes y el catálogo van con el audio, no con la conversación,
 * porque son percepción y no diálogo; porque llevan meses probadas leyendo
 * comprobantes de pago colombianos; y porque mover conversación y visión a
 * la vez haría imposible atribuir un fallo a una de las dos.
 *
 * ## Por qué aquí y no en cada archivo
 *
 * Antes cada uno leía `env.OPENROUTER_MODEL` por su cuenta y **en crudo**.
 * La cadena de salvavidas hacía `.trim()` y las rutas de medios no, así que
 * un espacio de más al pegar la variable en el panel —`OPENROUTER_MODEL=
 * openai/gpt-5-mini`, que es justo lo que pasó— habría roto el audio y las
 * imágenes mientras la conversación seguía funcionando. El peor tipo de
 * fallo: el que funciona a medias. Aquí se limpia una vez, para todos.
 */

/** Vacío, espacios o ausente son lo mismo: no hay modelo. */
function limpio(valor: string | undefined): string | undefined {
  const v = valor?.trim();
  return v ? v : undefined;
}

/** El modelo que conversa con el cliente. */
export function modeloQueConversa(): string | undefined {
  return limpio(getEnv().OPENROUTER_MODEL);
}

/**
 * El modelo que lee medios: notas de voz, imágenes y cartas de catálogo.
 *
 * Si no está configurado usa el conversacional —el comportamiento exacto de
 * antes, para no romperle nada a quien no toque la variable— pero **lo dice
 * en voz alta**, porque es justo la trampa que casi entra en producción: el
 * conversacional puede ser sordo y nadie se enteraría hasta que un cliente
 * mandara una nota de voz.
 */
export function modeloQueLeeMedios(): string | undefined {
  const propio = limpio(getEnv().OPENROUTER_TRANSCRIPTION_MODEL);
  if (propio) return propio;

  const deRespaldo = modeloQueConversa();
  if (deRespaldo) {
    console.warn(
      `[modelos] sin OPENROUTER_TRANSCRIPTION_MODEL: los medios usarán el ` +
        `modelo conversacional (${deRespaldo}). Si ese modelo no acepta audio, ` +
        `las notas de voz dejarán de entenderse sin dar ningún error.`
    );
  }
  return deRespaldo;
}

/**
 * El modelo que juzga en el Laboratorio. Si no tiene uno propio, juzga el
 * mismo que conversa — como siempre.
 */
export function modeloQueJuzga(): string | undefined {
  return modeloQueJuezPropio() ?? modeloQueConversa();
}

function modeloQueJuezPropio(): string | undefined {
  return limpio(getEnv().OPENROUTER_JUDGE_MODEL);
}

/**
 * La cadena de la CONVERSACIÓN: el modelo de diario y, detrás, hasta dos
 * salvavidas.
 *
 * Es solo de la conversación a propósito. Un salvavidas conversacional puede
 * ser sordo; si el audio encadenara, el respaldo recibiría un audio que no
 * sabe procesar y el fallo aparecería como "el proveedor falló" en vez de
 * "está mal configurado" — que es lo que de verdad pasaría.
 */
export function cadenaDeSalvavidas(principal: string): string[] {
  const env = getEnv();
  return [principal, env.OPENROUTER_FALLBACK_MODEL, env.OPENROUTER_FALLBACK_MODEL_2]
    .map((m) => limpio(m))
    .filter((m): m is string => Boolean(m));
}

/**
 * El modelo del SALVAVIDAS DE RECUPERACIÓN DE TURNO
 * (`docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md`).
 *
 * Es la MISMA variable que usa `cadenaDeSalvavidas` (`OPENROUTER_FALLBACK_MODEL`)
 * — un solo interruptor, dos consumidores: uno automático dentro de
 * `chatJson` (fallos TÉCNICOS: JSON inválido, Zod, error del proveedor,
 * timeout, respuesta vacía) y uno explícito en
 * `@/server/ai/recuperacion-de-turno` (el ÚNICO fallo SEMÁNTICO evidenciado:
 * un pedido que el backend ya sabe completo y el modelo no cerró).
 *
 * Vacía = el mecanismo de recuperación de turno queda apagado por completo,
 * sin tocar código ni dato — es el rollback de toda la excepción 189.
 */
export function modeloDeRescate(): string | undefined {
  return limpio(getEnv().OPENROUTER_FALLBACK_MODEL);
}
