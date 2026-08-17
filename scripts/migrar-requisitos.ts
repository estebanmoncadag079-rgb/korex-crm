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
import {
  aSecciones,
  camposSinDueño,
  esPorSecciones,
  leerFicha,
} from "@/server/ai/generador/leer-ficha";
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
/**
 * Devuelve a las secciones una ficha que se guardó aplanada.
 *
 * Existe por un error real del 17-ago: la primera versión de este script leyó
 * con `leerFicha` —que aplana— y guardó eso, destruyendo el modelo por secciones
 * de dos fichas. Repararlo NO es solo convertir: `aSecciones` reparte por una
 * lista escrita a mano y **tira lo que no esté en ella**, así que aquí se
 * comprueba la ida y la vuelta antes de escribir una sola fila.
 */
const repararForma = process.argv.includes("--reparar-forma");

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
    /*
     * ⚠️ `leerFicha` APLANA: devuelve la ficha lista para el generador, sin sus
     * secciones. Guardar eso tal cual **destruye el modelo por secciones** —que
     * es lo que impide que el cuestionario del cliente pise lo que escribió la
     * agencia— y pasó de verdad el 17-ago con estas dos fichas. Por eso se
     * mira la forma ORIGINAL y se devuelve en la misma.
     */
    const original = (() => {
      try {
        return JSON.parse(p.ficha ?? "");
      } catch {
        return null;
      }
    })();
    const guardarPorSecciones = esPorSecciones(original);
    const cruda = leerFicha(p.ficha);
    if (!cruda) {
      console.log(`— ${p.organizationId}: sin ficha (prompt manual). Se salta.`);
      continue;
    }
    const ficha = cruda as unknown as FichaDelNegocio;

    if (repararForma) {
      if (guardarPorSecciones) {
        console.log(`✔ ${p.organizationId}: ya está por secciones. No se toca.`);
        continue;
      }
      const sinDueño = camposSinDueño(ficha);
      const enSecciones = aSecciones(ficha);
      /*
       * Se compara el CONTENIDO, no la serialización: al repartir por secciones
       * y volver a juntar, el orden de las claves cambia y `JSON.stringify` las
       * daba por distintas siendo idénticas. Con las claves ordenadas, la
       * comparación dice lo que se quiere saber — si se perdió algo.
       */
      const canonico = (o: unknown): string =>
        JSON.stringify(o, (_k, v) =>
          v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
            : v
        );
      const iguales = canonico(leerFicha(JSON.stringify(enSecciones))) === canonico(cruda);

      console.log(`
▸ ${p.organizationId}`);
      console.log(`    campos sin dueño : ${sinDueño.length ? sinDueño.join(", ") : "ninguno"}`);
      console.log(`    ida y vuelta     : ${iguales ? "IDÉNTICA" : "⚠️ DISTINTA"}`);

      if (sinDueño.length || !iguales) {
        console.log("    ⛔ NO se repara: la conversión perdería algo.");
        continue;
      }
      if (!aplicar) {
        migradas++;
        continue;
      }
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
          proceso: "migrar:requisitos --reparar-forma",
          actor: "script:migrar-requisitos",
        },
        async () =>
          db
            .update(schema.agentProfile)
            .set({ ficha: JSON.stringify(enSecciones), updatedAt: new Date() })
            .where(eq(schema.agentProfile.organizationId, p.organizationId))
      );
      migradas++;
      continue;
    }

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

    const conCierre = { ...cruda, cierre: { requisitos: sugeridos } } as FichaDelNegocio;
    const nueva = JSON.stringify(
      guardarPorSecciones ? aSecciones(conCierre) : conCierre
    );
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
