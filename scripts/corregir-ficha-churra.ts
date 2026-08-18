/**
 * Corrección puntual de la ficha de La Churra — paso 1 del encendido (18-ago-2026).
 *
 * **Por qué hace falta**: mientras se preparaba el encendido, el dueño editó la
 * ficha desde el CRM (`aplicarFicha`, 18-ago 02:31 UTC). Esa edición es la
 * fuente de verdad y no se toca — pero dejó tres cosas pendientes que el propio
 * dueño pidió resolver aquí:
 *
 *   1. `reglasPropias` sigue con "CHOCOLATE" a secas en dos entradas (3
 *      ocurrencias): el negocio solo vende CHOCOLATE NEGRO y CHOCOLATE BLANCO,
 *      y `normalizar.ts` resuelve por igualdad exacta — "chocolate" no
 *      encuentra "chocolate negro".
 *   2. `negocio.variantes` ya no trae el bloque RECUBIERTO/ADICIONES: sin él,
 *      `pnpm cargar:opciones` no tiene de dónde leer esos grupos y el
 *      validador de la Fase 2 no puede comprobarlos.
 *   3. El RECUBIERTO necesita declarar cuántos se eligen (`(elige 1)`), o el
 *      lector lo deja en "todas" y lo marca para revisión (`sembrar.ts`).
 *
 * **Lo que SÍ se preserva tal cual**: las cuatro líneas "por producto" de SALSA
 * que el dueño acaba de escribir (`CHURRITA — $10.000-1 salsa a eleccion
 * entre...`) — ya dicen "chocolate negro" y "chocolate blanco" correctamente, y
 * es el formato que el propio parser documenta como "el que usa La Churra de
 * verdad". Solo se AÑADEN las dos líneas de RECUBIERTO y ADICIONES detrás.
 *
 * Datos de ADICIONES confirmados por el dueño el 18-ago: chocolate negro y
 * chocolate blanco también se piden como adición, $2.000 cada una. LECHERA,
 * AREQUIPE y la botella de agua se dejan como ya estaban en `reglasPropias`
 * (nadie pidió quitarlas).
 *
 * Usa SIEMPRE `serializarComoEstaba` — nunca lo que devuelve `leerFichaAplanada`
 * directamente ([84-EL-MODELO-DE-LA-FICHA.md](../docs/korexia/84-EL-MODELO-DE-LA-FICHA.md)).
 * Declara los tres campos que toca y aborta si algo más cambió.
 *
 * Uso:
 *   pnpm corregir:ficha-churra <organizationId>            → simula
 *   pnpm corregir:ficha-churra <organizationId> --aplicar  → escribe
 *
 * Reversión: el registro de cambios (`[cambio] ... campo=ficha ...`) deja la
 * huella del valor anterior; para revertir de verdad, restaurar `ficha` desde
 * el respaldo anterior a la ejecución (docs/korexia/93, sección de respaldos).
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  leerFichaAplanada,
  serializarComoEstaba,
} from "@/server/ai/generador/leer-ficha";
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
  console.error("Uso: pnpm corregir:ficha-churra <org_...> [--aplicar]");
  process.exit(1);
}

/** Solo esta organización. Es un script de un solo uso, no genérico. */
if (organizationId !== "org_lo5gdlt6k43z9fg1ling") {
  console.error("⛔ Este script está escrito para La Churra y solo para ella.");
  process.exit(1);
}

const BLOQUE_RECUBIERTO_ADICIONES =
  "RECUBIERTO (elige 1): ✨ Azúcar-canela · ✨ Azúcar sola · ✨ Ambas · ✨ Sin azúcar\n" +
  "ADICIONES (opcionales, se cobran aparte): 🍫 Salsa de CHOCOLATE NEGRO $2.000 · " +
  "🤍 Salsa de CHOCOLATE BLANCO $2.000 · 🐄 LECHERA $1.500 · 🍯 AREQUIPE $1.500 · " +
  "💧 Botella de agua $2.000";

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

  const variantesAntes = aplanada.variantes ?? "";
  const reglasAntes = aplanada.reglasPropias ?? [];

  if (/RECUBIERTO/i.test(variantesAntes)) {
    console.log("⏭️  negocio.variantes ya trae RECUBIERTO: no se toca.");
  }
  const variantesDespues = /RECUBIERTO/i.test(variantesAntes)
    ? variantesAntes
    : `${variantesAntes.trimEnd()}\n${BLOQUE_RECUBIERTO_ADICIONES}`;

  const CHOCOLATE_SUELTO = /CHOCOLATE(?!\s*(NEGRO|BLANCO))/g;
  let corregidas = 0;
  const reglasDespues = reglasAntes.map((r) => {
    if (!CHOCOLATE_SUELTO.test(r)) return r;
    CHOCOLATE_SUELTO.lastIndex = 0;
    corregidas += (r.match(CHOCOLATE_SUELTO) ?? []).length;
    return r.replace(CHOCOLATE_SUELTO, "CHOCOLATE NEGRO");
  });

  console.log(`\n${"=".repeat(74)}`);
  console.log("CORRECCIÓN DE LA FICHA — org_lo5gdlt6k43z9fg1ling");
  console.log(`${"=".repeat(74)}\n`);
  console.log(`reglasPropias: ${corregidas} ocurrencia(s) de "CHOCOLATE" → "CHOCOLATE NEGRO"`);
  console.log(
    variantesDespues === variantesAntes
      ? "negocio.variantes: sin cambios"
      : "negocio.variantes: se añade el bloque RECUBIERTO (elige 1) + ADICIONES"
  );

  if (corregidas === 0 && variantesDespues === variantesAntes) {
    console.log("\nNada que corregir. Saliendo sin escribir.\n");
    await sql.end();
    return;
  }

  console.log(`\n${"─".repeat(74)}`);
  console.log("negocio.variantes DESPUÉS:");
  console.log(`${"─".repeat(74)}`);
  console.log(variantesDespues);

  if (!aplicar) {
    console.log("\n(simulación: NO se ha escrito nada. Para ejecutarlo: --aplicar)\n");
    await sql.end();
    return;
  }

  const fichaPatched = {
    ...aplanada,
    variantes: variantesDespues,
    reglasPropias: reglasDespues,
  };
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
      proceso: "corregir-ficha-churra",
      actor: "script:corregir-ficha-churra",
    },
    async () =>
      db
        .update(schema.agentProfile)
        .set({ ficha: nuevaFicha })
        .where(eq(schema.agentProfile.organizationId, organizationId!))
  );

  // Comparación de fila completa: si algo más cambió, se ve aquí y no en
  // silencio (regla de docs/korexia/68-UN-DUENO-POR-DATO.md).
  const despues = await leerFila();
  const comparacion = compararFila(fila as unknown as Fila, despues!, ["ficha"]);
  console.log(`\n${explicar(comparacion)}\n`);
  if (!comparacion.ok) {
    console.error("⛔ Cambió algo no declarado. Revisar antes de continuar.");
    await sql.end();
    process.exit(1);
  }

  console.log("✅ Ficha corregida.");
  console.log("⚠️ El PROMPT no cambia por esto: hace falta pnpm regenerar:flota, y eso NO se ejecuta aquí.\n");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
