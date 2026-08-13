import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  catalogoATexto,
  extraerCatalogoDeImagen,
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

const cuerpo = z.object({
  /** La imagen en base64, sin el prefijo `data:`. */
  base64: z.string().min(1).max(MAX_BASE64),
  mimeType: z.string().min(1),
});

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export const POST = withAuth(async (_session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  const mime = body.data.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!TIPOS.includes(mime)) {
    // El PDF se rechaza a propósito y con un mensaje que dice qué hacer: el
    // modelo de visión no lee PDFs, y fallar en silencio dejaría al cliente
    // pensando que su carta "no sirve".
    return apiError(
      415,
      "tipo_no_soportado",
      "Por ahora solo podemos leer fotos (JPG, PNG o HEIC). Si tu carta está en PDF, tómale una foto o una captura de pantalla."
    );
  }

  const resultado = await extraerCatalogoDeImagen({
    base64: body.data.base64,
    mimeType: mime,
  });

  if (!resultado.ok) {
    const mensajes: Record<string, string> = {
      sin_ia: "La lectura automática no está disponible ahora mismo.",
      sin_texto: "No pudimos leer nada en esa imagen.",
      formato: "No pudimos entender la carta de esa foto.",
      error: "No pudimos leer la foto.",
    };
    return apiError(
      422,
      resultado.motivo,
      `${mensajes[resultado.motivo] ?? "No pudimos leer la foto."} Puedes escribir tus productos a mano y seguir sin problema.`
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
