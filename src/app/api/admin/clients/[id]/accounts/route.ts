import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { findOrganization, listClientAccounts } from "@/server/admin/clients";
import {
  createAccountInOrganization,
  deleteAccountFromOrganization,
  ProvisioningError,
  resetAccountPassword,
} from "@/server/auth/provisioning";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Cuentas de acceso de un cliente. */
export const GET = withPlatformAdmin(async (_session, _req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!(await findOrganization(id))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }
  const accounts = await listClientAccounts(id);
  return Response.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      role: a.role,
      isPlatformAdmin: a.platformRole === "superadmin",
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["owner", "member"]).optional(),
});

/**
 * Crea una cuenta de acceso dentro de un cliente YA existente.
 * Es el camino para entregarle su cuenta a un negocio que ya opera en la
 * instancia (caso: el tenant existía antes que su dueño tuviera login).
 */
export const POST = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!(await findOrganization(id))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  try {
    const { memberId } = await createAccountInOrganization({
      organizationId: id,
      ...body.data,
      role: body.data.role ?? "owner",
    });
    return Response.json(
      { ok: true, email: body.data.email, accountId: memberId },
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

const resetSchema = z.object({
  accountId: z.string().trim().min(1),
  password: z.string().min(8).max(128),
});

/**
 * Contraseña nueva para una cuenta que perdió la suya.
 *
 * La genera el navegador y se muestra una sola vez para dictársela al cliente:
 * no se guarda en claro en ningún sitio, igual que al dar de alta la cuenta.
 */
export const PATCH = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!(await findOrganization(id))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }
  const body = await parseBody(req, resetSchema);
  if (!body.ok) return body.response;

  const result = await resetAccountPassword({
    organizationId: id,
    memberId: body.data.accountId,
    password: body.data.password,
  });

  if (!result.ok) {
    return result.reason === "not_found"
      ? apiError(404, "not_found", "Esa cuenta no pertenece a este cliente")
      : apiError(
          403,
          "forbidden",
          "Las cuentas de la agencia no se cambian desde aquí"
        );
  }

  return Response.json({ ok: true, email: result.email, name: result.name });
});

/**
 * Elimina una cuenta de acceso de un cliente.
 *
 * ⚠️ No confundir con el `DELETE` de `../route.ts`, que borra **el cliente
 * entero** con sus contactos, su catálogo y su conexión de WhatsApp.
 */
export const DELETE = withPlatformAdmin(async (_session, req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!(await findOrganization(id))) {
    return apiError(404, "not_found", "Cliente no encontrado");
  }

  const accountId = new URL(req.url).searchParams.get("accountId")?.trim();
  if (!accountId) {
    return apiError(422, "invalid", "Falta la cuenta a eliminar");
  }

  const result = await deleteAccountFromOrganization({
    organizationId: id,
    memberId: accountId,
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiError(404, "not_found", "Esa cuenta no pertenece a este cliente");
    }
    if (result.reason === "last_account") {
      return apiError(
        409,
        "last_account",
        "Es la única cuenta del cliente: crea la nueva antes de borrar esta"
      );
    }
    return apiError(
      403,
      "forbidden",
      "Las cuentas de la agencia no se eliminan desde aquí"
    );
  }

  return Response.json({
    ok: true,
    email: result.email,
    name: result.name,
    freedEmail: result.freedEmail,
  });
});
