/**
 * Corta el bloque "## Cómo te pagan" ... hasta el siguiente "## " (o el final
 * del texto), y dentro de él quita SOLO la línea "Formas de pago: …" y el
 * bloque "Datos para el pago (…): … <líneas>" — deja el resto del encabezado
 * y las reglas de comportamiento intactas.
 *
 * Extraída de `scripts/migrar-pago.ts` (30-ago-2026) para poder probarla:
 * los scripts en `scripts/` no tienen tests, y esta función necesitaba uno
 * después de un bug real (ver más abajo).
 */
export function quitarPagoDuplicado(
  instructions: string
): { nuevo: string; huboCambio: boolean } {
  const inicio = instructions.indexOf("## Cómo te pagan");
  if (inicio === -1) return { nuevo: instructions, huboCambio: false };
  const siguienteHeader = instructions.indexOf("\n## ", inicio + 1);
  const fin = siguienteHeader === -1 ? instructions.length : siguienteHeader;
  const bloque = instructions.slice(inicio, fin);

  /*
   * "Formas de pago: …" no siempre termina en un salto de línea propio — en
   * la ficha real de Lis venía en el MISMO párrafo que una instrucción de
   * comportamiento ("Si el cliente pregunta…") que hay que conservar. Por
   * eso el corte se hace hasta el primer terminador reconocible de esa
   * frase, no hasta el próximo salto de línea.
   */
  const sinFormas = bloque.replace(
    /Formas de pago:[\s\S]*?(?=Si el cliente|\n\nDatos para el pago|\n## |$)/i,
    ""
  );
  /*
   * `datosDeCuenta` es el texto TAL CUAL lo escribió el negocio en la ficha
   * (`generar.ts`: `pago.datosDeCuenta.trim()`, sin sanear) — puede traer
   * líneas en blanco PROPIAS en medio (una cuenta y, aparte, una llave,
   * separadas por un renglón vacío es un patrón real, no un error de
   * captura). El separador entre bloques de `generar.ts` es ese mismo
   * `\n\n`, así que "corta en la primera línea en blanco" no distingue el
   * final del bloque de una línea en blanco QUE ES PARTE de los datos de
   * cuenta — bug real, encontrado en la ficha de Malía Postres (30-ago-2026):
   * dejaba "LLAVE: @llanos818" huérfano, después de la limpieza, sin
   * contexto de a qué pertenecía.
   *
   * El corte correcto no es por FORMA (líneas en blanco) sino por
   * CONTENIDO: el bloque de datos de cuenta termina donde empieza el
   * siguiente trozo fijo que `generar.ts` concatena — "Pídele la foto del
   * comprobante..." (cuando `compruebaUnaPersona` está declarado) — o donde
   * se acaba la sección completa ya recortada arriba (el próximo `## ` o el
   * final de `bloque`). Mismo criterio de lookahead por contenido conocido
   * que ya usa `sinFormas`, no una heurística sobre saltos de línea.
   */
  const sinDatos = sinFormas.replace(
    /Datos para el pago \(cópialos TAL CUAL[^)]*\):\n[\s\S]*?(?=\n\nPídele la foto del comprobante|\n## |$)/i,
    ""
  );
  // Las dos quitas de arriba pueden dejar 3+ saltos de línea seguidos donde
  // solo debe quedar una línea en blanco entre párrafos.
  const limpio = sinDatos.replace(/\n{3,}/g, "\n\n");

  if (limpio === bloque) return { nuevo: instructions, huboCambio: false };
  return {
    nuevo: instructions.slice(0, inicio) + limpio + instructions.slice(fin),
    huboCambio: true,
  };
}
