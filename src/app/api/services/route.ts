import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  appointmentsEnabledFor,
  createService,
  listServices,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const services = await listServices(session.organizationId, { includeArchived: true });
  return Response.json({ services });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
  durationMin: z.number().int().min(5).max(600),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const service = await createService(session.organizationId, {
    name: body.data.name,
    category: body.data.category ?? null,
    priceCents: body.data.priceCents,
    durationMin: body.data.durationMin,
  });
  if (!service) return apiError(500, "internal", "No se pudo crear el servicio");
  return Response.json({ service }, { status: 201 });
});
