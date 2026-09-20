/**
 * Añade `soloEnModalidades` al requisito de dirección de las fichas que ya lo
 * declaran solo con `soloSi` — paso 4 de la auditoría del 20-ago-2026
 * ([116-LA-MODALIDAD-DEL-PEDIDO.md](../docs/korexia/116-LA-MODALIDAD-DEL-PEDIDO.md)).
 *
 * **Por qué hace falta un script y no basta con cambiar el código:** la
 * condición de un requisito es un DATO, guardado dentro de `agent_profile.ficha`
 * de cada negocio. Cambiar `requisitosSugeridos` solo arregla a quien nazca
 * mañana; los que ya existen siguen con la condición a medias.
 *
 * Es genérico a propósito: busca la forma del dato —un requisito con
 * `soloSi: "entrega.haceDomicilios"` y sin `soloEnModalidades`— no un negocio
 * concreto. Sirve igual para cualquiera que aparezca en ese estado.
 *
 * Se ejecuta una vez y se acaba, igual que `migrar:requisitos`.
 *
 * Uso:
 *   pnpm migrar:modalidad                 # TODAS las fichas, solo simula
 *   pnpm migrar:modalidad <organizationId>
 *   pnpm migrar:modalidad <organizationId> --aplicar
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { conRegistro } from "@/server/registro-de-cambios";
import { generarPerfil } from "@/server/ai/generador/generar";
import { opcionesDeGeneracion } from "@/server/ai/generador/fuentes";
import { leerFicha, serializarComoEstaba } from "@/server/ai/generador/leer-ficha";
import {
  MODALIDAD_DOMICILIO,
  type FichaDelNegocio,
  type Requisito,
} from "@/server/ai/generador/ficha";

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
const soloEste = process.argv.slice(2).find((a) => !a.startsWith("--"));

const sql = postgres(envVar("DATABASE_URL")!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const filas = await db
  .select({
    organizationId: schema.agentProfile.organizationId,
    nombre: schema.organization.name,
    ficha: schema.agentProfile.ficha,
    instructions: schema.agentProfile.instructions,
    // Quien ya tiene el catálogo en tablas NO lo lleva en el prompt: sin esto,
    // la comparación de abajo recompila un prompt con el menú dentro y
    // "detecta" un cambio que no existe.
    catalogSource: schema.agentProfile.catalogSource,
    paymentSource: schema.agentProfile.paymentSource,
    deliverySource: schema.agentProfile.deliverySource,
    menuMode: schema.agentProfile.menuMode,
  })
  .from(schema.agentProfile)
  .innerJoin(schema.organization, eq(schema.organization.id, schema.agentProfile.organizationId));

console.log(`\n${aplicar ? "APLICANDO" : "SIMULACIÓN (sin --aplicar no se escribe nada)"}\n`);

let migradas = 0;

for (const fila of filas) {
  if (soloEste && fila.organizationId !== soloEste) continue;
  const ficha = leerFicha(fila.ficha) as FichaDelNegocio | null;
  if (!ficha) continue;

  const requisitos = ficha.cierre?.requisitos;
  if (!requisitos?.length) continue;

  /*
   * La forma que se busca, no un id ni un negocio: un requisito condicionado a
   * que el negocio haga domicilios, al que le falta la otra mitad —para qué
   * modalidad del PEDIDO hace falta.
   */
  const pendientes = requisitos.filter(
    (r) => r.soloSi === "entrega.haceDomicilios" && !r.soloEnModalidades?.length
  );
  if (pendientes.length === 0) continue;

  const nuevos: Requisito[] = requisitos.map((r) =>
    pendientes.includes(r) ? { ...r, soloEnModalidades: [MODALIDAD_DOMICILIO] } : r
  );

  console.log(`▸ ${fila.nombre} (${fila.organizationId})`);
  for (const r of pendientes) {
    console.log(`    ${r.id}: soloSi="${r.soloSi}"  →  + soloEnModalidades=["${MODALIDAD_DOMICILIO}"]`);
  }

  const fichaNueva: FichaDelNegocio = {
    ...ficha,
    cierre: { ...ficha.cierre, requisitos: nuevos },
  };

  /*
   * ¿Cambia el prompt POR ESTA MIGRACIÓN? Se comparan las dos fichas
   * recompiladas —la de antes y la de después—, no contra el prompt guardado.
   *
   * La diferencia importa: comparar contra lo guardado mezcla este cambio con
   * cualquier deriva anterior. Un negocio cuyo prompt lleve semanas sin
   * regenerarse desde `conducta.ts` daría "cambió" aunque esta migración no le
   * hubiera tocado una coma, y abortaría por algo ajeno.
   *
   * Los requisitos no viven en `instructions` —los lee el pipeline en cada
   * turno—, así que lo esperable es que sean idénticos. Si no lo son, algo más
   * se coló aquí y hay que parar.
   */
  const opciones = opcionesDeGeneracion(fila);
  const antes = generarPerfil(ficha, opciones);
  const despues = generarPerfil(fichaNueva, opciones);
  const promptIgual = antes.instructions === despues.instructions;
  console.log(`    el prompt no cambia por esto: ${promptIgual ? "✅" : "🔴"}`);
  if (!promptIgual) {
    console.error(
      `    ⛔ ABORTADA para ${fila.nombre}: esta migración solo puede tocar la condición del requisito.`
    );
    continue;
  }
  // Informativo, no bloqueante: deriva anterior, ajena a esta migración.
  if (despues.instructions !== fila.instructions) {
    console.log(
      `    ℹ️  su prompt guardado ya venía desfasado de su ficha ` +
        `(${fila.instructions?.length} vs ${despues.instructions.length}); esta migración no lo toca`
    );
  }

  migradas++;
  if (!aplicar) continue;

  await sql`CREATE TABLE IF NOT EXISTS agent_profile_bk_modalidad AS SELECT * FROM agent_profile WHERE 1=0`;
  await sql`DELETE FROM agent_profile_bk_modalidad WHERE organization_id = ${fila.organizationId}`;
  await sql`INSERT INTO agent_profile_bk_modalidad SELECT * FROM agent_profile WHERE organization_id = ${fila.organizationId}`;

  const leerFila = async () => {
    const [f] = await db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, fila.organizationId));
    return (f as unknown as Fila) ?? null;
  };

  await conRegistro(
    {
      tabla: "agent_profile",
      registro: fila.organizationId,
      leerFila,
      declarados: ["ficha", "updatedAt"],
      proceso: "migrar:modalidad",
      actor: "script:migrar-modalidad",
    },
    async () =>
      db
        .update(schema.agentProfile)
        .set({
          ficha: serializarComoEstaba(fila.ficha, fichaNueva),
          updatedAt: new Date(),
        })
        .where(eq(schema.agentProfile.organizationId, fila.organizationId))
  );
}

console.log(
  `\n${aplicar ? "Migradas" : "Se migrarían"}: ${migradas} ficha(s).` +
    (aplicar ? " Respaldo en agent_profile_bk_modalidad." : " Repite con --aplicar si la lista es correcta.")
);
console.log("⚠️ El PROMPT no cambia por esto: los requisitos los lee el pipeline, no el texto.\n");

await sql.end();
process.exit(0);
