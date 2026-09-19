/**
 * Reduce una foto a 1280 px de lado mayor y la pasa a JPEG, en el navegador
 * — antes de subirla, para no gastar el límite de `media_asset` (8 MB en
 * base64) ni los datos móviles del cliente con el original de una cámara
 * (3-5 MB).
 *
 * Extraída de `onboarding-wizard.tsx` (Fase 6, imágenes de productos del
 * catálogo) para que `/catalogo` la reutilice tal cual, sin una segunda
 * copia de la misma lógica.
 */
export async function comprimirImagen(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("imagen ilegible"));
      i.src = url;
    });
    const max = 1280;
    const escala = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
