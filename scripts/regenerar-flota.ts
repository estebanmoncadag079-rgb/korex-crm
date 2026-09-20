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
 *   pnpm regenerar:flota                        → enseña qué cambiaría, NO escribe
 *   pnpm regenerar:flota --aplicar              → escribe, con respaldo previo
 *   pnpm regenerar:flota <organizationId>       → solo ESE cliente
 *   pnpm regenerar:flota <organizationId> --aplicar
 *
 * Los clientes sin ficha (prompts escritos a mano, sin migrar) se saltan y se
 * listan al final: no se les toca a ciegas.
 */
import { readFileSync } from "node:fs";
import { and, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro } from "@/server/registro-de-cambios";
import { generarPerfil } from "@/server/ai/generador/generar";
import { opcionesDeGeneracion } from "@/server/ai/generador/fuentes";
import { leerFicha } from "@/server/ai/generador/leer-ficha";

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
/**
 * Un `organizationId` suelto acota la regeneración a ESE cliente.
 *
 * Sin el filtro, regenerar era todo o nada — y como cada mejora de
 * `conducta.ts` deja a los prompts guardados por detrás, «todo» significa
 * empujar lecciones nuevas a varios negocios vivos a la vez. El 20-ago-2026
 * hizo falta arreglar la deriva de UN cliente (llevaba el catálogo duplicado
 * en el prompt) sin tocar a los otros dos, que tenían su propia deriva
 * pendiente de decisión.
 *
 * Es el mismo argumento que ya aceptan `migrar:catalogo`, `migrar:requisitos`,
 * `convertir:ficha` y `fase2`: en una plataforma con muchos negocios, «a
 * todos» tiene que ser una elección, no el único modo.
 */
const soloEsteCliente = process.argv.slice(2).find((a) => !a.startsWith("--"));

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const perfiles = await db
  .select({
    organizationId: schema.agentProfile.organizationId,
    nombre: schema.organization.name,
    ficha: schema.agentProfile.ficha,
    instructions: schema.agentProfile.instructions,
    /*
     * Las columnas que deciden qué puede ir en el prompt, TODAS.
     *
     * Aquí faltaban `payment_source` y `delivery_source`, y ese olvido es lo
     * que convertía este script en el que deshacía las migraciones: La Churra
     * quedó en 13.837 caracteres tras `migrar:pago` y regenerar la devolvía a
     * 14.023, reponiendo el bloque de pago que ya inyecta el pipeline.
     * Traducirlas es cosa de `opcionesDeGeneracion`, no de este script.
     */
    catalogSource: schema.agentProfile.catalogSource,
    paymentSource: schema.agentProfile.paymentSource,
    deliverySource: schema.agentProfile.deliverySource,
    menuMode: schema.agentProfile.menuMode,
    appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
  })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  )
  .where(
    soloEsteCliente
      ? and(
          isNotNull(schema.agentProfile.ficha),
          eq(schema.agentProfile.organizationId, soloEsteCliente)
        )
      : isNotNull(schema.agentProfile.ficha)
  );

if (soloEsteCliente && perfiles.length === 0) {
  console.error(
    `[regenerar] ⛔ ${soloEsteCliente} no existe o no tiene ficha guardada: no hay nada que recompilar.`
  );
  await sql.end();
  process.exit(1);
}

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
  // Lector tolerante: entiende la ficha plana y la de secciones, así que este
  // script sigue funcionando durante toda la conversión y después de ella.
  const ficha = leerFicha(p.ficha);
  if (!ficha) {
    console.error(`[regenerar] ${p.nombre}: su ficha guardada no es JSON válido, se salta`);
    continue;
  }

  let perfil;
  try {
    perfil = generarPerfil(ficha, opcionesDeGeneracion(p));
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
  const leerFila = async () => {
    const [f] = await db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, p.organizationId));
    return (f as unknown as Fila) ?? null;
  };
  await conRegistro(
    {
      tabla: "agent_profile",
      registro: p.organizationId,
      leerFila,
      declarados: ["name", "instructions", "escalationRules", "greeting", "updatedAt"],
      proceso: "regenerar:flota",
      actor: "script:regenerar:flota",
    },
    async () =>
      db.update(schema.agentProfile).set({
      name: `Asistente de ${ficha.nombre}`,
      instructions: perfil.instructions,
      escalationRules: perfil.escalationRules,
      greeting: perfil.greeting,
      updatedAt: new Date(),
    })
      .where(eq(schema.agentProfile.organizationId, p.organizationId))
  );
}

const sinFicha = todos.filter((t) => !t.ficha).map((t) => t.nombre);
if (sinFicha.length) {
  console.log(`\n[regenerar] SIN ficha (no se tocan): ${sinFicha.join(", ")}`);
  console.log("[regenerar] migrarlos es lo que hace que hereden las lecciones nuevas.");
}
if (!aplicar) console.log("\n[regenerar] no se escribió nada (falta --aplicar)");

await sql.end();
process.exit(0);
