import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  appointmentsEnabledFor,
  createStaff,
  listStaff,
  listStaffServiceLinks,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const [staff, links] = await Promise.all([
    listStaff(session.organizationId, { includeArchived: true }),
    listStaffServiceLinks(session.organizationId),
  ]);
  const byStaff = new Map<string, string[]>();
  for (const l of links) {
    const arr = byStaff.get(l.staffId) ?? [];
    arr.push(l.serviceId);
    byStaff.set(l.staffId, arr);
  }
  return Response.json({
    staff: staff.map((s) => ({ ...s, serviceIds: byStaff.get(s.id) ?? [] })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  serviceIds: z.array(z.string()).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const staff = await createStaff(session.organizationId, {
    name: body.data.name,
    serviceIds: body.data.serviceIds ?? [],
  });
  if (!staff) return apiError(500, "internal", "No se pudo crear la especialista");
  return Response.json({ staff }, { status: 201 });
});
