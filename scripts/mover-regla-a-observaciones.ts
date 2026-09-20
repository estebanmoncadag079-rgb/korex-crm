/**
 * Mueve UNA regla propia de un negocio a `ficha.observacionesHorario`.
 *
 * ## Por qué existe
 *
 * `reglasPropias` es un cajón de texto libre que el operador escribe tras un
 * incidente, y ahí acaba cayendo de todo: conducta, política comercial,
 * enlaces… y también horarios. Un horario ahí no decide nada —el backend no
 * lo lee— pero el modelo sí lo recita, y cuando el negocio cambia su horario
 * en la pantalla ese texto se queda viejo y lo contradice.
 *
 * `observacionesHorario` es el sitio correcto para lo segundo: contexto de
 * horario, que el agente puede contar y que **no puede decidir nada** (ver
 * `@/server/horario`). Este script hace el traslado sin reescribir una sola
 * palabra del negocio.
 *
 * ## Por qué UNA regla y por índice
 *
 * Porque cuál de ellas es "de horario" es una lectura humana, no algo que un
 * script pueda adivinar sin equivocarse. El caso que lo pidió (Lis,
 * 20-sep-2026): de sus seis reglas, solo una hablaba de horarios — las otras
 * cinco eran el enlace de Rappi, cómo estructurar las respuestas, mandar el
 * catálogo primero y cómo escribir el total. Mover "todo lo que mencione una
 * hora" le habría vaciado media configuración.
 *
 * Nunca concatena: si ya hay observaciones, **se detiene**. Pegar dos textos
 * que nadie escribió juntos es inventar redacción.
 *
 * Uso:
 *   pnpm mover:regla <organizationId> <indice>            → enseña, NO escribe
 *   pnpm mover:regla <organizationId> <indice> --aplicar  → escribe, con respaldo
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { leerFicha, serializarComoEstaba } from "@/server/ai/generador/leer-ficha";
import { conRegistro } from "@/server/registro-de-cambios";

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

const aplicar = process.argv.includes("--aplicar");
const libres = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const organizationId = libres[0];
const indice = Number(libres[1]);

if (!organizationId || !Number.isInteger(indice) || indice < 0) {
  console.error("Uso: pnpm mover:regla <organizationId> <indice> [--aplicar]");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const [fila] = await db
  .select({ nombre: schema.organization.name, ficha: schema.agentProfile.ficha })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  )
  .where(eq(schema.agentProfile.organizationId, organizationId));

if (!fila?.ficha) {
  console.error(`[mover-regla] ⛔ ${organizationId} no existe o no tiene ficha guardada.`);
  await sql.end();
  process.exit(1);
}

const ficha = leerFicha(fila.ficha);
if (!ficha) {
  console.error("[mover-regla] ⛔ su ficha no es JSON válido.");
  await sql.end();
  process.exit(1);
}

const reglas = ficha.reglasPropias ?? [];
const regla = reglas[indice];
if (regla === undefined) {
  console.error(
    `[mover-regla] ⛔ ${fila.nombre} no tiene una regla en el índice ${indice} ` +
      `(tiene ${reglas.length}).`
  );
  await sql.end();
  process.exit(1);
}

if (ficha.observacionesHorario?.trim()) {
  console.error(
    "[mover-regla] ⛔ este negocio YA tiene observaciones de horario. Este script no " +
      "concatena: pegar dos textos que nadie escribió juntos es inventar redacción. " +
      "Edítalo desde su pantalla."
  );
  console.error(`    tiene: ${JSON.stringify(ficha.observacionesHorario)}`);
  await sql.end();
  process.exit(1);
}

console.log("─".repeat(74));
console.log(`▸ ${fila.nombre}`);
console.log(`\n  SE MUEVE (reglasPropias[${indice}] → observacionesHorario), TAL CUAL:`);
console.log(`    ${JSON.stringify(regla)}`);
console.log(`\n  SE QUEDAN en reglasPropias (${reglas.length - 1}):`);
reglas.forEach((r, i) => {
  if (i !== indice) console.log(`    [${i}] ${JSON.stringify(r.slice(0, 90))}`);
});

const fichaNueva = {
  ...ficha,
  reglasPropias: reglas.filter((_, i) => i !== indice),
  observacionesHorario: regla,
};
const serializada = serializarComoEstaba(fila.ficha, fichaNueva);

/*
 * Y antes de escribir: que no se haya movido nada más. Se comparan las dos
 * fichas SIN los dos campos que esto puede tocar — si difieren en algo más,
 * no se escribe. Una limpieza que de paso se come un dato del negocio es
 * peor que no limpiar.
 */
const resto = (f: unknown) => {
  const { reglasPropias: _r, observacionesHorario: _o, ...x } = (f ?? {}) as Record<string, unknown>;
  void _r;
  void _o;
  return JSON.stringify(x, Object.keys(x).sort());
};
if (resto(ficha) !== resto(leerFicha(serializada))) {
  console.error("\n  🔴 la reserialización cambiaría algo más que esos dos campos: NO se escribe.");
  await sql.end();
  process.exit(1);
}
console.log("\n  ✔ ningún otro campo de la ficha cambia.");

if (!aplicar) {
  console.log("\n[mover-regla] no se escribió nada (falta --aplicar)");
  await sql.end();
  process.exit(0);
}

const sufijo = new Date().toISOString().slice(0, 10).replace(/-/g, "");
await sql.unsafe(
  `CREATE TABLE IF NOT EXISTS agent_profile_bk_reglas_${sufijo} AS SELECT * FROM agent_profile`
);
console.log(`\n[mover-regla] respaldo: agent_profile_bk_reglas_${sufijo}`);

const leerFilaCompleta = async () => {
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
    leerFila: leerFilaCompleta,
    declarados: ["ficha", "updatedAt"],
    proceso: "mover:regla",
    actor: "script:mover:regla",
  },
  async () =>
    db
      .update(schema.agentProfile)
      .set({ ficha: serializada, updatedAt: new Date() })
      .where(eq(schema.agentProfile.organizationId, organizationId))
);

const [despues] = await db
  .select({ ficha: schema.agentProfile.ficha })
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, organizationId));
const releida = leerFicha(despues!.ficha);
const ok =
  releida?.observacionesHorario === regla &&
  (releida?.reglasPropias?.length ?? -1) === reglas.length - 1;
console.log(ok ? "✅ movido y verificado releyendo de la base." : "🔴 la verificación posterior NO cuadra.");

await sql.end();
process.exit(ok ? 0 : 1);
