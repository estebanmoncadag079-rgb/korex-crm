import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { findOrganization } from "@/server/admin/clients";
import {
  MAX_BASE64,
  MediaAssetError,
  guardarMediaAsset,
  listMediaAssets,
} from "@/server/media/assets";

export const dynamic = "force-dynamic";

/**
 * Fase 9P, sección 8 — el superadmin necesita ver/subir assets de
 * CUALQUIER organización (para elegir la imagen de un HEADER de plantilla),
 * a diferencia de `/api/media` (siempre scoped a `session.organizationId`
 * del cliente). Reutiliza exactamente la misma lógica de
 * `@/server/media/assets` — no es un storage nuevo, solo un gate de
 * autorización distinto (`withPlatformAdmin` + `organizationId` explícito
 * y validado, en vez de la sesión del cliente).
 *
 * Nunca devuelve `datos` (el base64 crudo): el listado es solo para
 * elegir/previsualizar, no para descargar el archivo entero — la
 * previsualización real usa la URL pública (`GET /api/media/[id]`, ya
 * pública por diseño).
 */

export const GET = withPlatformAdmin(async (_session, req: Request) => {
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) {
    return apiError(422, "invalid", "Falta organizationId");
  }
  if (!(await findOrganization(organizationId))) {
    return apiError(404, "not_found", "Organización no encontrada");
  }
  const fotos = await listMediaAssets(organizationId);
  return Response.json({ fotos });
});

const cuerpo = z
  .object({
    organizationId: z.string().trim().min(1),
    etiqueta: z.string().min(1).max(80),
    kind: z.enum(["producto", "carta", "otro"]),
    entrega: z.enum(["archivo", "enlace", "ambos"]).default("archivo"),
    base64: z.string().min(1).max(MAX_BASE64).optional(),
    mimeType: z.string().min(1).optional(),
    url: z.string().url().startsWith("https://").max(2048).optional(),
  })
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

/** Subir/reemplazar un asset EN NOMBRE de la organización seleccionada — `organizationId` explícito, validado contra la DB antes de tocar nada. */
export const POST = withPlatformAdmin(async (_session, req: Request) => {
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  if (!(await findOrganization(body.data.organizationId))) {
    return apiError(404, "not_found", "Organización no encontrada");
  }

  try {
    const resultado = await guardarMediaAsset(body.data.organizationId, body.data);
    return Response.json(resultado);
  } catch (err) {
    if (err instanceof MediaAssetError) {
      return apiError(415, err.code, err.message);
    }
    throw err;
  }
});
