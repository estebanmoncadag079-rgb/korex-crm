/**
 * Vuelve a ensamblar el prompt de TODOS los clientes con la conducta al día.
 *
 * **Por qué existe**: el prompt de cada negocio queda materializado en
 * `agent_profile.instructions`. Cuando se aprende algo nuevo y se escribe en
 * `conducta.ts`, esa lección solo la heredaban los clientes dados de alta
 * después — los que ya estaban vendiendo se quedaban con la versión vieja, que
 * es justo al revés de como debería ser: los que llevan meses son los que más
 * incidentes han pagado.
 *
 * Con la ficha guardada (columna `ficha`, migración 0019) el prompt se puede
 * rehacer sin volver a escribir nada.
 *
 * Uso:
 *   pnpm regenerar:flota              → enseña qué cambiaría, NO escribe
 *   pnpm regenerar:flota --aplicar    → escribe, con respaldo previo
 *
 * Los clientes sin ficha (prompts escritos a mano, sin migrar) se saltan y se
 * listan al final: no se les toca a ciegas.
 */
import { readFileSync } from "node:fs";
import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { generarPerfil } from "@/server/ai/generador/generar";
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
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const aplicar = process.argv.includes("--aplicar");
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const perfiles = await db
  .select({
    organizationId: schema.agentProfile.organizationId,
    nombre: schema.organization.name,
    ficha: schema.agentProfile.ficha,
    instructions: schema.agentProfile.instructions,
  })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  )
  .where(isNotNull(schema.agentProfile.ficha));

const todos = await db
  .select({
    nombre: schema.organization.name,
    ficha: schema.agentProfile.ficha,
  })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  );

if (aplicar) {
  // Un respaldo por corrida, con la fecha en el nombre: si una conducta nueva
  // empeora a alguien, se vuelve atrás copiando de aquí.
  const sufijo = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS agent_profile_bk_regen_${sufijo} AS SELECT * FROM agent_profile`
  );
  console.log(`[regenerar] respaldo: agent_profile_bk_regen_${sufijo}`);
}

for (const p of perfiles) {
  let ficha: FichaDelNegocio;
  try {
    ficha = JSON.parse(p.ficha!) as FichaDelNegocio;
  } catch {
    console.error(`[regenerar] ${p.nombre}: su ficha guardada no es JSON válido, se salta`);
    continue;
  }

  let perfil;
  try {
    perfil = generarPerfil(ficha);
  } catch (err) {
    // `faltantesDeLaFicha` frena antes de romper: mejor dejar el prompt viejo
    // que escribir uno al que le falta lo esencial.
    console.error(`[regenerar] ${p.nombre}: ${(err as Error).message}`);
    continue;
  }

  const antes = p.instructions?.length ?? 0;
  const despues = perfil.instructions.length;
  const igual = p.instructions === perfil.instructions;
  console.log(
    `[regenerar] ${p.nombre}: ${antes} → ${despues} caracteres${igual ? " (sin cambios)" : ""}`
  );

  if (!aplicar || igual) continue;
  await db
    .update(schema.agentProfile)
    .set({
      name: `Asistente de ${ficha.nombre}`,
      instructions: perfil.instructions,
      escalationRules: perfil.escalationRules,
      greeting: perfil.greeting,
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, p.organizationId));
}

const sinFicha = todos.filter((t) => !t.ficha).map((t) => t.nombre);
if (sinFicha.length) {
  console.log(`\n[regenerar] SIN ficha (no se tocan): ${sinFicha.join(", ")}`);
  console.log("[regenerar] migrarlos es lo que hace que hereden las lecciones nuevas.");
}
if (!aplicar) console.log("\n[regenerar] no se escribió nada (falta --aplicar)");

await sql.end();
process.exit(0);
