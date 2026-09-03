import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { CampaignsClient } from "@/components/campaigns/campaigns-client";

export const dynamic = "force-dynamic";

/**
 * Fase 10G — accesible a cualquier usuario autenticado (no solo
 * superadmin, a diferencia de `/lab`/`/admin`): el cliente arma el
 * borrador y pide aprobación; el superadmin revisa/aprueba/ejecuta —
 * ambos comparten la misma pantalla, con las acciones que gastan dinero
 * de la agencia visibles solo para `isPlatformAdmin`.
 */
export default async function CampaignsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");

  return (
    <CampaignsClient
      isPlatformAdmin={session.platformRole === "superadmin"}
      organizationId={session.organizationId}
    />
  );
}
