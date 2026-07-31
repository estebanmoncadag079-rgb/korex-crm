import { withPlatformAdmin } from "@/lib/api";
import { listClients } from "@/server/admin/clients";
import { inicioDelMes, resumenUsoDesde } from "@/server/usage";

export const dynamic = "force-dynamic";

/**
 * Consumo del mes por cliente: lo que decide si una mensualidad deja margen.
 *
 * Se devuelven también los clientes sin consumo (en cero) en lugar de omitirlos:
 * un cliente que no aparece en la lista se lee como un olvido, no como un
 * cliente que no gastó.
 */
export const GET = withPlatformAdmin(async () => {
  const desde = inicioDelMes();
  const [clientes, uso] = await Promise.all([listClients(), resumenUsoDesde(desde)]);
  const porOrg = new Map(uso.map((u) => [u.organizationId, u]));

  const filas = clientes.map((c) => {
    const u = porOrg.get(c.id);
    return {
      organizationId: c.id,
      nombre: c.name,
      llamadasIa: u?.llamadasIa ?? 0,
      tokensIn: u?.tokensIn ?? 0,
      tokensOut: u?.tokensOut ?? 0,
      costoIaUsd: u?.costoIaUsd ?? 0,
      mensajes: u?.mensajes ?? 0,
      costoWhatsappUsd: u?.costoWhatsappUsd ?? 0,
      totalUsd: u?.totalUsd ?? 0,
    };
  });

  return Response.json({
    desde: desde.toISOString(),
    filas,
    total: {
      costoIaUsd: filas.reduce((a, f) => a + f.costoIaUsd, 0),
      costoWhatsappUsd: filas.reduce((a, f) => a + f.costoWhatsappUsd, 0),
      totalUsd: filas.reduce((a, f) => a + f.totalUsd, 0),
      mensajes: filas.reduce((a, f) => a + f.mensajes, 0),
      llamadasIa: filas.reduce((a, f) => a + f.llamadasIa, 0),
    },
  });
});
