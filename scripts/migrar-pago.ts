/**
 * Enciende `payment_source='ficha'` para un negocio de PEDIDOS — mismo patrón
 * que `migrar-catalogo.ts`. Antes de encender, quita de `instructions` el
 * bloque de pago que quedaría duplicado (ver docs/korexia/115, el mismo
 * problema que ya tuvo el catálogo de Lis).
 *
 * Uso:
 *   pnpm migrar:pago <organizationId>              # revisar, no escribe
 *   pnpm migrar:pago <organizationId> --aplicar     # limpia instructions Y enciende el flag, en una sola escritura
 *   pnpm migrar:pago <organizationId> --apagar      # ROLLBACK a 'prompt' (no restaura el texto viejo: queda en el log de esta corrida)
 *
 * `--aplicar` exige que `ficha.pago.formas` no esté vacío: sin eso, encender
 * el flag serviría un prompt sin ninguna forma de pago, peor que el bug que
 * se está arreglando.
 *
 * El bloque de `instructions` a quitar se busca por el delimitador que ya usan
 * los prompts de la flota (`## Cómo te pagan` hasta el siguiente `## ` o el
 * final del texto) y dentro de él SOLO se quita la línea de formas y el
 * bloque de datos de cuenta — las reglas de comportamiento (qué hacer si
 * insiste con efectivo, pedir el comprobante) se quedan, porque esas no las
 * lee ficha.pago.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { leerFicha } from "@/server/ai/generador/leer-ficha";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

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
  console.error("Falta el organizationId. Uso: pnpm migrar:pago <orgId> [--aplicar|--apagar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");
const apagar = process.argv.includes("--apagar");

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

/**
 * Corta el bloque "## Cómo te pagan" ... hasta el siguiente "## " (o el final
 * del texto), y dentro de él quita SOLO la línea "Formas de pago: …" y el
 * bloque "Datos para el pago (…): … <líneas>" — deja el resto del encabezado
 * y las reglas de comportamiento intactas.
 */
function quitarPagoDuplicado(instructions: string): { nuevo: string; huboCambio: boolean } {
  const inicio = instructions.indexOf("## Cómo te pagan");
  if (inicio === -1) return { nuevo: instructions, huboCambio: false };
  const siguienteHeader = instructions.indexOf("\n## ", inicio + 1);
  const fin = siguienteHeader === -1 ? instructions.length : siguienteHeader;
  const bloque = instructions.slice(inicio, fin);

  /*
   * "Formas de pago: …" no siempre termina en un salto de línea propio — en
   * la ficha real de Lis venía en el MISMO párrafo que una instrucción de
   * comportamiento ("Si el cliente pregunta…") que hay que conservar. Por
   * eso el corte se hace hasta el primer terminador reconocible de esa
   * frase, no hasta el próximo salto de línea.
   */
  const sinFormas = bloque.replace(
    /Formas de pago:[\s\S]*?(?=Si el cliente|\n\nDatos para el pago|\n## |$)/i,
    ""
  );
  const sinDatos = sinFormas.replace(
    /Datos para el pago \(cópialos TAL CUAL[^)]*\):\n(?:[^\n]*\n)*?\n/i,
    ""
  );
  // Las dos quitas de arriba pueden dejar 3+ saltos de línea seguidos donde
  // solo debe quedar una línea en blanco entre párrafos.
  const limpio = sinDatos.replace(/\n{3,}/g, "\n\n");

  if (limpio === bloque) return { nuevo: instructions, huboCambio: false };
  return {
    nuevo: instructions.slice(0, inicio) + limpio + instructions.slice(fin),
    huboCambio: true,
  };
}

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

console.log(`Negocio: ${profile.name} (${orgId})`);
console.log(`payment_source actual: ${profile.paymentSource}`);

if (apagar) {
  if (!aplicar) {
    console.log("\n(revisión) con --aplicar se ejecutaría: payment_source → 'prompt'");
    process.exit(0);
  }
  await db
    .update(schema.agentProfile)
    .set({ paymentSource: "prompt" })
    .where(eq(schema.agentProfile.organizationId, orgId));
  console.log("payment_source → 'prompt'. El texto de instructions NO se restaura solo (no se tocó al apagar).");
  await sql.end();
  process.exit(0);
}

const ficha = leerFicha(profile.ficha) as FichaDelNegocio | null;
const formas = ficha?.pago?.formas?.trim();
console.log(`\nficha.pago.formas: ${formas ? JSON.stringify(formas) : "(vacío)"}`);
console.log(`ficha.pago.datosDeCuenta: ${ficha?.pago?.datosDeCuenta ? "sí" : "no"}`);

if (!formas) {
  console.error(
    "\nABORTADO: ficha.pago.formas está vacío. Encender el flag serviría un prompt sin ninguna forma de pago — declara antes las formas desde el CRM."
  );
  process.exit(1);
}

const { nuevo, huboCambio } = quitarPagoDuplicado(profile.instructions ?? "");
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
  console.log("\n(revisión) con --aplicar se ejecutaría: limpiar instructions (si aplica) + payment_source → 'ficha'");
  process.exit(0);
}

console.log("\n--- instructions ANTES (para respaldo en este log) ---");
console.log(profile.instructions);
console.log("--- fin del respaldo ---\n");

await db
  .update(schema.agentProfile)
  .set({ instructions: nuevo, paymentSource: "ficha" })
  .where(eq(schema.agentProfile.organizationId, orgId));

console.log("Hecho: instructions actualizado (si había duplicado) y payment_source → 'ficha'.");
await sql.end();
process.exit(0);
