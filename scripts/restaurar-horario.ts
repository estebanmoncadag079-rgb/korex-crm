/**
 * Restaura el horario de un negocio en SUS DOS COPIAS, con comparación de fila
 * completa.
 *
 * **Por qué hace falta**: el 15-ago a las 19:46:41, `aplicarFicha` revirtió el
 * horario del salón de 09:30–18:30 a 09:00–20:00 mientras se ejecutaba una
 * prueba que verificaba otros cinco campos. La corrección humana del 14-ago
 * —"9:30 AM" / "6:30 PM", escrito por una persona— se perdió sin que nada
 * saltara. Reconstruido desde los respaldos de 6 h del VPS.
 *
 * Este script **declara** lo que va a tocar y aborta si cambia cualquier otra
 * cosa de la fila. Es la regla nueva del proyecto aplicada a la operación que
 * la hizo necesaria.
 *
 * Uso:
 *   pnpm restaurar:horario <organizationId> <abre> <cierra> [--aplicar]
 *   pnpm restaurar:horario <organizationId> --revertir
 *
 * Ejemplo (el salón):
 *   pnpm restaurar:horario org_novxv78s08h12arzatr2 "9:30 AM" "6:30 PM" --aplicar
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { normalizarHora } from "@/lib/hora";
import { diasAbiertos, horarioCanonico, horarioNormalizado } from "@/server/horario";
import { compararFila, explicar, type Fila } from "@/server/ai/generador/comparar-fila";
import { leerFicha, aSecciones, esPorSecciones } from "@/server/ai/generador/leer-ficha";

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
const revertir = process.argv.includes("--revertir");
const aplicar = process.argv.includes("--aplicar");
const abre = process.argv[3];
const cierra = process.argv[4];

if (!organizationId || (!revertir && (!abre || !cierra))) {
  console.error('Uso: pnpm restaurar:horario <organizationId> "<abre>" "<cierra>" [--aplicar]');
  console.error("     pnpm restaurar:horario <organizationId> --revertir");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });
const TABLA = "agent_profile_bk_horario";

/** La fila ENTERA, que es lo único que sirve para comparar. */
async function filaCompleta(): Promise<Fila> {
  const [f] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  return f as unknown as Fila;
}

const antes = await filaCompleta();
if (!antes) {
  console.error("[horario] esa organización no existe");
  process.exit(1);
}

console.log(`\n${"=".repeat(72)}`);
console.log("RESTAURAR EL HORARIO — con comparación de FILA COMPLETA");
console.log(`${"=".repeat(72)}`);
console.log(`\nahora: columnas ${antes.hoursOpen} – ${antes.hoursClose} · días ${antes.hoursDays}`);

// --------------------------------------------------------------- REVERTIR
if (revertir) {
  const filas = await sql.unsafe(
    `SELECT hours_open, hours_close, ficha FROM ${TABLA} WHERE organization_id = $1`,
    [organizationId]
  );
  const previo = filas[0] as { hours_open: string; hours_close: string; ficha: string } | undefined;
  if (!previo) {
    console.error("[horario] ⛔ no hay respaldo: no se puede revertir.");
    process.exit(1);
  }
  await db
    .update(schema.agentProfile)
    .set({ hoursOpen: previo.hours_open, hoursClose: previo.hours_close, ficha: previo.ficha })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  const vuelta = await filaCompleta();
  const c = compararFila(antes, vuelta, ["hoursOpen", "hoursClose", "ficha"]);
  console.log(`\n${explicar(c)}`);
  console.log(
    vuelta.hoursOpen === previo.hours_open && vuelta.hoursClose === previo.hours_close && vuelta.ficha === previo.ficha
      ? "\n✅ ROLLBACK CORRECTO: las dos copias vuelven al estado previo."
      : "\n🔴 ROLLBACK INCOMPLETO"
  );
  await sql.end();
  process.exit(0);
}

// --------------------------------------------------- CALCULAR EL CAMBIO
const abreNorm = normalizarHora(abre);
const cierraNorm = normalizarHora(cierra);
if (!abreNorm || !cierraNorm) {
  console.error(`[horario] ⛔ no entiendo "${abre}" o "${cierra}". Usa "9:30 AM" o "09:30".`);
  process.exit(1);
}

const ficha = leerFicha(antes.ficha as string);
if (!ficha) {
  console.error("[horario] ⛔ este negocio no tiene ficha: solo se tocarían las columnas, y eso volvería a divergir.");
  process.exit(1);
}

// La ficha guarda lo que escribiría una persona; las columnas, lo normalizado.
const fichaNueva = {
  ...(ficha as unknown as Record<string, unknown>),
  /*
   * El horario se escribe SIEMPRE por el canónico (20-sep-2026).
   *
   * Antes aquí se ponían `abre`/`cierra` directamente sobre el horario viejo.
   * Desde el rediseño eso dejaría `porDia` —que es lo que de verdad manda—
   * con el horario anterior, y el arreglo no serviría de nada: el mismo tipo
   * de contradicción que este script nació para reparar.
   *
   * Los días NO se tocan: este script cambia la franja, no qué días abre.
   */
  horario: horarioNormalizado(
    Object.fromEntries(
      diasAbiertos(
        horarioCanonico(
          (ficha as unknown as { horario?: Record<string, unknown> }).horario ?? {}
        )
      ).map((d) => [d, { abre: abreNorm, cierra: cierraNorm }])
    )
  ),
};
const eraPorSecciones = esPorSecciones(JSON.parse(antes.ficha as string));
const fichaSerializada = JSON.stringify(
  eraPorSecciones ? aSecciones(fichaNueva as never) : fichaNueva
);

console.log(`\nse pondría:`);
console.log(`  columnas : ${abreNorm} – ${cierraNorm}`);
console.log(`  ficha    : ${JSON.stringify((fichaNueva as { horario: { porDia: unknown } }).horario.porDia)}`);
console.log(`\ncampos DECLARADOS: hoursOpen, hoursClose, ficha, updatedAt`);

if (!aplicar) {
  console.log("\n(no se ha escrito nada: falta --aplicar)");
  await sql.end();
  process.exit(0);
}

// ---------------------------------------------------------------- APLICAR
await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${TABLA} (
  organization_id text PRIMARY KEY,
  hours_open text, hours_close text, ficha text, guardado_en timestamp DEFAULT now()
)`);
await sql.unsafe(
  `INSERT INTO ${TABLA} (organization_id, hours_open, hours_close, ficha)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (organization_id) DO UPDATE
   SET hours_open = EXCLUDED.hours_open, hours_close = EXCLUDED.hours_close,
       ficha = EXCLUDED.ficha, guardado_en = now()`,
  [organizationId, antes.hoursOpen as string, antes.hoursClose as string, antes.ficha as string]
);
console.log(`\n💾 respaldo en ${TABLA}`);

await db
  .update(schema.agentProfile)
  .set({
    hoursOpen: abreNorm,
    hoursClose: cierraNorm,
    ficha: fichaSerializada,
    updatedAt: new Date(),
  })
  .where(eq(schema.agentProfile.organizationId, organizationId));

const despues = await filaCompleta();
const c = compararFila(antes, despues, ["hoursOpen", "hoursClose", "ficha", "updatedAt"]);

console.log(`\nFILA COMPLETA, antes contra después:`);
console.log(explicar(c));

const fichaFinal = leerFicha(despues.ficha as string) as unknown as {
  horario?: { abre?: string; cierra?: string };
};
console.log(`\nlas dos copias:`);
console.log(`  columnas : ${despues.hoursOpen} – ${despues.hoursClose}`);
console.log(`  ficha    : "${fichaFinal.horario?.abre}" / "${fichaFinal.horario?.cierra}"`);
console.log(
  c.ok && despues.hoursOpen === abreNorm && despues.hoursClose === cierraNorm
    ? "\n✅ RESTAURADO, y nada más cambió en la fila."
    : "\n🔴 ALGO MÁS CAMBIÓ: revisar arriba."
);
console.log(`   rollback: pnpm restaurar:horario ${organizationId} --revertir`);

await sql.end();
process.exit(c.ok ? 0 : 1);
