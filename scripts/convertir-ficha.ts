/**
 * Convierte la ficha de UN cliente a secciones — paso 3 de
 * [68-UN-DUENO-POR-DATO.md](../docs/korexia/68-UN-DUENO-POR-DATO.md).
 *
 * Las tres reglas del dueño, y ninguna es opcional:
 *
 *   1. Se compara el prompt **completo**, no su longitud. Cualquier diferencia
 *      aborta.
 *   2. Se compara la ficha **completa**: solo puede cambiar la estructura del
 *      JSON, nunca el contenido.
 *   3. No es válida hasta demostrar que es **reversible** sin pérdida.
 *
 * Uso:
 *   pnpm convertir:ficha <organizationId>              → comprueba, NO escribe
 *   pnpm convertir:ficha <organizationId> --aplicar    → convierte, con respaldo
 *   pnpm convertir:ficha <organizationId> --revertir   → vuelve a la forma plana
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { generarPerfil } from "@/server/ai/generador/generar";
import { opcionesDeGeneracion } from "@/server/ai/generador/fuentes";
import {
  aSecciones,
  camposSinDueño,
  esPorSecciones,
  leerFicha,
} from "@/server/ai/generador/leer-ficha";
import { verificarAntesDeMigrar } from "@/server/ai/generador/verificar-migracion";

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
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const organizationId = process.argv[2];
if (!organizationId || organizationId.startsWith("--")) {
  console.error("Uso: pnpm convertir:ficha <organizationId> [--aplicar|--revertir]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");
const revertir = process.argv.includes("--revertir");

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const TABLA_RESPALDO = "agent_profile_bk_conversion";

async function estado() {
  const [p] = await db
    .select({
      nombre: schema.organization.name,
      ficha: schema.agentProfile.ficha,
      instructions: schema.agentProfile.instructions,
      greeting: schema.agentProfile.greeting,
      escalationRules: schema.agentProfile.escalationRules,
      enabled: schema.agentProfile.enabled,
      appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
      catalogSource: schema.agentProfile.catalogSource,
      // Todas las fuentes, no solo el catálogo: si este script recompila con
      // menos de las que el cliente tiene encendidas, "detecta" una
      // diferencia que no existe y aborta una conversión sana.
      paymentSource: schema.agentProfile.paymentSource,
      deliverySource: schema.agentProfile.deliverySource,
      menuMode: schema.agentProfile.menuMode,
    })
    .from(schema.agentProfile)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.agentProfile.organizationId)
    )
    .where(eq(schema.agentProfile.organizationId, organizationId));
  return p;
}

const antes = await estado();
if (!antes) {
  console.error("[convertir] esa organización no existe");
  process.exit(1);
}
if (!antes.ficha) {
  console.error(`[convertir] ⛔ ${antes.nombre} no tiene ficha (prompt manual): NO se convierte.`);
  process.exit(1);
}

console.log(`\n${"=".repeat(74)}`);
console.log(`CONVERSIÓN DE LA FICHA — ${antes.nombre}`);
console.log(`${"=".repeat(74)}`);

// ---------------------------------------------------------------- REVERTIR
if (revertir) {
  const filas = await sql.unsafe(
    `SELECT ficha FROM ${TABLA_RESPALDO} WHERE organization_id = $1`,
    [organizationId]
  );
  const original = (filas[0] as { ficha?: string } | undefined)?.ficha;
  if (!original) {
    console.error("[convertir] ⛔ no hay respaldo de este cliente: no se puede revertir.");
    process.exit(1);
  }
  await db
    .update(schema.agentProfile)
    .set({ ficha: original, updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  const despues = await estado();
  const igualFicha = despues!.ficha === original;
  const fichaRestaurada = leerFicha(despues!.ficha);
  const perfil = generarPerfil(fichaRestaurada!, opcionesDeGeneracion(despues!));
  const igualPrompt = perfil.instructions === antes.instructions;

  console.log(`\nficha restaurada byte a byte : ${igualFicha ? "✅" : "🔴"}`);
  console.log(`prompt recompilado idéntico  : ${igualPrompt ? "✅" : "🔴"}`);
  console.log(
    igualFicha && igualPrompt
      ? "\n✅ ROLLBACK CORRECTO: el cliente volvió al estado anterior sin pérdida."
      : "\n🔴 ROLLBACK INCOMPLETO"
  );
  await sql.end();
  process.exit(igualFicha && igualPrompt ? 0 : 1);
}

// ------------------------------------------------------- LAS TRES REGLAS
const fichaAntes = leerFicha(antes.ficha)!;
const yaConvertida = esPorSecciones(JSON.parse(antes.ficha));
if (yaConvertida) {
  console.log("\n⚠️  este cliente YA está convertido. Nada que hacer.");
  await sql.end();
  process.exit(0);
}

const huerfanos = camposSinDueño(fichaAntes);
const convertida = JSON.stringify(aSecciones(fichaAntes));
const fichaDespues = leerFicha(convertida)!;

// Regla 2: la ficha, campo por campo. Solo puede cambiar la estructura.
const contenidoIgual =
  JSON.stringify(fichaAntes, Object.keys(fichaAntes).sort()) ===
  JSON.stringify(fichaDespues, Object.keys(fichaAntes).sort());

// Regla 1: el prompt COMPLETO, no su longitud.
const perfil = generarPerfil(fichaDespues, opcionesDeGeneracion(antes));
const comprobacion = verificarAntesDeMigrar(
  {
    instructions: antes.instructions,
    greeting: antes.greeting,
    escalationRules: antes.escalationRules,
    enabled: antes.enabled,
    appointmentsEnabled: antes.appointmentsEnabled,
  },
  {
    instructions: perfil.instructions,
    greeting: perfil.greeting,
    escalationRules: perfil.escalationRules,
    // La conversión no toca estos dos: se comparan consigo mismos para dejar
    // constancia de que siguen igual.
    enabled: antes.enabled,
    appointmentsEnabled: antes.appointmentsEnabled,
  }
);

console.log(`\n1. PROMPT COMPLETO (no la longitud)`);
console.log(`   ${antes.instructions?.length} caracteres · ${comprobacion.detalle.prompt ? "✅ IDÉNTICO" : "🔴 DIFERENTE"}`);
console.log(`   saludo ${comprobacion.detalle.saludo ? "✅" : "🔴"} · escalado ${comprobacion.detalle.escalado ? "✅" : "🔴"}`);
console.log(`\n2. FICHA COMPLETA`);
console.log(`   campos: ${Object.keys(fichaAntes).length} · contenido ${contenidoIgual ? "✅ IDÉNTICO (solo cambia la estructura)" : "🔴 CAMBIÓ"}`);
console.log(`   campos sin dueño: ${huerfanos.length ? `🔴 ${huerfanos.join(", ")}` : "✅ ninguno"}`);
console.log(`\n3. ESTADO DEL AGENTE`);
console.log(`   enabled=${antes.enabled} · appointmentsEnabled=${antes.appointmentsEnabled} (la conversión no los toca)`);

const puede = comprobacion.ok && contenidoIgual && huerfanos.length === 0;
if (!puede) {
  console.error(`\n⛔ ABORTADA. Motivos:\n   - ${[...comprobacion.fallos, ...(contenidoIgual ? [] : ["el contenido de la ficha cambiaría"]), ...(huerfanos.length ? [`campos sin dueño: ${huerfanos.join(", ")}`] : [])].join("\n   - ")}`);
  await sql.end();
  process.exit(1);
}

if (!aplicar) {
  console.log("\n✅ Las tres comprobaciones pasan. NO se ha escrito nada (falta --aplicar).");
  await sql.end();
  process.exit(0);
}

// ---------------------------------------------------------------- APLICAR
await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${TABLA_RESPALDO} (
  organization_id text PRIMARY KEY,
  ficha text,
  instructions text,
  guardado_en timestamp DEFAULT now()
)`);
await sql.unsafe(
  `INSERT INTO ${TABLA_RESPALDO} (organization_id, ficha, instructions)
   VALUES ($1, $2, $3)
   ON CONFLICT (organization_id) DO UPDATE SET ficha = EXCLUDED.ficha, instructions = EXCLUDED.instructions, guardado_en = now()`,
  [organizationId, antes.ficha, antes.instructions ?? ""]
);
console.log(`\n💾 respaldo guardado en ${TABLA_RESPALDO}`);

await db
  .update(schema.agentProfile)
  .set({ ficha: convertida, updatedAt: new Date() })
  .where(eq(schema.agentProfile.organizationId, organizationId));

// Y se vuelve a comprobar leyendo de la base, que es lo único que cuenta.
const despues = await estado();
const releida = leerFicha(despues!.ficha)!;
const perfilFinal = generarPerfil(releida, opcionesDeGeneracion(despues!));
const finalOk =
  perfilFinal.instructions === antes.instructions &&
  despues!.instructions === antes.instructions &&
  despues!.enabled === antes.enabled &&
  despues!.appointmentsEnabled === antes.appointmentsEnabled;

console.log(`\n✅ CONVERTIDO. Verificación releyendo de la base:`);
console.log(`   prompt guardado intacto      : ${despues!.instructions === antes.instructions ? "✅" : "🔴"}`);
console.log(`   prompt recompilado idéntico  : ${perfilFinal.instructions === antes.instructions ? "✅" : "🔴"}`);
console.log(`   enabled / citas sin cambios  : ${despues!.enabled === antes.enabled && despues!.appointmentsEnabled === antes.appointmentsEnabled ? "✅" : "🔴"}`);
console.log(`\n   rollback: pnpm convertir:ficha ${organizationId} --revertir`);

await sql.end();
process.exit(finalOk ? 0 : 1);
