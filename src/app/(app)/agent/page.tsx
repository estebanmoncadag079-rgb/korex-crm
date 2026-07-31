import { getSessionOrNull } from "@/lib/auth/session";
import { AgentClient } from "@/components/agent/agent-client";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await getSessionOrNull();
  /*
   * El aprendizaje consume IA y la paga la agencia, así que al cliente ni
   * siquiera se le enseña el botón. El endpoint lo rechaza igual con 403:
   * esto solo evita mostrar algo que no podría usar.
   */
  return <AgentClient esAgencia={session?.platformRole === "superadmin"} />;
}
