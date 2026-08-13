/**
 * Una lista de servicios escrita a mano → filas listas para revisar.
 *
 * **Por qué existe**: hasta el 13-ago-2026, un negocio de citas solo podía dar
 * de alta sus servicios de uno en uno, con nombre, precio, duración y categoría
 * por cada uno. El salón tiene 46. Nadie hace eso: se abandona el alta, o se
 * teclea mal — ya pasó, con 12 precios equivocados que nadie vio hasta que
 * apareció el PDF oficial.
 *
 * Esto es el camino sin IA: el dueño pega la lista que ya tiene escrita (de su
 * cuaderno, de un WhatsApp, del PDF) y sale una tabla. Para una foto de la
 * carta está `extraer-catalogo.ts`, que usa el modelo de visión; los dos
 * terminan en la MISMA tabla de revisión, porque la regla no cambia: **nada
 * entra al catálogo sin que un humano lo haya visto**.
 */

export type FilaCatalogo = {
  nombre: string;
  /** En pesos. `null` si en la línea no había un precio legible. */
  precio: number | null;
  /** En minutos. `null` si la línea no lo dice. */
  duracionMin: number | null;
  /** La sección bajo la que venía, si la lista venía agrupada. */
  categoria: string | null;
};

/** "$12.000", "12.000", "12000", "$ 12,000" → 12000 */
function aPesos(texto: string): number | null {
  const limpio = texto.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Una línea es un ENCABEZADO de sección (y no un servicio) si no trae precio y
 * viene marcada como tal: con dos puntos al final o en MAYÚSCULAS. Así
 * "PESTAÑAS" agrupa a las de abajo en vez de colarse como un servicio.
 *
 * Deliberadamente NO se usa "es corta" como señal: "Manicure semipermanente"
 * son dos palabras y es un servicio de pleno derecho. Ante la duda se prefiere
 * dejarlo como servicio — sobra en la tabla y se borra de un clic, mientras que
 * un servicio tragado como encabezado desaparece sin que nadie lo note.
 */
function esEncabezado(linea: string, tienePrecio: boolean): boolean {
  if (tienePrecio) return false;
  const limpia = linea.replace(/[^\p{L}\s]/gu, "").trim();
  if (limpia.length < 3 || limpia.length > 40) return false;
  return linea.trim().endsWith(":") || limpia === limpia.toUpperCase();
}

/**
 * Lee la lista pegada. Nunca lanza: lo que no entienda queda con `null` para
 * que la persona lo complete en la tabla, que es justo lo que se quiere.
 *
 * Acepta lo que la gente escribe de verdad:
 *
 *     PESTAÑAS
 *     Volumen ruso — $150.000 · 180 min
 *     Lifting de pestañas $80.000 (60 minutos)
 *     Cejas en henna - 30000 - 45min
 */
export function leerCatalogoPegado(texto: string): FilaCatalogo[] {
  const filas: FilaCatalogo[] = [];
  let categoria: string | null = null;

  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim().replace(/^[-•*·]\s*/, "");
    if (!linea) continue;

    // La duración se busca ANTES que el precio: "45 min" lleva un número que,
    // si no se saca primero, acabaría de precio en servicios sin precio.
    // Las alternativas van de la más larga a la más corta: con `min` primero,
    // "60 minutos" casaba solo hasta "min" y dejaba un "utos" en el nombre.
    const duracion = linea.match(/(\d{1,3})\s*(?:minutos|mins?|m)\b/i);
    const duracionMin = duracion?.[1] ? Number(duracion[1]) : null;
    const sinDuracion = duracion ? linea.replace(duracion[0], " ") : linea;

    // El precio: con $ delante, o el número más largo que quede suelto.
    const conSimbolo = sinDuracion.match(/\$\s*([\d.,]+)/);
    let precio = conSimbolo?.[1] ? aPesos(conSimbolo[1]) : null;
    if (precio === null) {
      const candidatos = [...sinDuracion.matchAll(/(\d[\d.,]{2,})/g)]
        .map((m) => aPesos(m[1] ?? ""))
        .filter((n): n is number => n !== null);
      precio = candidatos.length ? Math.max(...candidatos) : null;
    }

    if (esEncabezado(linea, precio !== null)) {
      categoria = linea.replace(/:$/, "").trim();
      continue;
    }

    // El nombre es lo que queda al quitar precio, duración y separadores.
    const nombre = sinDuracion
      .replace(/\$\s*[\d.,]+/g, " ")
      .replace(/(?<![\p{L}\d])[\d.,]{3,}(?![\p{L}\d])/gu, " ")
      // Paréntesis que se quedaron vacíos al sacar la duración: "(60 min)".
      .replace(/\(\s*\)/g, " ")
      .replace(/[—–\-·|(),]+\s*$/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s—–\-·|]+|[\s—–\-·|]+$/g, "")
      .trim();

    if (!nombre) continue;
    filas.push({ nombre, precio, duracionMin, categoria });
  }

  return filas;
}
