/**
 * Prueba el vertical de citas SIN gastar WhatsApp ni arriesgar una
 * conversación real: usa una conversación `is_test` (el sandbox JAMÁS toca
 * Graph/YCloud — verificado en tests/unit/send-sandbox.test.ts) dentro de una
 * organización que YA tenga `agent_profile.appointmentsEnabled = true`, y hace
 * pasar un guion de mensajes por el pipeline REAL del agente, turno a turno.
 *
 * Mismo espíritu que `/root/probar-lis.py` en el servidor (ver
 * docs/korexia/05-CLIENTES.md): validar al agente contra el modelo real antes
 * de encender nada, sin arriesgar una conversación de un cliente de verdad.
 *
 * Uso:
 *   corepack pnpm probar:citas <organizationId>
 *   corepack pnpm probar:citas <organizationId> "hola" "quiero un semipermanente" "mañana en la tarde"
 *
 * Requisitos previos (una sola vez, desde la app):
 *   1. Crear el cliente en /admin con "¿Este cliente necesita gestionar citas?" marcado.
 *   2. Darle al menos un servicio con una especialista asignada en /services.
 */
import { readFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { runAgentTurn } from "@/server/ai/pipeline";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}
for (const name of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "OPENROUTER_API_TOKEN",
  "OPENROUTER_MODEL",
]) {
  const v = loadEnvVar(name);
  if (v && !process.env[name]) process.env[name] = v;
}

const [organizationId, ...mensajes] = process.argv.slice(2);
if (!organizationId) {
  console.error(
    'Uso: pnpm probar:citas <organizationId> ["mensaje 1" "mensaje 2" ...]'
  );
  process.exit(1);
}

const GUION_POR_DEFECTO = [
  "hola, quiero agendar una cita",
  "para semipermanente",
  "mañana en la tarde",
];

const guion = mensajes.length ? mensajes : GUION_POR_DEFECTO;

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[probar-agente] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const profileRows = await db
  .select()
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, organizationId))
  .limit(1);
const profile = profileRows[0];
if (!profile) {
  console.error(`[probar-agente] No existe la organización ${organizationId}`);
  await sql.end();
  process.exit(1);
}
if (!profile.appointmentsEnabled) {
  console.warn(
    "[probar-agente] Esta organización no tiene el vertical de citas: se prueba el flujo de PEDIDOS."
  );
}
if (!profile.enabled) {
  console.warn(
    "[probar-agente] Aviso: el agente está APAGADO para este cliente. El Laboratorio/sandbox igual lo prueba (evalúa el comportamiento configurado), pero recuerda encenderlo antes de ir a producción."
  );
}

const contactRows = await db
  .insert(schema.contact)
  .values({
    id: newId("contact"),
    organizationId,
    phone: `test${Date.now()}`,
    name: "Cliente de prueba",
  })
  .returning();
const contact = contactRows[0]!;

const conversationRows = await db
  .insert(schema.conversation)
  .values({
    id: newId("conversation"),
    organizationId,
    contactId: contact.id,
    isTest: true,
    aiEnabled: true,
  })
  .returning();
const conversation = conversationRows[0]!;

console.log(
  `\n[probar-agente] Conversación de prueba ${conversation.id} (is_test — nunca toca WhatsApp de verdad)\n`
);

let outCountAnterior = 0;
for (const texto of guion) {
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId,
    conversationId: conversation.id,
    direction: "in",
    type: "text",
    text: texto,
    status: "delivered",
  });
  await db
    .update(schema.conversation)
    .set({ lastInboundAt: new Date(), lastMessageAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  console.log(`CLIENTE: ${texto}`);
  const action = await runAgentTurn(conversation.id);
  console.log(`  [acción del agente: ${action?.action ?? "(sin turno — revisa OPENROUTER_API_TOKEN)"}]`);

  const salientes = await db
    .select()
    .from(schema.message)
    .where(
      and(
        eq(schema.message.conversationId, conversation.id),
        eq(schema.message.direction, "out")
      )
    )
    .orderBy(asc(schema.message.createdAt));
  for (const m of salientes.slice(outCountAnterior)) {
    if (m.text) console.log(`AGENTE: ${m.text}`);
  }
  outCountAnterior = salientes.length;

  const convRows = await db
    .select({ handoffReason: schema.conversation.handoffReason })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversation.id))
    .limit(1);
  if (convRows[0]?.handoffReason) {
    console.log(`  [conversación pasó a una persona: ${convRows[0].handoffReason}]`);
  }
  console.log("");
}

console.log(
  `[probar-agente] Listo. Revisa /appointments (y la bandeja) en la app con esta organización activa para ver lo que quedó guardado.`
);
await sql.end();
process.exit(0);
