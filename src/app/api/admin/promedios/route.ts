import { withPlatformAdmin } from "@/lib/api";
import { promediosPorCliente } from "@/server/admin/promedios";

export const dynamic = "force-dynamic";

/** Promedios reales de cada cliente, para partir de datos al cotizar. */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ clientes: await promediosPorCliente() });
});
