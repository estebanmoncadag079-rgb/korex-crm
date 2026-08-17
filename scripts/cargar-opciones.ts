/**
 * Carga ADITIVA de grupos de opciones. **Solo INSERT: jamás borra ni actualiza.**
 *
 * Existe porque `migrar:catalogo --aplicar` borra el catálogo entero y lo recrea
 * desde el texto de la ficha, y eso aquí sería destructivo: las salsas en tablas
 * están **mejor** que en la ficha (1/2/3/5 por presentación, mientras el texto
 * solo sabe decir "elige 4"). La regla que lo gobierna, del dueño:
 *
 *   **Nunca degrades un dato correcto para unificarlo con uno peor.**
 *
 * Así que este comando solo añade lo que falta —`RECUBIERTO` y `ADICIONES`— y no
 * toca productos, salsas ni IDs existentes.
 *
 * Uso:
 *   pnpm cargar:opciones <organizationId>              → SIMULA, enseña el SQL
 *   pnpm cargar:opciones <organizationId> --aplicar    → ejecuta esos INSERT
 */
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { leerCatalogoDeTexto } from "@/server/catalog/sembrar";
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

const organizationId = process.argv[2];
if (!organizationId || organizationId.startsWith("--")) {
  console.error("Uso: pnpm cargar:opciones <organizationId> [--aplicar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");

/**
 * Grupos que este comando puede cargar. Las SALSAS **no están** a propósito: en
 * tablas ya son correctas y el parser las lee peor.
 */
const CARGABLES = ["RECUBIERTO", "ADICIONES"];

/**
 * Opciones excluidas hasta que una persona decida qué significan.
 *
 * `"Ambas"` es ambigua: ¿azúcar y canela?, ¿las dos coberturas a la vez? Si el
 * backend guarda literalmente "Ambas", el estado deja de ser estructurado y
 * vuelve a haber un dato que nadie sabe interpretar. Decisión del dueño:
 * excluirla hasta resolverlo.
 */
const EXCLUIDAS = ["ambas"];

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const ficha = leerFicha(
  (
    await db
      .select({ ficha: schema.agentProfile.ficha })
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId))
  )[0]?.ficha
) as { catalogo?: string; variantes?: string } | null;

if (!ficha?.variantes) {
  console.error("[opciones] este negocio no tiene bloque de variantes en su ficha");
  process.exit(1);
}

const leido = leerCatalogoDeTexto(ficha.catalogo ?? "", ficha.variantes);
const productos = await db
  .select({ id: schema.product.id, name: schema.product.name })
  .from(schema.product)
  .where(eq(schema.product.organizationId, organizationId));

console.log(`\n${"=".repeat(74)}`);
console.log("CARGA ADITIVA DE OPCIONES — solo INSERT, nunca DELETE");
console.log(`${"=".repeat(74)}`);
console.log(`\nproductos en tabla: ${productos.map((p) => p.name).join(", ")}`);

const sentencias: string[] = [];
const inserts: { grupo: () => Promise<void>; opciones: (() => Promise<void>)[] }[] = [];
let omitidas = 0;

for (const grupoLeido of leido.grupos) {
  if (!CARGABLES.includes(grupoLeido.nombre)) {
    console.log(`\n⏭️  ${grupoLeido.nombre}: NO se carga (fuera del alcance autorizado)`);
    continue;
  }

  const opciones = grupoLeido.opciones.filter((o) => {
    const fuera = EXCLUIDAS.includes(o.nombre.toLowerCase().trim());
    if (fuera) omitidas++;
    return !fuera;
  });

  console.log(`\n▸ ${grupoLeido.nombre} — ${opciones.length} opciones`);
  if (opciones.length !== grupoLeido.opciones.length) {
    const quitadas = grupoLeido.opciones
      .filter((o) => EXCLUIDAS.includes(o.nombre.toLowerCase().trim()))
      .map((o) => o.nombre);
    console.log(`  ⚠️  EXCLUIDA por ambigüedad, a la espera de decisión: ${quitadas.join(", ")}`);
  }

  for (const producto of productos) {
    // ¿Ya lo tiene? Entonces no se toca. Idempotente SIN borrar.
    const [existe] = await db
      .select({ id: schema.productOptionGroup.id })
      .from(schema.productOptionGroup)
      .where(
        and(
          eq(schema.productOptionGroup.productId, producto.id),
          eq(schema.productOptionGroup.name, grupoLeido.nombre)
        )
      );
    if (existe) {
      console.log(`  ⏭️  ${producto.name}: ya tiene ${grupoLeido.nombre}, se deja como está`);
      continue;
    }

    // Igual que en `migrar-catalogo`: lo que el lector no pudo deducir se ve
    // ANTES de escribir, no después de que el agente lo ofrezca mal.
    if (grupoLeido.revisar) {
      console.log(`  🟠 ${producto.name} · ${grupoLeido.nombre} — REVISAR: ${grupoLeido.revisar}`);
    }
    const groupId = newId("productOptionGroup");
    sentencias.push(
      `INSERT INTO product_option_group (id, organization_id, product_id, name, min_select, max_select, position)\n` +
        `  VALUES ('${groupId}', '${organizationId}', '${producto.id}', '${grupoLeido.nombre}', ${grupoLeido.minimo}, ${grupoLeido.maximo}, 1);`
    );
    const opsDeEsteGrupo: (() => Promise<void>)[] = [];
    for (const [i, o] of opciones.entries()) {
      const optionId = newId("productOption");
      sentencias.push(
        `INSERT INTO product_option (id, organization_id, group_id, name, price_delta_cents, position)\n` +
          `  VALUES ('${optionId}', '${organizationId}', '${groupId}', '${o.nombre.replace(/'/g, "''")}', ${o.precioExtraCents}, ${i});`
      );
      opsDeEsteGrupo.push(async () => {
        await db.insert(schema.productOption).values({
          id: optionId,
          organizationId,
          groupId,
          name: o.nombre,
          priceDeltaCents: o.precioExtraCents,
          position: i,
        });
      });
    }
    inserts.push({
      grupo: async () => {
        await db.insert(schema.productOptionGroup).values({
          id: groupId,
          organizationId,
          productId: producto.id,
          name: grupoLeido.nombre,
          minSelect: grupoLeido.minimo,
          maxSelect: grupoLeido.maximo,
          position: 1,
        });
      },
      opciones: opsDeEsteGrupo,
    });
  }
}

console.log(`\n${"─".repeat(74)}`);
console.log(`PLAN EXACTO DE ESCRITURA — ${sentencias.length} sentencias`);
console.log(`${"─".repeat(74)}\n`);
for (const s of sentencias) console.log(s);

const destructivas = sentencias.filter((s) => /^\s*(DELETE|UPDATE|DROP|TRUNCATE)/i.test(s));
console.log(`\n${"─".repeat(74)}`);
console.log(`INSERT : ${sentencias.length}`);
console.log(`UPDATE : 0`);
console.log(`DELETE : ${destructivas.length}`);
console.log(`opciones excluidas por ambigüedad: ${omitidas}`);

if (destructivas.length > 0) {
  console.error("\n⛔ CANCELADO: el plan incluye una operación destructiva.");
  await sql.end();
  process.exit(1);
}

if (!aplicar) {
  console.log("\n(simulación: NO se ha escrito nada. Para ejecutarlo: --aplicar)\n");
  await sql.end();
  process.exit(0);
}

for (const { grupo, opciones } of inserts) {
  await grupo();
  for (const op of opciones) await op();
}
console.log(`\n✅ ${sentencias.length} filas insertadas. Nada borrado, nada actualizado.\n`);

await sql.end();
process.exit(0);
