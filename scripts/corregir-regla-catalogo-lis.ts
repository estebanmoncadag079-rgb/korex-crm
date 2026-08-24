/**
 * Corrección puntual de la ficha de Lis Pastelería — el link del catálogo
 * (24-ago-2026).
 *
 * **El caso**: Maricel escribió "quiero hacer un pedido" y el agente prometió
 * el catálogo ("te comparto nuestro catálogo") sin incluir el enlace. Un
 * asesor tuvo que mandarlo a mano.
 *
 * **La causa, medida con el pipeline real (8 corridas antes de tocar nada)**:
 * el dueño YA tenía escrita una regla explícita —
 *   "SIEMPRE que el cliente pregunte por los productos enviale el link del
 *    catalogo..."
 * — pero (a) el disparador es "pregunte por los productos", y el mensaje real
 * fue "quiero hacer un pedido"; y (b) la regla nombra "el link del catálogo"
 * sin decir CUÁL: el enlace de verdad solo vive en una entrada de conocimiento
 * aparte, y el modelo tiene que inferir la conexión entre la instrucción y el
 * dato. Falló 1 de cada 3 veces incluso después de separar ese enlace en una
 * entrada dedicada — la instrucción y el dato seguían siendo dos piezas que
 * había que unir por inferencia.
 *
 * **El arreglo**: el enlace entra DENTRO de la propia regla, y el disparador
 * se amplía a "pregunte por los productos O quiera hacer un pedido". Deja de
 * haber inferencia que hacer.
 *
 * Solo escribe `ficha` (nunca `instructions` a mano — `serializarComoEstaba`,
 * [84-EL-MODELO-DE-LA-FICHA.md](../docs/korexia/84-EL-MODELO-DE-LA-FICHA.md)).
 * Declara el único campo que toca y aborta si algo más cambió.
 *
 * Uso:
 *   pnpm corregir:regla-catalogo-lis <organizationId>            → simula
 *   pnpm corregir:regla-catalogo-lis <organizationId> --aplicar  → escribe
 *
 * ⚠️ El PROMPT no cambia por esto: hace falta además
 *   pnpm regenerar:flota <organizationId> --aplicar
 *
 * Reversión: el registro de cambios (`[cambio] ... campo=ficha ...`) deja la
 * huella del valor anterior; para revertir de verdad, restaurar `ficha` desde
 * `agent_profile_bk_regla_catalogo_20260824` (creada por este script antes de
 * escribir).
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { leerFichaAplanada, serializarComoEstaba } from "@/server/ai/generador/leer-ficha";
import { compararFila, explicar, type Fila } from "@/server/ai/generador/comparar-fila";
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

const organizationId = process.argv[2];
const aplicar = process.argv.includes("--aplicar");

if (!organizationId?.startsWith("org_")) {
  console.error("Uso: pnpm corregir:regla-catalogo-lis <org_...> [--aplicar]");
  process.exit(1);
}

/** Solo esta organización. Es un script de un solo uso, no genérico. */
if (organizationId !== "org_lispasteleria0001") {
  console.error("⛔ Este script está escrito para Lis Pastelería y solo para ella.");
  process.exit(1);
}

const ENLACE = "https://drive.google.com/file/d/1t3z5C1EMkGCzkSEX_CkCQMpZlaVmM8P7/view";
const REGLA_VIEJA_FRAGMENTO = "enviale el link del catalogo";
const REGLA_NUEVA =
  "SIEMPRE que el cliente pregunte por los productos O diga que quiere hacer un " +
  `pedido, envíale ESTE link con las fotos y precios del catálogo: ${ENLACE} — ` +
  "eso es lo primero que tienes que hacer, antes de enviarle la lista de los " +
  "productos en texto. Envíaselo con un mensaje bonito y cordial.";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });

  const [fila] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId!));
  if (!fila) {
    console.error("No hay agent_profile para esa organización.");
    await sql.end();
    process.exit(1);
  }

  const fichaCruda = fila.ficha;
  const aplanada = leerFichaAplanada(fichaCruda);
  if (!aplanada) {
    console.error("La ficha está vacía o no se pudo leer.");
    await sql.end();
    process.exit(1);
  }

  const reglasAntes = aplanada.reglasPropias ?? [];
  const idx = reglasAntes.findIndex((r) => r.includes(REGLA_VIEJA_FRAGMENTO));

  console.log(`\n${"=".repeat(74)}`);
  console.log("CORRECCIÓN DE LA REGLA DEL CATÁLOGO — org_lispasteleria0001");
  console.log(`${"=".repeat(74)}\n`);

  if (idx === -1) {
    console.log(
      `⏭️  No se encontró ninguna regla con "${REGLA_VIEJA_FRAGMENTO}". Nada que corregir.`
    );
    await sql.end();
    return;
  }

  console.log("ANTES:");
  console.log(`  ${reglasAntes[idx]}`);
  console.log("\nDESPUÉS:");
  console.log(`  ${REGLA_NUEVA}`);

  if (!aplicar) {
    console.log("\n(simulación: NO se ha escrito nada. Para ejecutarlo: --aplicar)\n");
    await sql.end();
    return;
  }

  // Respaldo explícito de la ficha ANTES de tocarla — además del registro de
  // cambios, que solo guarda el valor previo del campo, no la fila completa.
  await sql`
    CREATE TABLE IF NOT EXISTS agent_profile_bk_regla_catalogo_20260824 AS
    SELECT * FROM agent_profile WHERE organization_id = ${organizationId!}
  `;

  const reglasDespues = [...reglasAntes];
  reglasDespues[idx] = REGLA_NUEVA;
  const fichaPatched = { ...aplanada, reglasPropias: reglasDespues };
  const nuevaFicha = serializarComoEstaba(fichaCruda, fichaPatched);

  const leerFila = async (): Promise<Fila | null> => {
    const [f] = await db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId!));
    return (f as unknown as Fila) ?? null;
  };

  await conRegistro(
    {
      tabla: "agent_profile",
      registro: organizationId!,
      leerFila,
      declarados: ["ficha"],
      proceso: "corregir-regla-catalogo-lis",
      actor: "script:corregir-regla-catalogo-lis",
    },
    async () =>
      db
        .update(schema.agentProfile)
        .set({ ficha: nuevaFicha })
        .where(eq(schema.agentProfile.organizationId, organizationId!))
  );

  const despues = await leerFila();
  const comparacion = compararFila(fila as unknown as Fila, despues!, ["ficha"]);
  console.log(`\n${explicar(comparacion)}\n`);
  if (!comparacion.ok) {
    console.error("⛔ Cambió algo no declarado. Revisar antes de continuar.");
    await sql.end();
    process.exit(1);
  }

  console.log("✅ Regla corregida.");
  console.log(
    "⚠️ El PROMPT no cambia por esto: hace falta pnpm regenerar:flota " +
      "org_lispasteleria0001 --aplicar, y eso NO se ejecuta aquí.\n"
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
