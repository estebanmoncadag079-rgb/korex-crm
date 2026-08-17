/**
 * Escribe los requisitos de cierre en las fichas que aún no los declaran.
 *
 * **Por qué existe este script y no una función con valores por defecto.**
 *
 * El 17-ago, al sacar `entrega` del núcleo, hizo falta un respaldo para los
 * cuatro negocios dados de alta antes: sus fichas no traían `cierre`, y sin él
 * habrían cerrado pedidos sin pedir un nombre. Ese respaldo se escribió como una
 * función que devolvía una lista por vertical… y esa forma tiene un destino
 * conocido:
 *
 *     if (vertical === "pedidos")      return [...];
 *     if (vertical === "citas")        return [...];
 *     if (vertical === "reparaciones") return [...];   // ← seis meses después
 *
 * Que es el conocimiento del negocio volviendo al código por la puerta de atrás.
 *
 * Así que la traducción vive aquí: **se ejecuta una vez, escribe datos, y se
 * acaba**. Un vertical nuevo no añade una rama a ninguna función — declara sus
 * requisitos en su ficha, como cualquier otro dato del negocio.
 *
 * Uso:
 *   pnpm migrar:requisitos                 # TODAS las fichas, solo simula
 *   pnpm migrar:requisitos <organizationId>
 *   pnpm migrar:requisitos <organizationId> --aplicar
 *
 * Sin `--aplicar` no escribe nada: enseña la ficha antes y después.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { leerFicha } from "@/server/ai/generador/leer-ficha";
import {
  requisitosDe,
  requisitosSugeridos,
  type FichaDelNegocio,
} from "@/server/ai/generador/ficha";
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

const soloEste = process.argv[2]?.startsWith("org_") ? process.argv[2] : undefined;
const aplicar = process.argv.includes("--aplicar");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });

  const perfiles = await db
    .select({
      organizationId: schema.agentProfile.organizationId,
      ficha: schema.agentProfile.ficha,
    })
    .from(schema.agentProfile);

  const objetivo = soloEste
    ? perfiles.filter((p) => p.organizationId === soloEste)
    : perfiles;

  console.log(`\n${aplicar ? "APLICANDO" : "SIMULACIÓN (sin --aplicar no se escribe nada)"}\n`);

  let migradas = 0;
  for (const p of objetivo) {
    const cruda = leerFicha(p.ficha);
    if (!cruda) {
      console.log(`— ${p.organizationId}: sin ficha (prompt manual). Se salta.`);
      continue;
    }
    const ficha = cruda as unknown as FichaDelNegocio;

    if (requisitosDe(ficha)) {
      console.log(`✔ ${p.organizationId}: ya los declara. No se toca.`);
      continue;
    }

    const sugeridos = requisitosSugeridos(ficha);
    console.log(`\n▸ ${p.organizationId} (${ficha.vertical})`);
    for (const r of sugeridos) {
      console.log(`    ${r.obligatorio ? "obligatorio" : "opcional   "}  ${r.id} — ${r.etiqueta}`);
    }

    if (!aplicar) {
      migradas++;
      continue;
    }

    const nueva = JSON.stringify({ ...cruda, cierre: { requisitos: sugeridos } });
    await conRegistro(
      {
        tabla: "agent_profile",
        registro: p.organizationId,
        leerFila: async () => {
          const [f] = await db
            .select()
            .from(schema.agentProfile)
            .where(eq(schema.agentProfile.organizationId, p.organizationId));
          return (f as unknown as Record<string, unknown>) ?? null;
        },
        declarados: ["ficha", "updatedAt"],
        proceso: "migrar:requisitos",
        actor: "script:migrar-requisitos",
      },
      async () =>
        db
          .update(schema.agentProfile)
          .set({ ficha: nueva, updatedAt: new Date() })
          .where(eq(schema.agentProfile.organizationId, p.organizationId))
    );
    migradas++;
  }

  console.log(
    `\n${aplicar ? "Migradas" : "Se migrarían"}: ${migradas} ficha(s).` +
      (aplicar
        ? "\n⚠️ El PROMPT no cambia por esto: los requisitos los lee el pipeline, no el texto."
        : "\nRepite con --aplicar cuando la lista de arriba te parezca correcta.")
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
