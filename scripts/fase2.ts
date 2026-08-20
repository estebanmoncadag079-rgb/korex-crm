/**
 * Enciende o apaga la Fase 2 (el estado del pedido en el backend) por cliente.
 *
 * Existe por la regla 8 de la Fase 2: **el rollback tiene que ser un UPDATE, no
 * un despliegue**. `migrar:catalogo` ya tenía su `--encender/--apagar` para la
 * Fase 1; esto es lo mismo para `state_source`.
 *
 * ⚠️ Encender exige que el cliente tenga **catálogo que leer en tablas**, que es
 * lo que de verdad comprueba el pipeline: sin él no hay contra qué validar y se
 * cae al comportamiento de siempre avisando por el log.
 *
 * Ojo con la diferencia entre verticales: `catalog_source` es un concepto de
 * PEDIDOS (`pipeline.ts`: `!contrataCitas(vertical) && catalogSource==='tabla'`).
 * Un negocio de citas lee sus servicios de `service` SIEMPRE, sin bandera — así
 * que exigirle `catalog_source='tabla'` lo dejaría bloqueado para siempre por
 * un interruptor que no le aplica. Por eso aquí se mira el catálogo real.
 *
 * Uso:
 *   pnpm fase2 <organizationId>              # solo mira, no escribe
 *   pnpm fase2 <organizationId> --encender
 *   pnpm fase2 <organizationId> --apagar     # ROLLBACK, efecto en el turno siguiente
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

const [organizationId] = process.argv.slice(2);
const encender = process.argv.includes("--encender");
const apagar = process.argv.includes("--apagar");

if (!organizationId) {
  console.error("Uso: pnpm fase2 <organizationId> [--encender|--apagar]");
  process.exit(1);
}
if (encender && apagar) {
  console.error("[fase2] --encender y --apagar a la vez no significa nada.");
  process.exit(1);
}

const url = envVar("DATABASE_URL");
if (!url) {
  console.error("[fase2] falta DATABASE_URL");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const [antes] = await db
  .select({
    stateSource: schema.agentProfile.stateSource,
    catalogSource: schema.agentProfile.catalogSource,
    appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
  })
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, organizationId))
  .limit(1);

if (!antes) {
  console.error(`[fase2] no existe la organización ${organizationId}`);
  await sql.end();
  process.exit(1);
}

const vertical = verticalDe(antes.appointmentsEnabled);
const ofrecibles = await catalogoDe(organizationId, vertical);

console.log(
  `[fase2] ${organizationId} · ${vertical} · state_source: ${antes.stateSource}` +
    (vertical === "pedidos" ? ` · catalog_source: ${antes.catalogSource}` : "") +
    ` · ${ofrecibles.length} en tablas`
);

if (!encender && !apagar) {
  console.log("[fase2] no se escribió nada (falta --encender o --apagar)");
  await sql.end();
  process.exit(0);
}

if (encender && ofrecibles.length === 0) {
  console.error(
    `[fase2] ⛔ no hay catálogo que leer en tablas: sin él el pipeline no tiene\n` +
      `        contra qué validar y se cae al comportamiento de siempre.\n` +
      `        Primero: ${
        vertical === "pedidos"
          ? "pnpm migrar:catalogo <org> --aplicar y --encender"
          : "carga sus servicios en el CRM (Servicios)"
      }`
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

const destino = encender ? "backend" : "prompt";
await conRegistro(
  {
    tabla: "agent_profile",
    registro: organizationId,
    leerFila,
    declarados: ["stateSource", "updatedAt"],
    proceso: encender ? "fase2:encender" : "fase2:apagar",
    actor: "script:fase2",
  },
  async () =>
    db
      .update(schema.agentProfile)
      .set({ stateSource: destino, updatedAt: new Date() })
      .where(eq(schema.agentProfile.organizationId, organizationId))
);

console.log(
  `[fase2] state_source = '${destino}'. Efecto en el turno siguiente, sin desplegar.` +
    (encender ? `\n[fase2] rollback: pnpm fase2 ${organizationId} --apagar` : "")
);

await sql.end();
process.exit(0);
