/**
 * Leer el texto de un PDF **en el navegador**.
 *
 * El catálogo del salón es un PDF de 36 MB (11 páginas llenas de fotos) y el
 * importador solo aceptaba imágenes: *"tómale una foto o una captura"* a un
 * documento de once páginas no es una respuesta.
 *
 * Se hace en el cliente a propósito: subir 36 MB al servidor para sacar dos
 * páginas de texto sería absurdo, y así el documento del negocio **no sale de
 * su computador** — solo viajan los pocos KB de la lista ya extraída.
 *
 * `pdfjs-dist` se carga con `import()` dinámico: es una librería grande y no
 * tiene por qué pesar en la primera carga de una pantalla que casi siempre se
 * usa sin PDF.
 */

export type TextoDePdf =
  | { ok: true; texto: string; paginas: number }
  | { ok: false; motivo: "sin_texto" | "error" };

/** Un trozo de texto con su posición en la página, como lo da pdf.js. */
export type TrozoDePdf = { str: string; x: number; y: number };

/**
 * Los trozos sueltos de una página → líneas de texto.
 *
 * Un PDF no tiene "líneas": tiene trozos colocados en coordenadas. Hay que
 * reconstruirlas porque el parser del catálogo lee UNA LÍNEA por servicio — si
 * todo llegara seguido, "Volumen ruso $150.000" y el servicio siguiente se
 * fundirían en una sola fila con dos precios.
 *
 * Va aparte y sin tocar el DOM para poder probarla contra un PDF de verdad.
 */
export function agruparEnLineas(trozos: TrozoDePdf[]): string[] {
  const porFila = new Map<number, { x: number; texto: string }[]>();

  for (const t of trozos) {
    if (!t.str.trim()) continue;
    const y = Math.round(t.y);
    // Tolerancia de 2 puntos: dos trozos de la misma línea rara vez comparten
    // la Y exacta.
    const clave = [...porFila.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    const fila = porFila.get(clave) ?? [];
    fila.push({ x: t.x, texto: t.str });
    porFila.set(clave, fila);
  }

  return [...porFila.entries()]
    // De arriba abajo: en un PDF la Y crece hacia arriba.
    .sort((a, b) => b[0] - a[0])
    .map(([, trozosDeFila]) =>
      trozosDeFila
        .sort((a, b) => a.x - b.x)
        .map((t) => t.texto)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter(Boolean);
}

/**
 * Todo el texto del PDF, página a página.
 *
 * `sin_texto` no es un fallo: significa que el PDF es un escaneo (una foto
 * dentro de un PDF) y que hay que pasarlo por el lector de imágenes, que es
 * justo lo que hace quien llama a esto.
 */
export async function textoDePdf(archivo: File): Promise<TextoDePdf> {
  try {
    const pdfjs = await import("pdfjs-dist");
    // El worker se copia a `public/` en cada build (scripts/copiar-worker-pdf.mjs).
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const datos = new Uint8Array(await archivo.arrayBuffer());
    // `destroy()` vive en la tarea de carga, no en el documento: hay que
    // guardarla para poder soltar el worker al terminar.
    const tarea = pdfjs.getDocument({ data: datos });
    const doc = await tarea.promise;
    const paginas = doc.numPages;

    const partes: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      const trozos: TrozoDePdf[] = [];
      for (const item of contenido.items) {
        if (!("str" in item)) continue;
        const t = item.transform as number[];
        trozos.push({ str: item.str, x: t[4] ?? 0, y: t[5] ?? 0 });
      }

      partes.push(agruparEnLineas(trozos).join("\n"));
      pagina.cleanup();
    }

    const texto = partes.join("\n").trim();
    await tarea.destroy();

    if (!texto) return { ok: false, motivo: "sin_texto" };
    return { ok: true, texto, paginas };
  } catch {
    return { ok: false, motivo: "error" };
  }
}

/**
 * La primera página del PDF como PNG, para cuando NO trae texto.
 *
 * Un catálogo escaneado es una imagen dentro de un PDF: se rasteriza y se manda
 * al mismo lector de visión que ya lee las fotos de las cartas. Se limita a la
 * primera página a propósito — una llamada al modelo por página multiplicaría
 * el costo sin avisar, y el que tenga un escaneo de once páginas mejor que
 * suba las fotos que quiera, una a una.
 */
export async function primeraPaginaComoPng(
  archivo: File
): Promise<{ base64: string } | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const datos = new Uint8Array(await archivo.arrayBuffer());
    const tarea = pdfjs.getDocument({ data: datos });
    const doc = await tarea.promise;
    const pagina = await doc.getPage(1);

    // Escala 2: suficiente para que el modelo lea precios pequeños sin generar
    // una imagen que no quepa en el límite de la petición.
    const viewport = pagina.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    await pagina.render({ canvas, canvasContext: ctx, viewport }).promise;
    const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
    await tarea.destroy();
    return base64 ? { base64 } : null;
  } catch {
    return null;
  }
}
