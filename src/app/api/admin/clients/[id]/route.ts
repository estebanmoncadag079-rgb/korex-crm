import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro } from "@/server/registro-de-cambios";
import { getEnv } from "@/lib/env";
import { findOrganization } from "@/server/admin/clients";
import {
  getCredentialsByDisplayPhone,
  normalizePhoneNumber,
  saveYcloudNumber,
} from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /**
   * Número del negocio en E.164 (con o sin '+'); es la clave de enrutamiento.
   * Ausente = esta llamada no toca número ni credenciales de YCloud (p. ej.
   * solo cambia `appointmentsEnabled`).
   */
  phone: z.string().trim().min(8).max(20).optional(),
  wabaId: z.string().trim().max(64).optional(),
  /**
   * Credenciales de la cuenta de YCloud DEL CLIENTE. Opcionales: sin ellas el
   * cliente sale por la cuenta de la agencia y gasta uno de sus cupos. Con
   * ellas paga sus propios mensajes y aporta su propio cupo.
   * Cadena vacía = volver a la cuenta de la agencia.
   */
  ycloudApiKey: z.string().trim().max(200).optional(),
  ycloudWebhookSecret: z.string().trim().max(200).optional(),
  /** true/false = enciende o apaga el vertical de citas para este cliente. */
  appointmentsEnabled: z.boolean().optional(),
});

/**
 * Ata el número de WhatsApp del cliente a su organización (sin esto sus
 * mensajes entrantes no tienen dueño y el envío no sabe con qué número
 * salir), y/o enciende o apaga el vertical de citas. Cada campo es
 * independiente: se puede mandar solo `appointmentsEnabled` sin tocar nada
 * del número.
 */
export const PATCH = withPlatformAdmin(async (session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!(await findOrganization(id))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  if (body.data.appointmentsEnabled !== undefined) {
    const db = getDb();
    const leerFila = async () => {
      const [f] = await db
        .select()
        .from(schema.agentProfile)
        .where(eq(schema.agentProfile.organizationId, id));
      return (f as unknown as Fila) ?? null;
    };
    await conRegistro(
      {
        tabla: "agent_profile",
        registro: id,
        leerFila,
        declarados: ["appointmentsEnabled"],
        proceso: "api/admin/clients",
        actor: `user:${session.userId}`,
      },
      async () =>
        db
          .update(schema.agentProfile)
          .set({ appointmentsEnabled: body.data.appointmentsEnabled })
          .where(eq(schema.agentProfile.organizationId, id))
    );
  }

  if (body.data.phone === undefined) {
    return Response.json({
      ok: true,
      appointmentsEnabled: body.data.appointmentsEnabled,
    });
  }

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
    apiKey: body.data.ycloudApiKey,
    webhookSecret: body.data.ycloudWebhookSecret,
  });

  // Con cuenta propia, el cliente debe apuntar SU webhook aquí: se devuelve ya
  // armada para copiar y pegar en su consola de YCloud.
  const ownAccount = Boolean(body.data.ycloudApiKey?.trim());
  return Response.json({
    ok: true,
    phone,
    ownAccount,
    appointmentsEnabled: body.data.appointmentsEnabled,
    webhookUrl: ownAccount
      ? `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/ycloud/${id}`
      : null,
  });
});

const deleteSchema = z.object({
  /** Nombre exacto del cliente: confirmación explícita, se borra todo lo suyo. */
  confirmName: z.string().trim().min(1),
});

/**
 * Elimina un cliente con TODO lo suyo (conversaciones, contactos, embudo,
 * agente, número y cuentas de acceso, por cascada). Pensado para deshacer un
 * alta equivocada o cerrar un contrato — por eso exige escribir el nombre.
 */
export const DELETE = withPlatformAdmin(
  async (session, req: Request, ctx: Ctx) => {
    const { id } = await ctx.params;
    const organization = await findOrganization(id);
    if (!organization) {
      return apiError(404, "not_found", "Cliente no encontrado");
    }
    if (id === session.organizationId) {
      return apiError(
        409,
        "conflict",
        "Estás dentro de esa cuenta: vuelve a la tuya antes de eliminarla"
      );
    }
    const body = await parseBody(req, deleteSchema);
    if (!body.ok) return body.response;
    if (body.data.confirmName !== organization.name) {
      return apiError(
        422,
        "invalid",
        "El nombre no coincide: escríbelo tal cual para confirmar"
      );
    }

    const db = getDb();
    // Las cuentas cuya ÚNICA membresía era este cliente se quedarían sin
    // organización (sesión inválida): se borran con él.
    const members = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, id));

    await db.delete(schema.organization).where(eq(schema.organization.id, id));

    for (const { userId } of members) {
      const remaining = await db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(eq(schema.member.userId, userId))
        .limit(1);
      if (!remaining[0]) {
        await db.delete(schema.user).where(eq(schema.user.id, userId));
      }
    }

    console.info(`[admin] ${session.userId} eliminó la organización ${id}`);
    return Response.json({ deleted: true });
  }
);
