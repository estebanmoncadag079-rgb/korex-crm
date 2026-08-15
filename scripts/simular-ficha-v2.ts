/**
 * Simulación del backfill de la ficha por secciones. **NO ESCRIBE NADA.**
 *
 * Encargo del dueño (15-ago-2026): antes de tocar la base, simular la
 * conversión sobre toda la flota y comparar, cliente por cliente:
 *
 *   ficha actual  ↔  ficha convertida
 *   prompt actual ↔  prompt recompilado
 *
 * Y de paso responde la pregunta que decide si la arquitectura funciona:
 * **¿se puede tirar el prompt y recompilarlo idéntico desde la ficha?** Si la
 * respuesta es sí, `instructions` deja de ser un dato que hay que custodiar y
 * pasa a ser lo que siempre debió ser: un artefacto reproducible.
 *
 * Uso:
 *   pnpm simular:ficha
 *   pnpm simular:ficha --ver <organizationId>   (enseña el diff de ese cliente)
 */
import { readFileSync, writeFileSync } from "node:fs";
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

/**
 * El reparto propuesto: cada sección, un dueño.
 *
 * `catalogo` y `duracionTipicaMin` se quedan en `negocio` **a propósito**
 * aunque el catálogo esté migrando a `product`: mientras un cliente siga en
 * `catalog_source = 'prompt'`, ese texto es su carta. La sección desaparece
 * sola cuando toda la flota esté en tablas.
 */
const DE_NEGOCIO = [
  "nombre",
  "queVende",
  "ubicacion",
  "horario",
  "vertical",
  "catalogo",
  "duracionTipicaMin",
  "variantes",
  "entrega",
  "pago",
  "tono",
  "regalos",
  "preguntasFrecuentes",
] as const;

/** Lo que ajusta el operador y el cuestionario NO debe tocar. */
const DE_FLUJO = ["reglasPropias", "saludoInicial"] as const;

/**
 * La sección `politicas`, que la primera versión de este script daba por
 * vacía… y la simulación demostró que no lo está: `escalarSiempre` y
 * `nuncaPrometer` se perdían en la conversión, y con ellos las reglas de
 * escalado y las promesas prohibidas —incluidas las de salud—.
 *
 * Es justo el tipo de dato que no puede tener dos escritores: son las reglas
 * que se ajustan a mano después de un incidente.
 */
const DE_POLITICAS = ["escalarSiempre", "nuncaPrometer"] as const;

type FichaV2 = {
  schema_version: 2;
  negocio: Record<string, unknown>;
  flujo: Record<string, unknown>;
  politicas: Record<string, unknown>;
};

function aV2(ficha: FichaDelNegocio): FichaV2 {
  const f = ficha as unknown as Record<string, unknown>;
  const negocio: Record<string, unknown> = {};
  const flujo: Record<string, unknown> = {};
  const politicas: Record<string, unknown> = {};
  for (const k of DE_NEGOCIO) if (f[k] !== undefined) negocio[k] = f[k];
  for (const k of DE_FLUJO) if (f[k] !== undefined) flujo[k] = f[k];
  for (const k of DE_POLITICAS) if (f[k] !== undefined) politicas[k] = f[k];
  return { schema_version: 2, negocio, flujo, politicas };
}

/** Y la vuelta: de las secciones al objeto que `generarPerfil` ya sabe leer. */
function aFicha(v2: FichaV2): FichaDelNegocio {
  return { ...v2.negocio, ...v2.flujo, ...v2.politicas } as unknown as FichaDelNegocio;
}

const url = envVar("DATABASE_URL");
if (!url) {
  console.error("[simular] falta DATABASE_URL");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const perfiles = await db
  .select({
    organizationId: schema.agentProfile.organizationId,
    nombre: schema.organization.name,
    ficha: schema.agentProfile.ficha,
    instructions: schema.agentProfile.instructions,
    greeting: schema.agentProfile.greeting,
    escalationRules: schema.agentProfile.escalationRules,
    catalogSource: schema.agentProfile.catalogSource,
  })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  )
  .where(isNotNull(schema.agentProfile.ficha));

const todos = await db
  .select({ nombre: schema.organization.name, ficha: schema.agentProfile.ficha })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  );

const iVer = process.argv.indexOf("--ver");
const verA = iVer === -1 ? null : process.argv[iVer + 1];

/** Primera línea distinta entre dos textos, para no volcar 17.000 caracteres. */
function primeraDiferencia(a: string, b: string): string | null {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return `línea ${i + 1}\n    guardado : ${JSON.stringify(la[i] ?? "(no existe)")}\n    recompilado: ${JSON.stringify(lb[i] ?? "(no existe)")}`;
    }
  }
  return null;
}

const informe: unknown[] = [];
let identicos = 0;

console.log(`\n${"=".repeat(74)}`);
console.log("SIMULACIÓN — ficha por secciones · NO SE ESCRIBE NADA");
console.log(`${"=".repeat(74)}`);

for (const p of perfiles) {
  console.log(`\n▸ ${p.nombre}  [catalog_source=${p.catalogSource}]`);

  let ficha: FichaDelNegocio;
  try {
    ficha = JSON.parse(p.ficha!) as FichaDelNegocio;
  } catch {
    console.log("   ⛔ su ficha no es JSON válido: se saltaría");
    continue;
  }

  // 1) ¿La conversión pierde algo por el camino?
  const v2 = aV2(ficha);
  const original = Object.keys(ficha as unknown as Record<string, unknown>).sort();
  const reconstruida = Object.keys(aFicha(v2) as unknown as Record<string, unknown>).sort();
  const perdidos = original.filter((k) => !reconstruida.includes(k));

  console.log(`   ficha: ${original.length} campos → negocio ${Object.keys(v2.negocio).length} · flujo ${Object.keys(v2.flujo).length} · politicas ${Object.keys(v2.politicas).length}`);
  if (perdidos.length) {
    console.log(`   🔴 CAMPOS QUE SE PERDERÍAN: ${perdidos.join(", ")}`);
  } else {
    console.log("   ✅ ningún campo se pierde en la conversión");
  }

  // 2) ¿El prompt recompilado es idéntico al guardado? (la prueba de fuego)
  const opciones = { catalogoEnTabla: p.catalogSource === "tabla" };
  let recompilado;
  try {
    recompilado = generarPerfil(aFicha(v2), opciones);
  } catch (err) {
    console.log(`   🔴 no se puede recompilar: ${(err as Error).message}`);
    informe.push({ cliente: p.nombre, error: (err as Error).message });
    continue;
  }

  const igualPrompt = recompilado.instructions === (p.instructions ?? "");
  const igualSaludo = recompilado.greeting === (p.greeting ?? "");
  const igualEscalado = recompilado.escalationRules === (p.escalationRules ?? "");

  console.log(
    `   prompt: ${(p.instructions ?? "").length} guardado vs ${recompilado.instructions.length} recompilado → ${igualPrompt ? "✅ IDÉNTICO" : "🔴 DIFERENTE"}`
  );
  console.log(`   saludo ${igualSaludo ? "✅" : "🔴"} · escalado ${igualEscalado ? "✅" : "🔴"}`);

  if (igualPrompt && igualSaludo && igualEscalado) identicos++;
  else {
    const d = primeraDiferencia(p.instructions ?? "", recompilado.instructions);
    if (d) console.log(`   primera diferencia en el prompt: ${d}`);
  }

  informe.push({
    cliente: p.nombre,
    organizationId: p.organizationId,
    campos: { original: original.length, negocio: Object.keys(v2.negocio), flujo: Object.keys(v2.flujo), politicas: Object.keys(v2.politicas), perdidos },
    prompt: {
      largoGuardado: (p.instructions ?? "").length,
      largoRecompilado: recompilado.instructions.length,
      identico: igualPrompt,
      saludoIdentico: igualSaludo,
      escaladoIdentico: igualEscalado,
      primeraDiferencia: igualPrompt ? null : primeraDiferencia(p.instructions ?? "", recompilado.instructions),
    },
  });

  if (verA && (verA === p.organizationId || verA === p.nombre)) {
    console.log("\n--- ficha convertida ---");
    console.log(JSON.stringify(v2, null, 2).slice(0, 2000));
  }
}

const sinFicha = todos.filter((t) => !t.ficha).map((t) => t.nombre);

console.log(`\n${"=".repeat(74)}`);
console.log(`RESULTADO: ${identicos} de ${perfiles.length} clientes recompilan IDÉNTICO`);
if (sinFicha.length) console.log(`Sin ficha (no migrables): ${sinFicha.join(", ")}`);
console.log(`${"=".repeat(74)}`);

writeFileSync("simulacion-ficha-v2.json", JSON.stringify(informe, null, 2), "utf8");
console.log("\ninforme detallado: simulacion-ficha-v2.json");
console.log("⛔ no se ha escrito NADA en la base de datos.");

await sql.end();
process.exit(0);
