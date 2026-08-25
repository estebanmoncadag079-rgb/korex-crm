/**
 * El menú guiado de WhatsApp (25-ago-2026): siembra `ficha.menu` por defecto
 * en negocios que aún no lo declaran, y enciende/apaga `menu_mode`.
 *
 * A diferencia de `migrar:catalogo` (que interpreta texto libre), aquí no hay
 * nada que "traducir": `ficha.menu` ya es la fuente directa que el dueño
 * edita en el wizard de alta. Este script solo:
 *   1. propone un punto de partida para quien no pasó por el wizard nuevo, y
 *   2. enciende/apaga el interruptor con las guardas que evitan un menú roto.
 *
 * Uso:
 *   pnpm migrar:menu <organizationId>               # revisar, no escribe
 *   pnpm migrar:menu <organizationId> --aplicar      # siembra ficha.menu (si no existe)
 *   pnpm migrar:menu <organizationId> --encender     # pone menu_mode='guiado'
 *   pnpm migrar:menu <organizationId> --apagar       # ROLLBACK a 'texto'
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { aSecciones, esPorSecciones, leerFicha } from "@/server/ai/generador/leer-ficha";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import { armarMenuDeIntenciones, armarMenuDelCatalogo } from "@/server/catalog/menu";
import { catalogoDePedidos } from "@/server/catalog/queries";
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
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const orgId = process.argv[2];
if (!orgId || orgId.startsWith("--")) {
  console.error("Falta el organizationId. Uso: pnpm migrar:menu <orgId> [--aplicar|--encender|--apagar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");
const encender = process.argv.includes("--encender");
const apagar = process.argv.includes("--apagar");

/** Punto de partida neutral: 3 opciones caben en botones, sin asumir nada del negocio. */
const MENU_POR_DEFECTO = ["Ver el menú", "Hacer un pedido", "Hablar con un asesor"];

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const perfil = (
  await db
    .select({
      nombre: schema.organization.name,
      ficha: schema.agentProfile.ficha,
      catalogSource: schema.agentProfile.catalogSource,
      menuMode: schema.agentProfile.menuMode,
      citas: schema.agentProfile.appointmentsEnabled,
    })
    .from(schema.agentProfile)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.agentProfile.organizationId))
    .where(eq(schema.agentProfile.organizationId, orgId))
    .limit(1)
)[0];

if (!perfil) {
  console.error(`[menu] no existe ninguna organización con id ${orgId}`);
  await sql.end();
  process.exit(1);
}

console.log(`[menu] ${perfil.nombre} · modo actual: ${perfil.menuMode} · catálogo: ${perfil.catalogSource}`);

if (perfil.citas) {
  console.error("[menu] ⛔ es un negocio de CITAS: el menú guiado aún es solo para pedidos.");
  await sql.end();
  process.exit(1);
}

if (apagar) {
  await db
    .update(schema.agentProfile)
    .set({ menuMode: "texto", updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, orgId));
  console.log("[menu] ✅ ROLLBACK: el agente vuelve a redactar el saludo libremente.");
  await sql.end();
  process.exit(0);
}

if (encender) {
  if (perfil.catalogSource !== "tabla") {
    console.error(
      "[menu] ⛔ requiere catalog_source='tabla': sin el catálogo en tablas no hay de dónde derivar el menú de categorías (pnpm migrar:catalogo)."
    );
    await sql.end();
    process.exit(1);
  }
  const ficha = leerFicha(perfil.ficha) as FichaDelNegocio | null;
  const opciones = ficha?.menu?.opciones ?? [];
  if (opciones.length === 0) {
    console.error("[menu] ⛔ sin ficha.menu declarado: corre --aplicar primero, o complétalo en el wizard.");
    await sql.end();
    process.exit(1);
  }
  const menuIntenciones = armarMenuDeIntenciones(opciones);
  const productos = await catalogoDePedidos(orgId);
  const menuCatalogo = armarMenuDelCatalogo(productos, null);
  if (!menuIntenciones) {
    console.error("[menu] ⛔ el menú de opciones no cabe en los límites de WhatsApp (revisa las etiquetas).");
    await sql.end();
    process.exit(1);
  }
  if (!menuCatalogo) {
    console.error(
      "[menu] ⛔ ni el catálogo completo ni sus categorías caben en una lista de WhatsApp (revisa nombres de producto/categoría muy largos, o más de 10 categorías): encenderlo dejaría al agente sin poder mostrar el menú de productos."
    );
    await sql.end();
    process.exit(1);
  }
  console.log(
    productos.length <= 10
      ? "[menu] el catálogo entero cabe en una sola lista."
      : "[menu] el catálogo no cabe entero: se mostrará primero por categorías (nivel 2)."
  );
  await db
    .update(schema.agentProfile)
    .set({ menuMode: "guiado", updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, orgId));
  console.log(`[menu] ✅ ENCENDIDO con ${opciones.length} opciones y ${productos.length} productos. Rollback: --apagar`);
  await sql.end();
  process.exit(0);
}

const original = (() => {
  try {
    return JSON.parse(perfil.ficha ?? "");
  } catch {
    return null;
  }
})();
const guardarPorSecciones = esPorSecciones(original);
const ficha = leerFicha(perfil.ficha) as FichaDelNegocio | null;
if (!ficha) {
  console.error("[menu] ⛔ sin ficha guardada (prompt manual): no hay dónde sembrar el menú.");
  await sql.end();
  process.exit(1);
}

if (ficha.menu?.opciones?.length) {
  console.log(`[menu] ✔ ya declara ${ficha.menu.opciones.length} opción(es). No se toca.`);
  console.log(ficha.menu.opciones.map((o) => `    - ${o.etiqueta}  [${o.id}]`).join("\n"));
} else {
  console.log(`\n[menu] propuesta (sin declarar todavía):`);
  console.log(MENU_POR_DEFECTO.map((e) => `    - ${e}`).join("\n"));

  if (!aplicar) {
    console.log("\n[menu] NO se escribió nada (falta --aplicar). Ajústalo en el wizard antes o después de aplicar.");
  } else {
    const opciones = MENU_POR_DEFECTO.map((etiqueta, i) => ({
      id: `opcion_${i + 1}`,
      etiqueta,
    }));
    const conMenu = { ...ficha, menu: { opciones } } as FichaDelNegocio;
    const nueva = JSON.stringify(guardarPorSecciones ? aSecciones(conMenu) : conMenu);
    await conRegistro(
      {
        tabla: "agent_profile",
        registro: orgId,
        leerFila: async () => {
          const [f] = await db
            .select()
            .from(schema.agentProfile)
            .where(eq(schema.agentProfile.organizationId, orgId));
          return (f as unknown as Record<string, unknown>) ?? null;
        },
        declarados: ["ficha", "updatedAt"],
        proceso: "migrar:menu",
        actor: "script:migrar-menu",
      },
      async () =>
        db
          .update(schema.agentProfile)
          .set({ ficha: nueva, updatedAt: new Date() })
          .where(eq(schema.agentProfile.organizationId, orgId))
    );
    console.log("\n[menu] ✅ ficha.menu sembrado. Ajústalo en el wizard cuando quieras.");
    console.log("[menu] el prompt NO se regenera solo: hace falta pnpm regenerar:flota para que el agente lo ofrezca.");
  }
}

console.log(`\n[menu] para activarlo de verdad: pnpm migrar:menu ${orgId} --encender`);

await sql.end();
process.exit(0);
