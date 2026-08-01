import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { listClients } from "@/server/admin/clients";
import {
  createClientWithOwner,
  ProvisioningError,
} from "@/server/auth/provisioning";
import {
  getCredentialsByDisplayPhone,
  normalizePhoneNumber,
  saveYcloudNumber,
} from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

/** Lista de clientes (organizaciones) con métricas de cabecera. */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ clients: await listClients() });
});

const createSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(40).optional(),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().email(),
  password: z.string().min(8).max(128),
  /** Número del negocio (opcional): se puede conectar después. */
  phone: z.string().trim().max(20).optional(),
  /** true = vertical de citas (peluquería, estética…) en vez de pedidos. */
  needsAppointments: z.boolean().optional().default(false),
});

/**
 * Alta de cliente: organización sembrada (embudo + agente) y su cuenta
 * propietaria. La contraseña temporal se muestra una vez y se entrega a mano.
 */
export const POST = withPlatformAdmin(async (_session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  // El número se valida ANTES de crear nada: si ya es de otro cliente, se
  // aborta el alta en vez de dejar un cliente a medio conectar.
  const phone = body.data.phone ? normalizePhoneNumber(body.data.phone) : "";
  if (body.data.phone && phone.length < 8) {
    return apiError(422, "invalid", "Número inválido");
  }
  if (phone) {
    const taken = await getCredentialsByDisplayPhone(phone);
    if (taken) {
      return apiError(
        409,
        "duplicate",
        "Ese número ya está conectado a otro cliente"
      );
    }
  }

  try {
    const result = await createClientWithOwner(body.data);
    if (phone) {
      await saveYcloudNumber({ organizationId: result.organizationId, phone });
    }
    return Response.json(
      {
        organizationId: result.organizationId,
        slug: result.slug,
        email: body.data.ownerEmail,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ProvisioningError) {
      return apiError(
        err.code === "duplicate_email" ? 409 : 422,
        err.code,
        err.message
      );
    }
    throw err;
  }
});
