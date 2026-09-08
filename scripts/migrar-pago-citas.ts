/**
 * Retira el bloque de pago duplicado/contradictorio de `instructions` para un
 * negocio de CITAS — mismo patrón que `migrar-pago.ts` (pedidos), pero
 * decidiendo también si retirar la frase de comprobante según
 * `ficha.cierre.pagoAntesDeLaCita` (ver `quitar-bloque-pago.ts`).
 *
 * A diferencia de `migrar-pago.ts`, este script NO enciende ningún flag de
 * `agent_profile`: para citas el pago ya se lee siempre de `ficha.pago` /
 * `pagoDeCitasParaElPrompt`, sin depender de `payment_source` (ver la
 * auditoría de citas, docs/korexia, 31-ago-2026). El único cambio es
 * textual, sobre `instructions`.
 *
 * Uso:
 *   pnpm migrar:pago-citas <organizationId>              # revisar, no escribe
 *   pnpm migrar:pago-citas <organizationId> --aplicar     # limpia instructions
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { leerFicha } from "@/server/ai/generador/leer-ficha";
import { pagoAntesDeLaCitaDe, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { quitarPagoDuplicado } from "@/server/ai/generador/quitar-bloque-pago";
import { conRegistro } from "@/server/registro-de-cambios";
import type { Fila } from "@/server/ai/generador/comparar-fila";

function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    return env
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const orgId = process.argv[2];
if (!orgId || orgId.startsWith("--")) {
  console.error("Falta el organizationId. Uso: pnpm migrar:pago-citas <orgId> [--aplicar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const rows = await db
  .select()
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, orgId))
  .limit(1);
const profile = rows[0];
if (!profile) {
  console.error(`No hay agent_profile para ${orgId}`);
  process.exit(1);
}

if (!profile.appointmentsEnabled) {
  console.error(
    `[migrar:pago-citas] ⛔ ${orgId} no tiene appointmentsEnabled=true — este script es solo para citas. ` +
      `Para pedidos usa: pnpm migrar:pago ${orgId}`
  );
  process.exit(1);
}

console.log(`Negocio: ${profile.name} (${orgId})`);

const ficha = leerFicha(profile.ficha) as FichaDelNegocio | null;
if (!ficha) {
  console.error("ABORTADO: no se pudo leer la ficha del negocio.");
  process.exit(1);
}
const antes = pagoAntesDeLaCitaDe(ficha);
console.log(`ficha.cierre.pagoAntesDeLaCita: ${antes}`);
console.log(`ficha.pago.formas: ${ficha.pago?.formas ? JSON.stringify(ficha.pago.formas) : "(vacío)"}`);

const { nuevo, huboCambio } = quitarPagoDuplicado(profile.instructions ?? "", {
  quitarFraseComprobante: !antes,
});
console.log(`\n¿Se encontró un bloque de pago duplicado en instructions para quitar?: ${huboCambio}`);
if (huboCambio) {
  console.log(`Longitud de instructions: ${profile.instructions!.length} → ${nuevo.length}`);
}

if (!aplicar) {
  if (huboCambio) {
    const inicio = nuevo.indexOf("## Cómo te pagan");
    const siguienteHeader = nuevo.indexOf("\n## ", inicio + 1);
    const fin = siguienteHeader === -1 ? Math.min(nuevo.length, inicio + 600) : siguienteHeader;
    console.log("\n--- Cómo quedaría ese bloque ---");
    console.log(nuevo.slice(inicio, fin));
    console.log("--- fin ---");
  }
  console.log("\n(revisión) con --aplicar se ejecutaría: limpiar instructions (sin tocar ningún flag)");
  await sql.end();
  process.exit(0);
}

if (!huboCambio) {
  console.log("Nada que aplicar: instructions ya está limpio.");
  await sql.end();
  process.exit(0);
}

console.log("\n--- instructions ANTES (para respaldo en este log) ---");
console.log(profile.instructions);
console.log("--- fin del respaldo ---\n");

const leerFila = async () => {
  const [f] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, orgId));
  return (f as unknown as Fila) ?? null;
};

const resultado = await conRegistro(
  {
    tabla: "agent_profile",
    registro: orgId,
    leerFila,
    declarados: ["instructions", "updatedAt"],
    proceso: "migrar-pago-citas:aplicar",
    actor: "script:migrar-pago-citas",
  },
  async () =>
    db
      .update(schema.agentProfile)
      .set({ instructions: nuevo, updatedAt: new Date() })
      .where(eq(schema.agentProfile.organizationId, orgId))
      .returning({ organizationId: schema.agentProfile.organizationId })
);

console.log(`Filas afectadas: ${resultado.length}`);
if (resultado.length !== 1) {
  console.error(`⛔ Se esperaba exactamente 1 fila afectada, se afectaron ${resultado.length}.`);
  await sql.end();
  process.exit(1);
}

console.log("Hecho: instructions actualizado (bloque de pago duplicado retirado). Ningún flag fue tocado.");
await sql.end();
process.exit(0);
