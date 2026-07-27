import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { findOrganization, listClientAccounts } from "@/server/admin/clients";
import {
  createAccountInOrganization,
  ProvisioningError,
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
    await createAccountInOrganization({
      organizationId: id,
      ...body.data,
      role: body.data.role ?? "owner",
    });
    return Response.json({ ok: true, email: body.data.email }, { status: 201 });
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
