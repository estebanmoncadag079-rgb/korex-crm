/**
 * Fase 8A — EJECUTOR del primer envío controlado. Es el ÚNICO punto del
 * repositorio que puede terminar haciendo el POST real al proveedor de
 * WhatsApp para una campaña de prueba — y solo para exactamente 1
 * recipient, previamente preparado por `scripts/primer-envio-controlado.ts`
 * (READY_TO_SEND).
 *
 * NUNCA está cableado a `instrumentation.ts`, ningún cron, `npm start` ni
 * el `Dockerfile` — se ejecuta a mano, una vez, por un operador humano.
 *
 * Uso (modo seguro, sin ejecutar nada — solo muestra el precheck):
 *   npx tsx scripts/ejecutar-primer-envio-controlado.ts \
 *     --organization org_xxx --campaign cmp_xxx --recipient cmpr_xxx
 *
 * Uso (ejecuta el único envío real, tras revisar el precheck de arriba):
 *   npx tsx scripts/ejecutar-primer-envio-controlado.ts \
 *     --organization org_xxx --campaign cmp_xxx --recipient cmpr_xxx \
 *     --ejecutar
 *
 * Sin `--ejecutar`: muestra el precheck completo y termina — cero
 * escrituras, cero llamadas al proveedor. Con `--ejecutar`: además invoca
 * `ejecutarPrimerEnvioControlado()`, que hace su propia barrera final y
 * llama exactamente una vez a `enviarTemplateAlProveedor` (el proveedor
 * real) a través de `procesarUnEnvioControladoDeCampana()`.
 */
import { readFileSync } from "node:fs";
// Import estático: `parseArgs` es pura (sin DB/env) y vive en el módulo de
// dominio para poder testearla aislada — importarla aquí no ejecuta nada
// de `@/lib/db` (ninguna función del módulo corre código al importarse).
import { parseArgs, type ArgsEjecutor } from "@/server/campaigns/ejecutar-primer-envio";

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

const dbUrl = loadEnvVar("DATABASE_URL");
if (!dbUrl) {
  console.error("[ejecutar-primer-envio-controlado] DATABASE_URL no está definida");
  process.exit(1);
}
process.env.DATABASE_URL = dbUrl;
// Mismo patrón que tests/integration/_db.ts y primer-envio-controlado.ts:
// `getEnv()` valida el entorno entero al primer uso.
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= loadEnvVar("BETTER_AUTH_SECRET") ?? "secret-de-script-suficiente-largo";
process.env.ENCRYPTION_KEY ??= loadEnvVar("ENCRYPTION_KEY") ?? Buffer.alloc(32, 7).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN ??= loadEnvVar("META_WEBHOOK_VERIFY_TOKEN") ?? "token-de-script";

let args: ArgsEjecutor;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[ejecutar-primer-envio-controlado] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
if (!args.organization || !args.campaign || !args.recipient) {
  console.error(
    "Uso: npx tsx scripts/ejecutar-primer-envio-controlado.ts " +
      "--organization <id> --campaign <id> --recipient <id> [--ejecutar]"
  );
  process.exit(1);
}
const organizationId = args.organization;
const campaignId = args.campaign;
const recipientId = args.recipient;

const { precheckPrimerEnvioControlado, ejecutarPrimerEnvioControlado, leerResumenPostEjecucion, EjecucionControladaError } =
  await import("@/server/campaigns/ejecutar-primer-envio");

console.log("\nPRIMER ENVÍO CONTROLADO\n");
console.log(`  organizationId: ${organizationId}`);
console.log(`  campaignId:     ${campaignId}`);
console.log(`  recipientId:    ${recipientId}\n`);

console.log("PRECHECK\n");
let precheck;
try {
  precheck = await precheckPrimerEnvioControlado({ organizationId, campaignId, recipientId });
} catch (err) {
  if (err instanceof EjecucionControladaError) {
    console.error(`  PRECHECK FALLIDO (${err.code}): ${err.message}`);
  } else {
    console.error("  Error inesperado en el precheck:", err);
  }
  process.exit(1);
}

console.log(`  campaign:          ${precheck.campaignId} (status: ${precheck.campaignStatus})`);
console.log(`  recipient:         ${precheck.recipientId} (status: ${precheck.recipientStatus})`);
console.log(`  contact:           ${precheck.contactName} (${precheck.contactId})`);
console.log(`  teléfono:          ${precheck.telefonoEnmascarado}`);
console.log(`  optOut:            false (verificado)`);
console.log(`  template:          ${precheck.templateName} (${precheck.templateLanguage}) [${precheck.templateId}]`);
console.log(`  snapshot:          ${precheck.snapshotBody}`);
console.log(`  recipientCount:    ${precheck.totalRecipients}`);
console.log(`  jobCount:          ${precheck.totalJobs}`);
console.log(`  recipient.status:  ${precheck.recipientStatus}`);
console.log(`  job:               ${precheck.jobId} (status: ${precheck.jobStatus})`);

console.log("\nPRECHECK APROBADO\n");

if (!args.ejecutar) {
  console.log(
    "Sin --ejecutar: el script termina aquí. Cero escrituras, cero llamadas al proveedor.\n" +
      "Revisa el precheck de arriba y repite el comando con --ejecutar para realizar el único envío real."
  );
  process.exit(0);
}

console.log("⚠️  --ejecutar detectado: a continuación se realizará la ÚNICA llamada real al proveedor. ⚠️\n");
console.log("EXECUTION\n");

// El proveedor real se importa AQUÍ, en el único punto operativo — nunca
// antes (no al importar este script, no durante el precheck).
const { enviarTemplateAlProveedor } = await import("@/server/whatsapp/templates");

let ejecucion;
try {
  ejecucion = await ejecutarPrimerEnvioControlado({
    organizationId,
    campaignId,
    recipientId,
    proveedor: enviarTemplateAlProveedor,
  });
} catch (err) {
  if (err instanceof EjecucionControladaError) {
    console.error(`  BARRERA FINAL FALLIDA (${err.code}): ${err.message}`);
  } else {
    console.error("  Error inesperado durante la ejecución:", err);
  }
  process.exit(1);
}

const { resultado } = ejecucion;
const proveedorInvocado = resultado.outcome !== "sin_trabajo" && resultado.outcome !== "recipient_no_coincide";
console.log(`  claim realizado:     sí`);
console.log(`  proveedor invocado:  ${proveedorInvocado ? "sí" : "no"}`);
console.log(`  resultado:           ${resultado.outcome}`);
if ("retryable" in resultado) console.log(`  retryable:           ${resultado.retryable}`);

const resumen = await leerResumenPostEjecucion({ organizationId, campaignId, recipientId });
console.log(`  estado final recipient: ${resumen.recipientStatus}`);
console.log(`  messageId (interno):    ${resumen.messageId ?? "(ninguno)"}`);
console.log(`  waMessageId:             ${resumen.waMessageId ?? "(ninguno)"}`);
console.log(`  jobs restantes:          ${resumen.jobsRestantes}`);
console.log(`  estado final campaign:   ${resumen.campaignStatus}`);

process.exit(0);
