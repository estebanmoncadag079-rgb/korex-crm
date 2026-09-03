import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  MAX_BASE64,
  MediaAssetError,
  eliminarMediaAsset,
  guardarMediaAsset,
  listMediaAssets,
} from "@/server/media/assets";

export const dynamic = "force-dynamic";

/**
 * Las fotos que el negocio deja listas para que el agente las envíe.
 *
 * `GET` lista · `POST` sube o reemplaza · `DELETE` borra.
 *
 * La organización sale SIEMPRE de la sesión, nunca del cuerpo: un cliente solo
 * puede tocar sus propias fotos aunque manipule la petición.
 *
 * Fase 9P: la lógica de validación/persistencia se extrajo a
 * `@/server/media/assets` (comportamiento idéntico) para que
 * `/api/admin/media` (superadmin, cross-org) la reutilice sin duplicarla.
 */

const cuerpo = z
  .object({
    /** Cómo la nombra el negocio: es lo que el agente compara. */
    etiqueta: z.string().min(1).max(80),
    kind: z.enum(["producto", "carta", "otro"]),
    /**
     * Cómo se le entrega al cliente. `archivo` por defecto: quien ya subía
     * fotos no tiene que cambiar nada, y el comportamiento es el de siempre.
     */
    entrega: z.enum(["archivo", "enlace", "ambos"]).default("archivo"),
    base64: z.string().min(1).max(MAX_BASE64).optional(),
    mimeType: z.string().min(1).optional(),
    /**
     * El enlace externo. Solo `https`: el cliente lo abre desde WhatsApp, y
     * un `http` lo marca como inseguro o directamente no abre.
     */
    url: z.string().url().startsWith("https://").max(2048).optional(),
  })
  /*
   * Un recurso que no se puede entregar no se guarda. Es la misma regla que
   * la restricción `media_entrega_coherente` de la base y que el refine de
   * `send_image`: comprobar el hecho, no la intención declarada.
   */
  .superRefine((b, ctx) => {
    const conArchivo = b.entrega === "archivo" || b.entrega === "ambos";
    const conEnlace = b.entrega === "enlace" || b.entrega === "ambos";
    if (conArchivo && (!b.base64 || !b.mimeType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["base64"],
        message: `Con entrega "${b.entrega}" hacen falta el archivo y su tipo.`,
      });
    }
    if (conEnlace && !b.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: `Con entrega "${b.entrega}" hace falta el enlace.`,
      });
    }
  });

export const GET = withAuth(async (session) => {
  const fotos = await listMediaAssets(session.organizationId);
  return Response.json({ fotos });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  try {
    const resultado = await guardarMediaAsset(session.organizationId, body.data);
    return Response.json(resultado);
  } catch (err) {
    if (err instanceof MediaAssetError) {
      return apiError(415, err.code, err.message);
    }
    throw err;
  }
});

export const DELETE = withAuth(async (session, req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return apiError(400, "falta_id", "Falta el id de la foto");

  await eliminarMediaAsset(session.organizationId, id);
  return Response.json({ borrada: true });
});
