/**
 * Doc 200 (26-sep-2026): acomoda lo que ya escribió cada negocio en los campos
 * nuevos de la ficha, SIN inventar nada. Decisión del dueño: "yo lo acomodo y
 * tú revisas" — este script muestra el antes/después y solo escribe con
 * `--aplicar`, después de que el dueño lo revise.
 *
 * Las decisiones van escritas a mano, negocio por negocio (`DECISIONES`): el
 * backend no interpreta texto (doc 198), así que aquí no hay ningún parser de
 * frases. Cada una cita la frase de la ficha de donde sale.
 *
 * ⚠️ Escribe DOS sitios: la ficha aplicada (`aplicarFicha`, el mismo camino que
 * el CRM, que además regenera el prompt) y el BORRADOR que edita la pantalla
 * (`organization.metadata.fichaBorrador`). El borrador gana al mostrarse
 * (`fusionarBorrador`): si no se acomoda también, la pantalla enseñaría lo viejo
 * y el siguiente guardado desharía la migración.
 *
 * ⚠️ Correr DESPUÉS del deploy del doc 200: `aplicarFicha` regenera el prompt
 * con el generador de este código.
 *
 * Uso:
 *   node .tmp-migrar-200.mjs            → solo muestra
 *   node .tmp-migrar-200.mjs --aplicar  → escribe (ficha + borrador)
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { leerFicha } from "@/server/ai/generador/leer-ficha";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import { acomodar, DECISIONES } from "./lib/acomodar-ficha-200";

type Ficha = Partial<FichaDelNegocio>;

const aplicar = process.argv.includes("--aplicar");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql, { schema });
const { aplicarFicha } = await import("@/server/ai/generador/aplicar");

for (const orgId of Object.keys(DECISIONES)) {
  const [perfil] = await db.select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, orgId));
  const [org] = await db.select().from(schema.organization).where(eq(schema.organization.id, orgId));
  const aplicada = leerFicha(perfil?.ficha) as Ficha | null;
  if (!aplicada) {
    console.log(`\n⚠️ ${orgId}: sin ficha, se salta`);
    continue;
  }
  const { ficha, cambios } = acomodar(orgId, aplicada);
  console.log(`\n===== ${org?.name} (${orgId})`);
  if (!cambios.length) console.log("  sin cambios");
  for (const c of cambios) {
    console.log(`  • ${c.campo}\n      antes:   ${JSON.stringify(c.antes)}\n      después: ${JSON.stringify(c.despues)}\n      porque:  ${c.porque}`);
  }

  // El borrador que edita la pantalla: los mismos cambios, para que no los deshaga.
  let meta: Record<string, unknown> = {};
  try {
    meta = org?.metadata ? (JSON.parse(org.metadata) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const borrador = meta.fichaBorrador as Ficha | undefined;
  const borradorNuevo = borrador ? acomodar(orgId, { ...aplicada, ...borrador }).ficha : undefined;

  if (!aplicar || !cambios.length) continue;
  await aplicarFicha(orgId, ficha as FichaDelNegocio, {
    puedeEscribir: ["negocio", "flujo", "politicas"],
    actor: "script:migrar-ficha-200",
  });
  if (borradorNuevo) {
    await db
      .update(schema.organization)
      .set({ metadata: JSON.stringify({ ...meta, fichaBorrador: borradorNuevo }) })
      .where(eq(schema.organization.id, orgId));
  }
  console.log("  ✅ aplicado (ficha + borrador)");
}
if (!aplicar) console.log("\n[migrar-200] no se escribió nada (falta --aplicar)");
await sql.end();
process.exit(0);
