/**
 * Enciende o apaga `consultas_verificadas_enabled` por cliente — mismo patrón
 * y mismas garantías que `fase2.ts` y `migrar-pago.ts`: rollback por UPDATE,
 * sin desplegar, con guarda antes de encender y auditoría en `conRegistro`.
 *
 * Qué hace este flag: activa, en `pipeline.ts`, la verificación factual
 * PROACTIVA de producto y de medio de pago (docs/korexia/143 y 146) — el
 * SERVIDOR consulta el catálogo real / `ficha.pago.formas` ANTES de la
 * primera llamada al modelo, cuando el mensaje es una pregunta factual
 * concreta ("¿tienen X?", "¿aceptan Nequi?"). El contrato de las acciones
 * `consultar_producto`/`consultar_medio_pago` en el prompt NO depende de
 * este flag (depende de `catalog_source='tabla'`/`payment_source='ficha'`,
 * ver `prompts.ts`); este flag es la capa extra que no espera a que el
 * modelo decida pedirlo.
 *
 * ⚠️ Encender exige que haya al menos UN canal real que verificar: catálogo
 * con productos en tablas, o `payment_source='ficha'` con formas de pago no
 * vacías. Sin ninguno de los dos, el flag quedaría encendido sin verificar
 * nada — igual de inútil que encender Fase 2 sin catálogo.
 *
 * Uso:
 *   pnpm consultas-verificadas <organizationId>              # solo mira, no escribe
 *   pnpm consultas-verificadas <organizationId> --encender
 *   pnpm consultas-verificadas <organizationId> --apagar     # ROLLBACK, efecto en el turno siguiente
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro } from "@/server/registro-de-cambios";
import { catalogoDe } from "@/server/catalog/queries";
import { verticalDe } from "@/server/vertical";
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

const [organizationId] = process.argv.slice(2);
const encender = process.argv.includes("--encender");
const apagar = process.argv.includes("--apagar");

if (!organizationId) {
  console.error("Uso: pnpm consultas-verificadas <organizationId> [--encender|--apagar]");
  process.exit(1);
}
if (encender && apagar) {
  console.error("[consultas-verificadas] --encender y --apagar a la vez no significa nada.");
  process.exit(1);
}

const url = envVar("DATABASE_URL");
if (!url) {
  console.error("[consultas-verificadas] falta DATABASE_URL");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const [antes] = await db
  .select({
    consultasVerificadasEnabled: schema.agentProfile.consultasVerificadasEnabled,
    catalogSource: schema.agentProfile.catalogSource,
    paymentSource: schema.agentProfile.paymentSource,
    appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
    ficha: schema.agentProfile.ficha,
  })
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, organizationId))
  .limit(1);

if (!antes) {
  console.error(`[consultas-verificadas] no existe la organización ${organizationId}`);
  await sql.end();
  process.exit(1);
}

const vertical = verticalDe(antes.appointmentsEnabled);
const ofrecibles = vertical === "pedidos" ? await catalogoDe(organizationId, vertical) : [];
const ficha = leerFicha(antes.ficha) as FichaDelNegocio | null;
const formasDePago = ficha?.pago?.formas?.trim();
const canalProducto = antes.catalogSource === "tabla" && ofrecibles.length > 0;
const canalPago = antes.paymentSource === "ficha" && !!formasDePago;

console.log(
  `[consultas-verificadas] ${organizationId} · ${vertical} · consultas_verificadas_enabled: ${antes.consultasVerificadasEnabled}`
);
console.log(
  `  canal producto: catalog_source=${antes.catalogSource}, ${ofrecibles.length} en tablas → ${canalProducto ? "disponible" : "NO disponible"}`
);
console.log(
  `  canal pago: payment_source=${antes.paymentSource}, formas=${formasDePago ? JSON.stringify(formasDePago) : "(vacío)"} → ${canalPago ? "disponible" : "NO disponible"}`
);

if (!encender && !apagar) {
  console.log("[consultas-verificadas] no se escribió nada (falta --encender o --apagar)");
  await sql.end();
  process.exit(0);
}

if (encender && !canalProducto && !canalPago) {
  console.error(
    `[consultas-verificadas] ⛔ ni catálogo en tablas ni pago desde ficha están disponibles:\n` +
      `        el flag quedaría encendido sin verificar nada. Primero activa al menos uno:\n` +
      `        pnpm migrar:catalogo ${organizationId} --aplicar --encender\n` +
      `        pnpm migrar:pago ${organizationId} --aplicar`
  );
  await sql.end();
  process.exit(1);
}

const leerFila = async () => {
  const [f] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  return (f as unknown as Fila) ?? null;
};

await conRegistro(
  {
    tabla: "agent_profile",
    registro: organizationId,
    leerFila,
    declarados: ["consultasVerificadasEnabled", "updatedAt"],
    proceso: encender ? "consultas-verificadas:encender" : "consultas-verificadas:apagar",
    actor: "script:consultas-verificadas",
  },
  async () =>
    db
      .update(schema.agentProfile)
      .set({ consultasVerificadasEnabled: encender, updatedAt: new Date() })
      .where(eq(schema.agentProfile.organizationId, organizationId))
);

console.log(
  `[consultas-verificadas] consultas_verificadas_enabled = ${encender}. Efecto en el turno siguiente, sin desplegar.` +
    (encender ? `\n[consultas-verificadas] rollback: pnpm consultas-verificadas ${organizationId} --apagar` : "")
);

await sql.end();
process.exit(0);
