import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  catalogoATexto,
  extraerCatalogoDeImagen,
  extraerCatalogoDeTexto,
} from "@/server/ai/generador/extraer-catalogo";

export const dynamic = "force-dynamic";

/**
 * Leer la carta del negocio desde una foto, para no teclear 34 productos.
 *
 * **No guarda nada.** La imagen se procesa y se descarta: lo que vuelve es la
 * lista extraída, que el cliente revisa y corrige en pantalla antes de que se
 * escriba una sola fila. Así se evita el problema del almacenamiento de
 * archivos (que no existe) y, sobre todo, se cumple la regla que dejó el
 * incidente de los 12 precios mal cargados del salón: **nada entra al catálogo
 * sin que un humano lo haya visto**.
 */

/**
 * 6 MB de imagen ya en base64 (unos 4,5 MB de foto real). Una foto de móvil
 * cabe de sobra; el tope está para que nadie mande un archivo enorme y tumbe
 * la petición.
 */
const MAX_BASE64 = 6_000_000;

/**
 * Dos entradas, un mismo resultado: una FOTO de la carta, o el TEXTO ya sacado
 * de un PDF.
 *
 * El PDF se abre en el navegador del cliente (`lib/pdf-cliente.ts`): el del
 * salón pesa 36 MB y subirlo entero para leer diez páginas de texto no tiene
 * sentido — aquí llegan solo los KB del texto. Antes se rechazaban los PDF
 * diciéndole al cliente que le tomara una foto a su catálogo de diez páginas.
 */
const cuerpo = z.union([
  z.object({
    /** La imagen en base64, sin el prefijo `data:`. */
    base64: z.string().min(1).max(MAX_BASE64),
    mimeType: z.string().min(1),
  }),
  z.object({ texto: z.string().min(1).max(200_000) }),
]);

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export const POST = withAuth(async (_session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  let resultado;
  if ("texto" in body.data) {
    resultado = await extraerCatalogoDeTexto(body.data.texto);
  } else {
    const mime = body.data.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!TIPOS.includes(mime)) {
      return apiError(
        415,
        "tipo_no_soportado",
        "Podemos leer fotos (JPG, PNG o HEIC) y PDFs. Ese formato no lo reconocemos."
      );
    }
    resultado = await extraerCatalogoDeImagen({
      base64: body.data.base64,
      mimeType: mime,
    });
  }

  if (!resultado.ok) {
    const mensajes: Record<string, string> = {
      sin_ia: "La lectura automática no está disponible ahora mismo.",
      sin_texto: "No pudimos leer nada ahí.",
      formato: "No pudimos entender esa carta.",
      error: "No pudimos leerla.",
    };
    return apiError(
      422,
      resultado.motivo,
      `${mensajes[resultado.motivo] ?? "No pudimos leerla."} Puedes escribir tus productos a mano y seguir sin problema.`
    );
  }

  return Response.json({
    productos: resultado.productos,
    texto: catalogoATexto(resultado.productos),
    // Se devuelve para que la pantalla insista en revisar: la lectura acierta
    // casi siempre, y ese "casi" es exactamente lo que costó 12 precios malos.
    aviso:
      "Revisa la lista antes de continuar: comprueba sobre todo los precios.",
  });
});
