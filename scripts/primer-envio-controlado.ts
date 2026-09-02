/**
 * Fase 7B — script operativo de EJECUCIÓN MANUAL EXCLUSIVA.
 *
 * NUNCA está cableado a `instrumentation.ts`, ningún cron, `npm start` ni
 * el `Dockerfile` — se ejecuta a mano, una vez, por un operador humano.
 * Prepara y valida un primer envío controlado de campaña con UN ÚNICO
 * destinatario: materializa exactamente 1 `campaign_recipient`, encola
 * exactamente 1 `campaign_send_job`, activa la campaña, y muestra el
 * preview del mensaje — pero en ESTA FASE nunca llama al proveedor real.
 * El script termina ANTES del adapter (`enviarTemplateAlProveedor`/
 * `sendTemplate`) — ninguno de los dos se importa aquí.
 *
 * La campaña (`--campaign`) debe existir de antemano y estar en `ready`
 * (creada + `prepararCampana()` ya ejecutado, con plantilla `approved` y
 * snapshot congelado) — este script no crea campañas, solo opera sobre una
 * ya preparada, exclusivamente para pruebas de un único destinatario.
 *
 * Uso:
 *   npx tsx scripts/primer-envio-controlado.ts \
 *     --organization org_xxx --campaign cmp_xxx --contact ct_xxx
 *
 *   (revisa el preview con atención — nombre, teléfono enmascarado,
 *   mensaje final renderizado — antes de repetir el comando con:)
 *
 *   npx tsx scripts/primer-envio-controlado.ts \
 *     --organization org_xxx --campaign cmp_xxx --contact ct_xxx \
 *     --confirmar-unico-envio
 *
 * Con `--confirmar-unico-envio`, en esta fase el script SOLO ejecuta las
 * validaciones y deja la campaña lista ("LISTO PARA EJECUCIÓN
 * CONTROLADA.") — el envío real en sí es una fase posterior, con su propia
 * autorización explícita separada.
 */
import { readFileSync } from "node:fs";

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
  console.error("[primer-envio-controlado] DATABASE_URL no está definida");
  process.exit(1);
}
process.env.DATABASE_URL = dbUrl;
// Mismo patrón que tests/integration/_db.ts: `getEnv()` valida el entorno
// entero al primer uso; este script solo toca la base, con estos defaults
// alcanza para no exigirle al operador variables que no necesita.
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= loadEnvVar("BETTER_AUTH_SECRET") ?? "secret-de-script-suficiente-largo";
process.env.ENCRYPTION_KEY ??= loadEnvVar("ENCRYPTION_KEY") ?? Buffer.alloc(32, 7).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN ??= loadEnvVar("META_WEBHOOK_VERIFY_TOKEN") ?? "token-de-script";

function parseArgs(argv: string[]): {
  organization?: string;
  campaign?: string;
  contact?: string;
  confirmar: boolean;
} {
  const out: { organization?: string; campaign?: string; contact?: string; confirmar: boolean } = {
    confirmar: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--organization") out.organization = argv[++i];
    else if (arg === "--campaign") out.campaign = argv[++i];
    else if (arg === "--contact") out.contact = argv[++i];
    else if (arg === "--confirmar-unico-envio") out.confirmar = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.organization || !args.campaign || !args.contact) {
  console.error(
    "Uso: npx tsx scripts/primer-envio-controlado.ts " +
      "--organization <id> --campaign <id> --contact <id> [--confirmar-unico-envio]"
  );
  process.exit(1);
}
const organizationId = args.organization;
const campaignId = args.campaign;
const contactId = args.contact;

const { prepararPruebaControlada, PruebaControladaError } = await import(
  "@/server/campaigns/prueba-controlada"
);

console.log("\n[primer-envio-controlado] Preview (solo lectura, nada se escribe todavía)\n");

let resultado;
try {
  resultado = await prepararPruebaControlada({
    organizationId,
    campaignId,
    contactId,
    confirmar: args.confirmar,
  });
} catch (err) {
  if (err instanceof PruebaControladaError) {
    console.error(`[primer-envio-controlado] Validación fallida (${err.code}): ${err.message}`);
  } else {
    console.error("[primer-envio-controlado] Error inesperado:", err);
  }
  process.exit(1);
}

const { preview } = resultado;
console.log(`  Organización:        ${preview.organizationId}`);
console.log(`  Campaña:             ${preview.campaignId}`);
console.log(`  Contacto:            ${preview.contactName} (${preview.contactId})`);
console.log(`  Teléfono:            ${preview.telefonoEnmascarado}`);
console.log(`  Plantilla:           ${preview.templateName} (${preview.templateLanguage})`);
console.log(`  Cuerpo (snapshot):   ${preview.snapshotBody}`);
console.log(`  Variable resuelta:   ${preview.variableResuelta ?? "(ninguna)"}`);
console.log(`  Mensaje final:       ${preview.mensajeFinal}`);

console.log("\n⚠️  ESTE COMANDO PREPARARÁ EXACTAMENTE 1 ENVÍO REAL DE WHATSAPP. ⚠️\n");

if (resultado.status === "PREVIEW_ONLY") {
  console.log(
    "[primer-envio-controlado] Sin --confirmar-unico-envio: no se creó nada, no se tocó la base, " +
      "no se llamó a ningún proveedor. Revisa el preview de arriba y repite el comando con " +
      "--confirmar-unico-envio para continuar con las validaciones."
  );
  process.exit(0);
}

console.log(
  `  campaign_recipient ${resultado.recipientId}\n` +
    `  campaign_send_job  ${resultado.jobId}\n` +
    `  campaign ${campaignId} → processing\n`
);
console.log(
  "Este script (Fase 7B) se detiene aquí a propósito: nunca importa el adapter real " +
    "(enviarTemplateAlProveedor/sendTemplate), nunca llama a YCloud ni a Meta. El envío " +
    "real en sí es una fase posterior, con su propia autorización explícita separada.\n"
);
console.log("LISTO PARA EJECUCIÓN CONTROLADA.");
process.exit(0);
