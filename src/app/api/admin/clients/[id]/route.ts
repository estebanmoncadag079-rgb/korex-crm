import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { findOrganization } from "@/server/admin/clients";
import {
  getCredentialsByDisplayPhone,
  normalizePhoneNumber,
  saveYcloudNumber,
} from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /** Número del negocio en E.164 (con o sin '+'); es la clave de enrutamiento. */
  phone: z.string().trim().min(8).max(20),
  wabaId: z.string().trim().max(64).optional(),
});

/**
 * Ata el número de WhatsApp del cliente a su organización: sin esto sus
 * mensajes entrantes no tienen dueño y el envío no sabe con qué número salir.
 */
export const PATCH = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!(await findOrganization(id))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const phone = normalizePhoneNumber(body.data.phone);
  if (phone.length < 8) {
    return apiError(422, "invalid", "Número inválido");
  }

  // El número es único por instancia: si ya es de otro cliente, se rechaza en
  // vez de robárselo (robarlo desviaría sus mensajes entrantes).
  const existing = await getCredentialsByDisplayPhone(phone);
  if (existing && existing.organizationId !== id) {
    return apiError(
      409,
      "duplicate",
      "Ese número ya está conectado a otro cliente"
    );
  }

  await saveYcloudNumber({
    organizationId: id,
    phone,
    wabaId: body.data.wabaId ?? null,
  });
  return Response.json({ ok: true, phone });
});
